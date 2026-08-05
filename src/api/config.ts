import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { configSchema, type Config } from "../config/schema";
import { readLocalConfig, writeLocalConfig } from "../config/local";
import { defaultConfig } from "../config/defaults";

export class ConfigConflictError extends Error {
  constructor() {
    super("conflict");
    this.name = "ConfigConflictError";
  }
}

export function useConfig() {
  return useQuery<Config>({
    queryKey: ["config"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Config nicht ladbar");
      const parsed = configSchema.parse(await res.json());
      writeLocalConfig(parsed);
      return parsed;
    },
    initialData: () => readLocalConfig() ?? defaultConfig,
    staleTime: 30_000,
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
      if (res.status === 409) throw new ConfigConflictError();
      if (!res.ok) throw new Error("Speichern fehlgeschlagen");
      return configSchema.parse(await res.json());
    },
    onSuccess: (cfg) => {
      writeLocalConfig(cfg);
      qc.setQueryData(["config"], cfg);
    },
  });
}
