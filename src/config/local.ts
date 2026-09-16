import { z } from "zod";
import { configSchema, profileIdSchema, profileMetaSchema, type Config, type ProfileId, type ProfileMeta, DEFAULT_PROFILE_ID } from "./schema";

const ACTIVE_PROFILE_KEY = "dashboard:active-profile";
const CATALOG_KEY = "dashboard:profiles";
const CONFIG_KEY_PREFIX = "dashboard:config:";
const LEGACY_CONFIG_KEY = "dashboard:config";

const profileCatalogSchema = z.object({
  profilesUpdatedAt: z.string().datetime({ offset: true }),
  profiles: z.array(profileMetaSchema).min(1).max(16),
}).superRefine((catalog, ctx) => {
  const ids = new Set<string>();
  const names = new Set<string>();
  catalog.profiles.forEach((profile, index) => {
    if (ids.has(profile.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["profiles", index, "id"], message: "Profil-ID darf nur einmal vorkommen" });
    }
    ids.add(profile.id);
    const normalizedName = profile.name.toLocaleLowerCase("de-DE");
    if (names.has(normalizedName)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["profiles", index, "name"], message: "Profilname darf nur einmal vorkommen" });
    }
    names.add(normalizedName);
  });
});

export type ProfileCatalog = {
  profilesUpdatedAt: string;
  profiles: ProfileMeta[];
};

export { profileCatalogSchema };

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function compareRevision(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  return left.localeCompare(right);
}

function removeRaw(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // localStorage kann im privaten Modus oder bei vollem Speicher ausfallen.
  }
}

function decodeConfig(raw: string | null): Config | undefined {
  if (raw === null) return undefined;
  try {
    const parsed = configSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function configStorageKey(profileId: ProfileId): string {
  return `${CONFIG_KEY_PREFIX}${profileId}`;
}

export function readActiveProfileId(): ProfileId | undefined {
  const parsed = profileIdSchema.safeParse(readRaw(ACTIVE_PROFILE_KEY));
  return parsed.success ? parsed.data : undefined;
}

export function writeActiveProfileId(profileId: ProfileId): void {
  if (!profileIdSchema.safeParse(profileId).success) return;
  writeRaw(ACTIVE_PROFILE_KEY, profileId);
}

export function readLocalCatalog(): ProfileCatalog | undefined {
  const raw = readRaw(CATALOG_KEY);
  if (raw === null) return undefined;
  try {
    const parsed = profileCatalogSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeLocalCatalog(catalog: ProfileCatalog): void {
  const parsed = profileCatalogSchema.safeParse(catalog);
  if (!parsed.success) return;
  try {
    const current = readLocalCatalog();
    if (current !== undefined && compareRevision(current.profilesUpdatedAt, parsed.data.profilesUpdatedAt) > 0) return;
    writeRaw(CATALOG_KEY, JSON.stringify(parsed.data));
  } catch {
    // JSON.stringify kann bei Laufzeitwerten außerhalb des Schemas scheitern.
  }
}

export function readLocalConfig(profileId: ProfileId = DEFAULT_PROFILE_ID): Config | undefined {
  if (!profileIdSchema.safeParse(profileId).success) return undefined;

  const config = decodeConfig(readRaw(configStorageKey(profileId)));
  if (config !== undefined) return config;

  // Ein Upgrade übernimmt den alten Einzel-Cache genau einmal in den reservierten
  // Default-Schlüssel. Der alte Eintrag wird erst entfernt, nachdem der neue sicher
  // geschrieben wurde; fremde localStorage-Einträge bleiben unberührt.
  if (profileId !== DEFAULT_PROFILE_ID) return undefined;
  const legacy = decodeConfig(readRaw(LEGACY_CONFIG_KEY));
  if (legacy === undefined) return undefined;
  try {
    const serialized = JSON.stringify(legacy);
    if (writeRaw(configStorageKey(DEFAULT_PROFILE_ID), serialized)) removeRaw(LEGACY_CONFIG_KEY);
  } catch {
    // Der gültige Legacy-Wert bleibt lesbar, auch wenn das Kopieren scheitert.
  }
  return legacy;
}

export function writeLocalConfig(profileId: ProfileId, config: Config): void {
  if (!profileIdSchema.safeParse(profileId).success) return;
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) return;
  try {
    const current = readLocalConfig(profileId);
    if (current !== undefined && compareRevision(current.updatedAt, parsed.data.updatedAt) > 0) return;
    writeRaw(configStorageKey(profileId), JSON.stringify(parsed.data));
  } catch {
    // Speicher voll oder ein nicht serialisierbarer Laufzeitwert: Cache ignorieren.
  }
}
