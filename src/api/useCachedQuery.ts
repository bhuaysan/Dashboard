import { useQuery } from "@tanstack/react-query";

const CACHE_VERSION = 1;
const CACHE_PREFIX = "dashboard:cache:";
const CACHE_CLOCK_TOLERANCE_MS = 5_000;
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const CACHE_MAX_ENTRIES = 64;

type CacheEnvelope = {
  version: number;
  t: number;
  data: unknown;
};

type Options<T> = {
  refetchIntervalMs?: number;
  decode?: (data: unknown) => T | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storageKey(key: string): string {
  return `${CACHE_PREFIX}${key}`;
}

function parseEnvelope(raw: string | null): CacheEnvelope | undefined {
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== CACHE_VERSION ||
        typeof parsed.t !== "number" || !Number.isFinite(parsed.t) || parsed.t < 0 || !("data" in parsed)) {
      return undefined;
    }
    return { version: CACHE_VERSION, t: parsed.t, data: parsed.data };
  } catch {
    return undefined;
  }
}

function removeCacheKey(key: string): void {
  try { localStorage.removeItem(key); } catch { /* Speicher nicht verfügbar */ }
}

/** Entfernt nur eigene, ungültige/alte Einträge und begrenzt die Zahl der Query-Varianten. */
export function cleanupCache(now = Date.now()): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
    }

    const valid: Array<{ key: string; t: number }> = [];
    for (const key of keys) {
      const envelope = parseEnvelope(localStorage.getItem(key));
      if (envelope === undefined || envelope.t > now + CACHE_CLOCK_TOLERANCE_MS ||
          now - envelope.t > CACHE_MAX_AGE_MS) {
        removeCacheKey(key);
      } else {
        valid.push({ key, t: envelope.t });
      }
    }
    valid.sort((left, right) => right.t - left.t);
    for (const entry of valid.slice(CACHE_MAX_ENTRIES)) removeCacheKey(entry.key);
  } catch {
    // localStorage kann im privaten Modus oder bei vollem Speicher vollständig ausfallen.
  }
}

function readEnvelope(key: string): CacheEnvelope | undefined {
  cleanupCache();
  try {
    const cacheKey = storageKey(key);
    const envelope = parseEnvelope(localStorage.getItem(cacheKey));
    if (envelope === undefined) removeCacheKey(cacheKey);
    return envelope;
  } catch {
    return undefined;
  }
}

export function useCachedQuery<T>(key: string, fn: () => Promise<T>, ttlMs: number, options: Options<T> = {}) {
  const { refetchIntervalMs, decode } = options;
  return useQuery<T>({
    queryKey: [key],
    queryFn: async () => {
      const data = await fn();
      try { localStorage.setItem(storageKey(key),
              JSON.stringify({ version: CACHE_VERSION, t: Date.now(), data })); } catch {}
      cleanupCache();
      return data;
    },
    initialData: () => {
      const envelope = readEnvelope(key);
      if (envelope === undefined || decode === undefined) return undefined;
      try {
        const data = decode(envelope.data);
        if (data !== undefined) return data;
      } catch {
        // Ein Decoder ist eine Trust-Boundary. Auch ein fehlerhafter Decoder darf
        // einen kaputten localStorage-Eintrag nicht bis in React propagieren.
      }
      removeCacheKey(storageKey(key));
      return undefined;
    },
    initialDataUpdatedAt: () => {
      return readEnvelope(key)?.t;
    },
    staleTime: ttlMs,
    refetchInterval: refetchIntervalMs ?? false,
    refetchIntervalInBackground: false,   // pausiert, solange der Tab nicht sichtbar ist
    retry: 1,
  });
}
