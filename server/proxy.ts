import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import { canonicalHostname } from "../src/config/schema.ts";

export const PROXY_DEADLINE_MS = 5_000;
export const MAX_PROXY_IN_FLIGHT = 8;
export const MAX_PROXY_QUEUE = 32;

export class ProxyTimeoutError extends Error {
  constructor() {
    super("Proxy-Zeitüberschreitung");
    this.name = "ProxyTimeoutError";
  }
}

export class ProxyOverloadedError extends Error {
  constructor() {
    super("Proxy ausgelastet");
    this.name = "ProxyOverloadedError";
  }
}

export class ProxyPolicyError extends Error {
  constructor(message: "Schema" | "Host nicht erlaubt" | "Private Adresse") {
    super(message);
    this.name = "ProxyPolicyError";
  }
}

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
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ProxyPolicyError("Schema");
  const hostname = canonicalHostname(url.hostname);
  if (hostname === undefined || !allowlist.some((entry) => canonicalHostname(entry) === hostname)) {
    throw new ProxyPolicyError("Host nicht erlaubt");
  }
}

export type LookupAddress = (hostname: string, options: { family: 4 }) => Promise<{ address: string }>;

function withAbort<T>(promise: Promise<T>, signal: AbortSignal, onAbort?: () => void): Promise<T> {
  if (signal.aborted) return Promise.reject(new ProxyTimeoutError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort?.();
      reject(new ProxyTimeoutError());
    };
    const settle = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { settle(); resolve(value); },
      (error: unknown) => { settle(); reject(error); },
    );
  });
}

// Liefert die geprüfte Adresse zurück, damit genau zu ihr verbunden wird.
export async function assertAllowed(
  url: URL,
  allowlist: string[],
  resolveAddress: LookupAddress = lookup,
  signal?: AbortSignal,
): Promise<string> {
  assertListed(url, allowlist);
  const lookupPromise = resolveAddress(url.hostname, { family: 4 });
  const { address } = signal === undefined
    ? await lookupPromise
    : await withAbort(lookupPromise, signal);
  if (isBlockedIp(address)) throw new ProxyPolicyError("Private Adresse");
  return address;
}

// An die bereits geprüfte Adresse binden. Ein zweiter DNS-Aufruf durch undici könnte
// sonst eine andere — private — Adresse liefern (DNS-Rebinding).
function pinnedAgent(address: string): Agent {
  return new Agent({
    connect: { family: 4, lookup: (_hostname, _options, cb) => cb(null, address, 4) },
  });
}

export type ProxyResult = { status: number; body: Uint8Array };
type CacheEntry = ProxyResult & { t: number; ttl: number };

const cache = new Map<string, CacheEntry>();
let cacheBytes = 0;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 64;
export const MAX_CACHE_BYTES = 16 * 1024 * 1024;
let inFlight = 0;
type SlotWaiter = {
  resolve: () => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
};
const waiters: SlotWaiter[] = [];
const inFlightRequests = new Map<string, Promise<ProxyResult>>();

function cacheKey(url: URL): string {
  const normalized = new URL(url);
  normalized.hash = "";
  return normalized.toString();
}

function proxyPolicyKey(allowlist: string[]): string {
  const canonical = allowlist
    .map(canonicalHostname)
    .filter((host): host is string => host !== undefined);
  return [...new Set(canonical)].sort().join("\n");
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

function acquireSlot(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new ProxyTimeoutError());
  if (waiters.length === 0 && inFlight < MAX_PROXY_IN_FLIGHT) {
    inFlight += 1;
    return Promise.resolve();
  }
  if (waiters.length >= MAX_PROXY_QUEUE) return Promise.reject(new ProxyOverloadedError());
  return new Promise<void>((resolve, reject) => {
    const waiter: SlotWaiter = {
      resolve,
      reject,
      signal,
      onAbort: () => {
        const index = waiters.indexOf(waiter);
        if (index === -1) return;
        waiters.splice(index, 1);
        reject(new ProxyTimeoutError());
      },
    };
    signal.addEventListener("abort", waiter.onAbort, { once: true });
    waiters.push(waiter);
  });
}

function releaseSlot(): void {
  for (;;) {
    const next = waiters.shift();
    if (next === undefined) {
      inFlight -= 1;
      return;
    }
    next.signal.removeEventListener("abort", next.onAbort);
    if (next.signal.aborted) {
      next.reject(new ProxyTimeoutError());
      continue;
    }
    // Das Permit bleibt belegt und geht direkt an den ältesten Wartenden. So
    // kann ein neuer Aufrufer nicht zwischen decrement und resolve überholen.
    next.resolve();
    return;
  }
}

function ttlFor(url: URL): number {
  return url.hostname.endsWith("open-meteo.com") ? 600_000 : 900_000;
}

async function cancelResponseBody(res: Response): Promise<void> {
  try { await res.body?.cancel(); } catch { /* best effort: der ursprüngliche Fehler bleibt maßgeblich */ }
}

async function readLimited(res: Response, max: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancelOnAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal?.aborted) cancelOnAbort();
  signal?.addEventListener("abort", cancelOnAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        try { await reader.cancel(); } catch { /* best effort */ }
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
  } finally {
    signal?.removeEventListener("abort", cancelOnAbort);
    reader.releaseLock();
  }
}

type Deadline = { signal: AbortSignal; stop: () => void };

function startDeadline(): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_DEADLINE_MS);
  return { signal: controller.signal, stop: () => clearTimeout(timer) };
}

async function fetchUncached(
  initialUrl: URL,
  key: string,
  allowlist: string[],
  resolveAddress: LookupAddress,
): Promise<ProxyResult> {
  const deadline = startDeadline();
  let acquired = false;
  try {
    await acquireSlot(deadline.signal);
    acquired = true;
    let url = initialUrl;
    let result: ProxyResult | undefined;
    for (let redirects = 0; result === undefined; redirects += 1) {
      const agent = pinnedAgent(await assertAllowed(url, allowlist, resolveAddress, deadline.signal));
      try {
        let res: Response;
        try {
          res = await undiciFetch(url, {
            redirect: "manual",
            signal: deadline.signal,
            dispatcher: agent,
          });
        } catch (error) {
          if (deadline.signal.aborted) throw new ProxyTimeoutError();
          throw error;
        }
        const location = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && location) {
          if (redirects >= 3) {
            await cancelResponseBody(res);
            throw new Error("Zu viele Weiterleitungen");
          }
          await cancelResponseBody(res);
          url = new URL(location, url);
          url.hash = "";
          continue;
        }
        const contentLength = res.headers.get("content-length");
        if (contentLength !== null) {
          const declaredLength = Number(contentLength);
          if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
            await cancelResponseBody(res);
            throw new Error("Ungültige Antwortgröße");
          }
          if (declaredLength > MAX_BYTES) {
            await cancelResponseBody(res);
            throw new Error("Antwort zu groß");
          }
        }
        result = {
          status: res.status,
          body: await withAbort(
            readLimited(res, MAX_BYTES, deadline.signal),
            deadline.signal,
          ),
        };
      } finally {
        await agent.close();
      }
    }
    if (result.status >= 200 && result.status < 300) remember(key, result, ttlFor(url));
    return result;
  } finally {
    if (acquired) releaseSlot();
    deadline.stop();
  }
}

export async function proxyFetch(rawUrl: string, allowlist: string[], resolveAddress: LookupAddress = lookup): Promise<ProxyResult> {
  const url = new URL(rawUrl);
  url.hash = "";
  assertListed(url, allowlist);   // vor dem Cache, sonst wirkt das Streichen eines Hosts erst nach der TTL

  // Ein Cache-Eintrag und eine laufende Operation gelten nur für exakt die Policy,
  // unter der auch ihre Redirect-Kette geprüft wurde.
  const key = `${proxyPolicyKey(allowlist)}\u0000${cacheKey(url)}`;
  const hit = cached(key);
  if (hit) return hit;

  const running = inFlightRequests.get(key);
  if (running !== undefined) return running;

  const operation = fetchUncached(url, key, allowlist, resolveAddress);
  inFlightRequests.set(key, operation);
  try {
    return await operation;
  } finally {
    if (inFlightRequests.get(key) === operation) inFlightRequests.delete(key);
  }
}
