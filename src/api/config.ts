import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type DefinedUseQueryResult,
} from "@tanstack/react-query";
import { configSchema, type Config } from "../config/schema";
import { readLocalConfig, writeLocalConfig } from "../config/local";
import type { ProfileId } from "../config/schema";
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

export function useConfig(profileId: ProfileId, options: { enabled?: boolean } = {}): DefinedUseQueryResult<Config> & { configReady: boolean } {
  const queryKey = ["config", profileId];
  const url = profileApiUrl("/api/config", profileId);
  const localConfig = readLocalConfig(profileId);
  const initialConfig = localConfig ?? defaultConfig;

  const query = useQuery<Config>({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await fetch(url, { signal });
      throwIfAborted(signal);
      if (!res.ok) throw new Error("Config nicht ladbar");
      const parsed = configSchema.safeParse(await res.json());
      throwIfAborted(signal);
      if (!parsed.success) throw new Error("Ungültige Config");
      writeLocalConfig(profileId, parsed.data);
      return parsed.data;
    },
    initialData: initialConfig,
    // The default is only a render fallback. Marking the initial value stale is
    // essential when a newly selected profile has no local snapshot yet: its
    // server Config must be requested immediately instead of waiting 30 seconds.
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
    enabled: options.enabled ?? true,
    // Local Storage liefert sofort ein sichtbares Bild, ist aber keine Aussage
    // darüber, ob der Serverstand noch aktuell ist.
    refetchOnMount: "always",
    refetchInterval: 15_000,              // Sync zwischen Geräten
    refetchIntervalInBackground: false,   // pausiert im versteckten Tab
    refetchOnWindowFocus: "always",
    retry: 1,
  });

  return {
    ...query,
    configReady: localConfig !== undefined || (query.isFetched && query.isSuccess),
  };
}

function compareRevision(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  return left.localeCompare(right);
}

function isProfileDataSourceKey(key: string, profileId: ProfileId, config: Config): boolean {
  const prefix = `profile:${profileId}:`;
  if (!key.startsWith(prefix)) return false;
  const sourceKey = key.slice(prefix.length);
  return (config.homelab.enabled && sourceKey === "pve") || sourceKey.startsWith("wx:") ||
    sourceKey.startsWith("cal:") || sourceKey.startsWith("news:");
}

export function useSaveConfig(profileId: ProfileId): UseMutationResult<Config, Error, Config> {
  const qc = useQueryClient();
  const queryKey = ["config", profileId];
  const url = profileApiUrl("/api/config", profileId);

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
      const cached = qc.getQueryData<Config>(queryKey);
      const local = readLocalConfig(profileId);
      let freshest = cfg;
      if (cached !== undefined && compareRevision(cached.updatedAt, freshest.updatedAt) > 0) {
        freshest = cached;
      }
      if (local !== undefined && compareRevision(local.updatedAt, freshest.updatedAt) > 0) {
        freshest = local;
      }
      writeLocalConfig(profileId, freshest);
      qc.setQueryData(queryKey, freshest);
      void qc.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          if (typeof key !== "string") return false;
          return isProfileDataSourceKey(key, profileId, freshest);
        },
      });
    },
  });
}
