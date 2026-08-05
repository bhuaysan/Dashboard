import { useQuery } from "@tanstack/react-query";

export function useCachedQuery<T>(key: string, fn: () => Promise<T>, ttlMs: number) {
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
        return raw ? (JSON.parse(raw).data as T) : undefined;
      } catch { return undefined; }
    },
    staleTime: ttlMs,
    retry: 1,
  });
}
