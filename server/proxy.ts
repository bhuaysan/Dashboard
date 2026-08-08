import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";

export function isBlockedIp(ip: string): boolean {
  if (ip.includes(":")) return true;              // IPv6: pauschal ablehnen, nicht gebraucht
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const a = parts[0] ?? 0, b = parts[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true;          // auch das ganze Homelab
  if (a === 169 && b === 254) return true;                    // Cloud-Metadaten
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;                      // Protokollzuweisungen und TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true;       // Benchmark-Netz
  if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT
  if (a >= 224) return true;                                  // Multicast, reserviert, Broadcast
  return false;
}

// Schema und Allowlist — die Prüfung, die sich mit der Config ändert und deshalb
// vor dem Cache steht.
export function assertListed(url: URL, allowlist: string[]): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Schema");
  if (!allowlist.includes(url.hostname)) throw new Error("Host nicht erlaubt");
}

export type LookupAddress = (hostname: string, options: { family: 4 }) => Promise<{ address: string }>;

// Liefert die geprüfte Adresse zurück, damit genau zu ihr verbunden wird.
export async function assertAllowed(url: URL, allowlist: string[], resolveAddress: LookupAddress = lookup): Promise<string> {
  assertListed(url, allowlist);
  const { address } = await resolveAddress(url.hostname, { family: 4 });
  if (isBlockedIp(address)) throw new Error("Private Adresse");
  return address;
}

// An die bereits geprüfte Adresse binden. Ein zweiter DNS-Aufruf durch undici könnte
// sonst eine andere — private — Adresse liefern (DNS-Rebinding).
function pinnedAgent(address: string): Agent {
  return new Agent({
    connect: { family: 4, lookup: (_hostname, _options, cb) => cb(null, address, 4) },
  });
}

export type ProxyResult = { status: number; contentType: string; body: Uint8Array };
type CacheEntry = ProxyResult & { t: number; ttl: number };

const cache = new Map<string, CacheEntry>();
let cacheBytes = 0;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 64;
export const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_IN_FLIGHT = 8;
let inFlight = 0;
const waiters: Array<() => void> = [];

function cacheKey(url: URL): string {
  const normalized = new URL(url);
  normalized.hash = "";
  return normalized.toString();
}

function removeCacheEntry(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  cacheBytes -= entry.body.byteLength;
  cache.delete(key);
}

function remember(key: string, result: ProxyResult, ttl: number): void {
  if (result.body.byteLength > MAX_CACHE_BYTES) return;
  removeCacheEntry(key);
  while (cache.size >= MAX_ENTRIES || cacheBytes + result.body.byteLength > MAX_CACHE_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    removeCacheEntry(oldest);   // Map-Reihenfolge entspricht der LRU-Reihenfolge.
  }
  cache.set(key, { ...result, t: Date.now(), ttl });
  cacheBytes += result.body.byteLength;
}

function cached(key: string): ProxyResult | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.t >= entry.ttl) {
    removeCacheEntry(key);
    return undefined;
  }
  // Zugriff macht den Eintrag zum jüngsten LRU-Element.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

export function clearProxyCache(): void {
  cache.clear();
  cacheBytes = 0;
}

export function proxyCacheSize(): { entries: number; bytes: number } {
  return { entries: cache.size, bytes: cacheBytes };
}

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight -= 1;
  const next = waiters.shift();
  next?.();
}

function ttlFor(url: URL): number {
  return url.hostname.endsWith("open-meteo.com") ? 600_000 : 900_000;
}

async function readLimited(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error("Antwort zu groß");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const chunk of chunks) {
    out.set(chunk, off);
    off += chunk.byteLength;
  }
  return out;
}

export async function proxyFetch(rawUrl: string, allowlist: string[], resolveAddress: LookupAddress = lookup): Promise<ProxyResult> {
  await acquireSlot();
  try {
    let url = new URL(rawUrl);
    url.hash = "";
    assertListed(url, allowlist);   // vor dem Cache, sonst wirkt das Streichen eines Hosts erst nach der TTL

    const key = cacheKey(url);
    const hit = cached(key);
    if (hit) return hit;

    let result: ProxyResult | undefined;
    for (let redirects = 0; redirects <= 3 && !result; redirects++) {
      const agent = pinnedAgent(await assertAllowed(url, allowlist, resolveAddress));   // jedes Ziel erneut prüfen
      try {
        const res = await undiciFetch(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
          dispatcher: agent,
        });
        const location = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && location && redirects < 3) {
          await res.body?.cancel();
          url = new URL(location, url);
          url.hash = "";
          continue;
        }
        const contentLength = res.headers.get("content-length");
        if (contentLength !== null) {
          const declaredLength = Number(contentLength);
          if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) throw new Error("Ungültige Antwortgröße");
          if (declaredLength > MAX_BYTES) throw new Error("Antwort zu groß");
        }
        result = {
          status: res.status,
          contentType: res.headers.get("content-type") ?? "application/octet-stream",
          body: await readLimited(res, MAX_BYTES),   // muss vor agent.close() gelesen sein
        };
      } finally {
        await agent.close();
      }
    }
    if (!result) throw new Error("Zu viele Weiterleitungen");

    if (result.status >= 200 && result.status < 300) remember(key, result, ttlFor(url));
    return result;
  } finally {
    releaseSlot();
  }
}
