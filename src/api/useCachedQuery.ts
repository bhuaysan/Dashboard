import { useQuery } from "@tanstack/react-query";

type Options<T> = {
  refetchIntervalMs?: number;
  revive?: (data: T) => T;   // Datumsfelder o.ä. aus dem JSON-Cache zurückverwandeln
};

export function useCachedQuery<T>(key: string, fn: () => Promise<T>, ttlMs: number, options: Options<T> = {}) {
  const { refetchIntervalMs, revive } = options;
  return useQuery<T>({
    queryKey: [key],
    queryFn: async () => {
      const data = await fn();
      try { localStorage.setItem(`dashboard:cache:${key}`,
              JSON.stringify({ t: Date.now(), data })); } catch {}
      return data;
    },
    initialData: () => {
      try {
        const raw = localStorage.getItem(`dashboard:cache:${key}`);
        if (!raw) return undefined;
        const data = JSON.parse(raw).data as T;
        return revive ? revive(data) : data;
      } catch { return undefined; }
    },
    initialDataUpdatedAt: () => {
      try {
        const raw = localStorage.getItem(`dashboard:cache:${key}`);
        return raw ? (JSON.parse(raw).t as number) : undefined;
      } catch { return undefined; }
    },
    staleTime: ttlMs,
    refetchInterval: refetchIntervalMs ?? false,
    refetchIntervalInBackground: false,   // pausiert, solange der Tab nicht sichtbar ist
    retry: 1,
  });
}
