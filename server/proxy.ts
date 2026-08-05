import { lookup } from "node:dns/promises";

export function isBlockedIp(ip: string): boolean {
  if (ip.includes(":")) return true;              // IPv6: pauschal ablehnen, nicht gebraucht
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return true;
  const a = parts[0] ?? 0, b = parts[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true;          // auch das ganze Homelab
  if (a === 169 && b === 254) return true;                    // Cloud-Metadaten
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT
  return false;
}

export async function assertAllowed(url: URL, allowlist: string[]): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Schema");
  if (!allowlist.includes(url.hostname)) throw new Error("Host nicht erlaubt");
  const { address } = await lookup(url.hostname);
  if (isBlockedIp(address)) throw new Error("Private Adresse");
}

type ProxyResult = { status: number; contentType: string; body: Uint8Array };
type CacheEntry = ProxyResult & { t: number; ttl: number };

const cache = new Map<string, CacheEntry>();
const MAX_BYTES = 2 * 1024 * 1024;

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

export async function proxyFetch(rawUrl: string, allowlist: string[]): Promise<ProxyResult> {
  const cached = cache.get(rawUrl);
  if (cached && Date.now() - cached.t < cached.ttl) return cached;

  let url = new URL(rawUrl);
  let res: Response | undefined;
  for (let redirects = 0; redirects <= 3; redirects++) {
    await assertAllowed(url, allowlist);    // jedes Ziel erneut prüfen
    res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location && redirects < 3) {
      await res.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    break;
  }
  if (!res) throw new Error("Zu viele Weiterleitungen");

  const body = await readLimited(res, MAX_BYTES);
  const result: ProxyResult = {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    body,
  };
  if (res.ok) cache.set(rawUrl, { ...result, t: Date.now(), ttl: ttlFor(url) });
  return result;
}
