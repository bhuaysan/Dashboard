import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type DefinedUseQueryResult,
} from "@tanstack/react-query";
import { configSchema, type Config } from "../config/schema";
import { readLocalConfig, writeLocalConfig } from "../config/local";
import { DEFAULT_PROFILE_ID, type ProfileId } from "../config/schema";
import { defaultConfig } from "../config/defaults";
import { profileApiUrl } from "./profileUrl";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

async function conflictRevision(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.json();
    return isRecord(body) && typeof body.current === "string" ? body.current : undefined;
  } catch {
    return undefined;
  }
}

export function useConfig(profileId: ProfileId): DefinedUseQueryResult<Config>;
export function useConfig(): DefinedUseQueryResult<Config>;
export function useConfig(profileId?: ProfileId): DefinedUseQueryResult<Config> {
  const resolvedProfileId = profileId ?? DEFAULT_PROFILE_ID;
  // Keep the no-argument form available while App is migrated in the next task.
  // Explicit profile IDs always use the profile-aware query key and URL.
  const legacyCall = profileId === undefined;
  const queryKey = legacyCall ? ["config"] : ["config", resolvedProfileId];
  const url = legacyCall ? "/api/config" : profileApiUrl("/api/config", resolvedProfileId);
  const initialConfig = readLocalConfig(resolvedProfileId) ?? defaultConfig;

  return useQuery<Config>({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await fetch(url, { signal });
      throwIfAborted(signal);
      if (!res.ok) throw new Error("Config nicht ladbar");
      const parsed = configSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("Ungültige Config");
      writeLocalConfig(resolvedProfileId, parsed.data);
      return parsed.data;
    },
    initialData: initialConfig,
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

function isProfileDataSourceKey(key: string, profileId: ProfileId, config: Config): boolean {
  const prefix = `profile:${profileId}:`;
  if (!key.startsWith(prefix)) return false;
  const sourceKey = key.slice(prefix.length);
  return (config.homelab.enabled && sourceKey === "pve") || sourceKey.startsWith("wx:") ||
    sourceKey.startsWith("cal:") || sourceKey.startsWith("news:");
}

function isLegacyDataSourceKey(key: string, config: Config): boolean {
  return (config.homelab.enabled && key === "pve") || key.startsWith("wx:") ||
    key.startsWith("cal:") || key.startsWith("news:");
}

export function useSaveConfig(profileId: ProfileId): UseMutationResult<Config, Error, Config>;
export function useSaveConfig(): UseMutationResult<Config, Error, Config>;
export function useSaveConfig(profileId?: ProfileId): UseMutationResult<Config, Error, Config> {
  const qc = useQueryClient();
  const resolvedProfileId = profileId ?? DEFAULT_PROFILE_ID;
  const legacyCall = profileId === undefined;
  const queryKey = legacyCall ? ["config"] : ["config", resolvedProfileId];
  const url = legacyCall ? "/api/config" : profileApiUrl("/api/config", resolvedProfileId);

  return useMutation<Config, Error, Config>({
    mutationFn: async (next: Config): Promise<Config> => {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json", "If-Match": next.updatedAt },
        body: JSON.stringify(next),
      });
      if (res.status === 409) {
        throw new ConfigConflictError(await conflictRevision(res));
      }
      if (!res.ok) throw new Error("Speichern fehlgeschlagen");
      const parsed = configSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("Ungültige Config");
      return parsed.data;
    },
    onSuccess: async (cfg) => {
      // Ein Poll, der vor dem PUT begonnen hat, darf danach weder Query-Cache noch
      // localStorage mit der alten Revision überschreiben.
      await qc.cancelQueries({ queryKey });
      writeLocalConfig(resolvedProfileId, cfg);
      qc.setQueryData(queryKey, cfg);
      void qc.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          if (typeof key !== "string") return false;
          return legacyCall
            ? isLegacyDataSourceKey(key, cfg)
            : isProfileDataSourceKey(key, resolvedProfileId, cfg);
        },
      });
    },
  });
}
