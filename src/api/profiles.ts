import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";
import {
  profileCatalogSchema,
  readLocalCatalog,
  writeLocalCatalog,
  type ProfileCatalog,
} from "../config/local";
import { profileIdSchema, type ProfileId } from "../config/schema";

export type { ProfileCatalog } from "../config/local";

export type CreateProfileInput = {
  name: string;
  sourceProfileId: ProfileId;
  profilesUpdatedAt: string;
};

export type RenameProfileInput = {
  profileId: ProfileId;
  name: string;
  profilesUpdatedAt: string;
};

export type DeleteProfileInput = {
  profileId: ProfileId;
  profilesUpdatedAt: string;
};

export type CatalogMutationData = {
  catalog: ProfileCatalog;
  createdId?: ProfileId;
};

export class ProfileConflictError extends Error {
  readonly current: string | undefined;

  constructor(current: string | undefined) {
    super("conflict");
    this.name = "ProfileConflictError";
    this.current = current;
  }
}

export { ProfileConflictError as CatalogConflictError };

const catalogMutationResponseSchema = z.object({
  catalog: profileCatalogSchema,
  createdId: profileIdSchema.optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

async function conflictRevision(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    return isRecord(body) && typeof body.current === "string" ? body.current : undefined;
  } catch {
    return undefined;
  }
}

async function parseCatalogMutation(response: Response): Promise<CatalogMutationData> {
  if (response.status === 409) throw new ProfileConflictError(await conflictRevision(response));
  if (!response.ok) throw new Error("Profiländerung fehlgeschlagen");
  const parsed = catalogMutationResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Ungültige Profilantwort");
  return parsed.data;
}

async function updateCatalogCache(queryClient: ReturnType<typeof useQueryClient>, catalog: ProfileCatalog): Promise<void> {
  // A poll that started before a catalog mutation must not restore an older revision.
  await queryClient.cancelQueries({ queryKey: ["profiles"] });
  writeLocalCatalog(catalog);
  queryClient.setQueryData(["profiles"], catalog);
}

export function useProfiles(): UseQueryResult<ProfileCatalog> {
  return useQuery<ProfileCatalog>({
    queryKey: ["profiles"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/profiles", { signal });
      throwIfAborted(signal);
      if (!response.ok) throw new Error("Profile nicht ladbar");
      const parsed = profileCatalogSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Ungültiger Profilkatalog");
      writeLocalCatalog(parsed.data);
      return parsed.data;
    },
    initialData: () => readLocalCatalog(),
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    retry: 1,
  });
}

export function useCreateProfile(): UseMutationResult<CatalogMutationData, Error, CreateProfileInput> {
  const queryClient = useQueryClient();
  return useMutation<CatalogMutationData, Error, CreateProfileInput>({
    mutationFn: async (input) => parseCatalogMutation(await fetch("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json", "If-Match": input.profilesUpdatedAt },
      body: JSON.stringify({ name: input.name, sourceProfileId: input.sourceProfileId }),
    })),
    onSuccess: ({ catalog }) => updateCatalogCache(queryClient, catalog),
  });
}

export function useRenameProfile(): UseMutationResult<CatalogMutationData, Error, RenameProfileInput> {
  const queryClient = useQueryClient();
  return useMutation<CatalogMutationData, Error, RenameProfileInput>({
    mutationFn: async (input) => parseCatalogMutation(await fetch(`/api/profiles/${encodeURIComponent(input.profileId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "If-Match": input.profilesUpdatedAt },
      body: JSON.stringify({ name: input.name }),
    })),
    onSuccess: ({ catalog }) => updateCatalogCache(queryClient, catalog),
  });
}

export function useDeleteProfile(): UseMutationResult<CatalogMutationData, Error, DeleteProfileInput> {
  const queryClient = useQueryClient();
  return useMutation<CatalogMutationData, Error, DeleteProfileInput>({
    mutationFn: async (input) => parseCatalogMutation(await fetch(`/api/profiles/${encodeURIComponent(input.profileId)}`, {
      method: "DELETE",
      headers: { "If-Match": input.profilesUpdatedAt },
    })),
    onSuccess: ({ catalog }) => updateCatalogCache(queryClient, catalog),
  });
}
