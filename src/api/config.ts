import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { configSchema, type Config } from "../config/schema";
import { readLocalConfig, writeLocalConfig } from "../config/local";
import { defaultConfig } from "../config/defaults";

export class ConfigConflictError extends Error {
  // Der Stand, den der Server tatsächlich hat — die UI darf ihn anzeigen oder neu laden,
  // aber nicht stillschweigend in den alten Entwurf übernehmen.
  readonly current: string | undefined;
  constructor(current: string | undefined) {
    super("conflict");
    this.name = "ConfigConflictError";
    this.current = current;
  }
}

export function useConfig() {
  return useQuery<Config>({
    queryKey: ["config"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/config", { signal });
      if (!res.ok) throw new Error("Config nicht ladbar");
      const parsed = configSchema.parse(await res.json());
      writeLocalConfig(parsed);
      return parsed;
    },
    initialData: () => readLocalConfig() ?? defaultConfig,
    staleTime: 30_000,
    // Local Storage liefert sofort ein sichtbares Bild, ist aber keine Aussage
    // darüber, ob der Serverstand noch aktuell ist.
    refetchOnMount: "always",
    refetchInterval: 15_000,              // Sync zwischen Geräten
    refetchIntervalInBackground: false,   // pausiert im versteckten Tab
    refetchOnWindowFocus: "always",
    retry: 1,
  });
}

export function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: Config): Promise<Config> => {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json", "If-Match": next.updatedAt },
        body: JSON.stringify(next),
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => undefined) as { current?: unknown } | undefined;
        throw new ConfigConflictError(typeof body?.current === "string" ? body.current : undefined);
      }
      if (!res.ok) throw new Error("Speichern fehlgeschlagen");
      return configSchema.parse(await res.json());
    },
    onSuccess: async (cfg) => {
      // Ein Poll, der vor dem PUT begonnen hat, darf danach weder Query-Cache noch
      // localStorage mit der alten Revision überschreiben.
      await qc.cancelQueries({ queryKey: ["config"] });
      writeLocalConfig(cfg);
      qc.setQueryData(["config"], cfg);
      void qc.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && (
            key === "pve" || key.startsWith("wx:") ||
            key.startsWith("cal:") || key.startsWith("news:")
          );
        },
      });
    },
  });
}
