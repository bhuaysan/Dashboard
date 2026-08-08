import { useQuery } from "@tanstack/react-query";

const CACHE_VERSION = 1;

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

function readEnvelope(key: string): CacheEnvelope | undefined {
  try {
    const raw = localStorage.getItem(`dashboard:cache:${key}`);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== CACHE_VERSION ||
        typeof parsed.t !== "number" || !Number.isFinite(parsed.t) || !("data" in parsed)) {
      localStorage.removeItem(`dashboard:cache:${key}`);
      return undefined;
    }
    return { version: CACHE_VERSION, t: parsed.t, data: parsed.data };
  } catch {
    try { localStorage.removeItem(`dashboard:cache:${key}`); } catch { /* Speicher nicht verfügbar */ }
    return undefined;
  }
}

export function useCachedQuery<T>(key: string, fn: () => Promise<T>, ttlMs: number, options: Options<T> = {}) {
  const { refetchIntervalMs, decode } = options;
  return useQuery<T>({
    queryKey: [key],
    queryFn: async () => {
      const data = await fn();
      try { localStorage.setItem(`dashboard:cache:${key}`,
              JSON.stringify({ version: CACHE_VERSION, t: Date.now(), data })); } catch {}
      return data;
    },
    initialData: () => {
      const envelope = readEnvelope(key);
      if (envelope === undefined || decode === undefined) return undefined;
      const data = decode(envelope.data);
      if (data !== undefined) return data;
      try { localStorage.removeItem(`dashboard:cache:${key}`); } catch { /* Speicher nicht verfügbar */ }
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
