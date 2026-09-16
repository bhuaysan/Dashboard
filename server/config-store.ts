import { randomUUID } from "node:crypto";
import { copyFile, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { ZodIssue } from "zod";
import {
  configSchema,
  DEFAULT_PROFILE_ID,
  PANE_IDS,
  profileDocumentSchema,
  profileIdSchema,
  profileMetaSchema,
  type Config,
  type ProfileDocument,
  type ProfileId,
  type ProfileMeta,
} from "../src/config/schema.ts";
import { defaultConfig, defaultProfileDocument } from "../src/config/defaults.ts";

const KEEP_BACKUPS = 7;
const MAX_PROFILES = 16;
export const MAX_CONFIG_BYTES = 512 * 1024;

// Panes, die das Schema nicht mehr kennt (z. B. "music" nach dessen Entfernung), lässt das
// enum in configSchema sonst am ganzen layout-Array scheitern — nicht nur an dem einen
// veralteten Eintrag. Deshalb hier herausfiltern, bevor die Live-Config überhaupt geparst wird.
const KNOWN_PANE_IDS = new Set<string>(PANE_IDS);

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function dropUnknownPanesFromConfig(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.layout)) return raw;
  return {
    ...raw,
    layout: raw.layout.filter((entry) =>
      isRecord(entry) && typeof entry.id === "string" && KNOWN_PANE_IDS.has(entry.id),
    ),
  };
}

function dropUnknownPanes(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  if (!Array.isArray(raw.profiles)) return dropUnknownPanesFromConfig(raw);
  return {
    ...raw,
    profiles: raw.profiles.map((profile) => {
      if (!isRecord(profile)) return profile;
      return { ...profile, config: dropUnknownPanesFromConfig(profile.config) };
    }),
  };
}

function addMissingPanes(config: Config): Config {
  const normalized = clone(config);
  const layout = normalized.layout.map((entry) => clone(entry));
  for (const defaultEntry of defaultConfig.layout) {
    if (!layout.some((entry) => entry.id === defaultEntry.id)) {
      layout.push(clone(defaultEntry));
    }
  }
  normalized.layout = layout;
  return normalized;
}

function normalizeDocument(document: ProfileDocument): ProfileDocument {
  const normalized = clone(document);
  normalized.profiles = normalized.profiles.map((profile) => ({
    ...profile,
    config: addMissingPanes(profile.config),
  }));
  return normalized;
}

function freshDefaultDocument(): ProfileDocument {
  return normalizeDocument(clone(defaultProfileDocument));
}

function catalogFromDocument(document: ProfileDocument): ProfileCatalog {
  return {
    profilesUpdatedAt: document.profilesUpdatedAt,
    profiles: document.profiles.map(({ id, name }) => ({ id, name })),
  };
}

function customIssue(message: string, path: Array<string | number> = []): ZodIssue {
  return { code: "custom", path, message };
}

export class ConfigStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConfigStoreError";
  }
}

export class ConfigTooLargeError extends ConfigStoreError {
  constructor() {
    super("Config-Datei ist zu groß");
    this.name = "ConfigTooLargeError";
  }
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function describeStoreError(message: string, error: unknown): ConfigStoreError {
  return new ConfigStoreError(message, { cause: error });
}

export async function writeAtomic(path: string, data: string): Promise<void> {
  if (Buffer.byteLength(data, "utf8") > MAX_CONFIG_BYTES) {
    throw new ConfigTooLargeError();
  }
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let renamed = false;
  try {
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, path);        // rename ist atomar, halbe Dateien unmöglich
    renamed = true;
  } catch (error) {
    throw describeStoreError("Config-Datei konnte nicht geschrieben werden", error);
  } finally {
    if (!renamed) {
      try { await unlink(tmp); } catch { /* best effort: der ursprüngliche Fehler bleibt maßgeblich */ }
    }
  }
}

export type ProfileCatalog = {
  profilesUpdatedAt: string;
  profiles: ProfileMeta[];
};

export type ConfigReadResult =
  | { kind: "ok"; config: Config }
  | { kind: "not-found" };

export type CatalogMutationResult =
  | { kind: "ok"; catalog: ProfileCatalog; createdId?: ProfileId }
  | { kind: "conflict"; current: string }
  | { kind: "not-found" }
  | { kind: "invalid"; issues: ZodIssue[] }
  | { kind: "last-profile" };

export type ConfigUpdateResult =
  | { kind: "ok"; config: Config }
  | { kind: "conflict"; current: string }
  | { kind: "invalid"; issues: ZodIssue[] };

export type ProfileConfigUpdateResult = ConfigUpdateResult | { kind: "not-found" };

export type CreateProfileFunction = {
  (ifMatch: string | undefined, name: unknown, sourceProfileId: unknown): Promise<CatalogMutationResult>;
  (ifMatch: string | undefined, input: { name: unknown; sourceProfileId: unknown }): Promise<CatalogMutationResult>;
};

export type RenameProfileFunction = {
  (profileId: ProfileId, ifMatch: string | undefined, name: unknown): Promise<CatalogMutationResult>;
  (profileId: ProfileId, ifMatch: string | undefined, input: { name: unknown }): Promise<CatalogMutationResult>;
};

export type UpdateConfigFunction = {
  (profileId: ProfileId, ifMatch: string | undefined, candidate: unknown): Promise<ProfileConfigUpdateResult>;
  (ifMatch: string | undefined, candidate: unknown): Promise<ConfigUpdateResult>;
};

type CreateProfileArgs =
  | [ifMatch: string | undefined, name: unknown, sourceProfileId: unknown]
  | [ifMatch: string | undefined, input: { name: unknown; sourceProfileId: unknown }];

type UpdateConfigArgs =
  | [profileId: ProfileId, ifMatch: string | undefined, candidate: unknown]
  | [ifMatch: string | undefined, candidate: unknown];

export type ConfigStore = {
  // Compatibility methods remain available while the profile-aware routes are migrated.
  readConfig: () => Promise<Config>;
  writeConfig: (cfg: Config) => Promise<void>;
  readCatalog: () => Promise<ProfileCatalog>;
  readProfileConfig: (profileId: ProfileId) => Promise<ConfigReadResult>;
  createProfile: CreateProfileFunction;
  renameProfile: RenameProfileFunction;
  deleteProfile: (profileId: ProfileId, ifMatch: string | undefined) => Promise<CatalogMutationResult>;
  updateConfig: UpdateConfigFunction;
};

export function createConfigStore(configPath: string): ConfigStore {
  async function preserveBrokenConfig(): Promise<void> {
    try {
      await copyFile(configPath, `${configPath}.bak`);
    } catch (error) {
      throw describeStoreError("Beschädigte Config konnte nicht gesichert werden", error);
    }
  }

  async function readDocumentUnlocked(): Promise<ProfileDocument> {
    try {
      const info = await stat(configPath);
      if (info.size > MAX_CONFIG_BYTES) {
        throw new ConfigStoreError("Config-Datei ist zu groß");
      }
    } catch (error) {
      if (isMissing(error)) return freshDefaultDocument();
      if (error instanceof ConfigStoreError) throw error;
      throw describeStoreError("Config-Datei nicht lesbar", error);
    }

    let text: string;
    try {
      text = await readFile(configPath, "utf8");
    } catch (error) {
      if (isMissing(error)) return freshDefaultDocument();
      throw describeStoreError("Config-Datei nicht lesbar", error);
    }
    if (Buffer.byteLength(text, "utf8") > MAX_CONFIG_BYTES) {
      throw new ConfigStoreError("Config-Datei ist zu groß");
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      await preserveBrokenConfig();
      if (error instanceof SyntaxError) return freshDefaultDocument();
      throw describeStoreError("Config-Datei konnte nicht gelesen werden", error);
    }

    const normalizedRaw = dropUnknownPanes(raw);
    const parsedDocument = profileDocumentSchema.safeParse(normalizedRaw);
    if (parsedDocument.success) {
      return normalizeDocument(parsedDocument.data);
    }

    const parsedLegacy = configSchema.safeParse(normalizedRaw);
    if (parsedLegacy.success) {
      const defaults = freshDefaultDocument();
      return {
        ...defaults,
        profiles: [{
          id: DEFAULT_PROFILE_ID,
          name: "Standard",
          config: addMissingPanes(parsedLegacy.data),
        }],
      };
    }

    await preserveBrokenConfig();
    return freshDefaultDocument();
  }

  // Alle Schreibvorgänge dieses Stores laufen durch dieselbe Promise-Queue. Das ist auch
  // für mehrere App-Instanzen im Test nützlich: kein globaler Prozesszustand wird geteilt.
  let writeQueue: Promise<void> = Promise.resolve();

  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function keepPreviousVersion(previousDocument: ProfileDocument): Promise<void> {
    let currentExists = true;
    try {
      await stat(configPath);
    } catch (error) {
      if (isMissing(error)) {
        currentExists = false;
      } else {
        throw describeStoreError("Config-Datei nicht lesbar", error);
      }
    }

    let serializedPrevious: string | undefined;
    if (currentExists) {
      const normalizedPrevious = normalizeDocument(previousDocument);
      serializedPrevious = JSON.stringify(normalizedPrevious, null, 2);
      // Validate every serialized representation before moving any backup. This keeps a
      // rejected write from changing the backup chain as well as the active file.
      if (Buffer.byteLength(serializedPrevious, "utf8") > MAX_CONFIG_BYTES) {
        serializedPrevious = JSON.stringify(normalizedPrevious);
        if (Buffer.byteLength(serializedPrevious, "utf8") > MAX_CONFIG_BYTES) {
          throw new ConfigTooLargeError();
        }
      }
    }

    for (let i = KEEP_BACKUPS - 1; i >= 1; i -= 1) {
      try {
        await rename(`${configPath}.${i}`, `${configPath}.${i + 1}`);
      } catch (error) {
        if (!isMissing(error)) {
          throw describeStoreError(`Sicherung ${i} nicht verschiebbar`, error);
        }
      }
    }
    if (serializedPrevious === undefined) return;
    try {
      await writeFile(`${configPath}.1`, serializedPrevious, { mode: 0o600 });
    } catch (error) {
      if (!isMissing(error)) {
        throw describeStoreError("Sicherung nicht anlegbar", error);
      }
    }
  }

  async function writeDocumentUnlocked(document: ProfileDocument, previousDocument: ProfileDocument): Promise<ProfileDocument> {
    const parsed = profileDocumentSchema.safeParse(document);
    if (!parsed.success) {
      throw new ConfigStoreError("Config-Dokument ist ungültig");
    }
    const normalized = normalizeDocument(parsed.data);
    const serializedDocument = JSON.stringify(normalized, null, 2);
    // Die Größenprüfung muss vor jeder Backup-Rotation stattfinden: ein abgewiesener
    // Schreibvorgang darf weder die aktive Datei noch ihre Sicherungen verändern.
    if (Buffer.byteLength(serializedDocument, "utf8") > MAX_CONFIG_BYTES) {
      throw new ConfigTooLargeError();
    }
    await keepPreviousVersion(previousDocument);
    await writeAtomic(configPath, serializedDocument);
    return normalized;
  }

  function nextRevision(previous: string): string {
    const previousMs = Date.parse(previous);
    const now = Date.now();
    const minimum = Number.isFinite(previousMs) ? previousMs + 1 : now;
    return new Date(Math.max(now, minimum)).toISOString();
  }

  function profileIdIssues(value: unknown): ZodIssue[] | ProfileId {
    const parsed = profileIdSchema.safeParse(value);
    return parsed.success ? parsed.data : parsed.error.issues;
  }

  function profileName(value: unknown, id: ProfileId): { name: string } | { issues: ZodIssue[] } {
    const parsed = profileMetaSchema.safeParse({ id, name: value });
    return parsed.success ? { name: parsed.data.name } : { issues: parsed.error.issues };
  }

  async function readCatalog(): Promise<ProfileCatalog> {
    return catalogFromDocument(await readDocumentUnlocked());
  }

  async function readProfileConfig(profileId: ProfileId): Promise<ConfigReadResult> {
    const document = await readDocumentUnlocked();
    const profile = document.profiles.find((entry) => entry.id === profileId);
    if (profile === undefined) return { kind: "not-found" };
    return { kind: "ok", config: clone(profile.config) };
  }

  async function createProfile(ifMatch: string | undefined, name: unknown, sourceProfileId: unknown): Promise<CatalogMutationResult>;
  async function createProfile(ifMatch: string | undefined, input: { name: unknown; sourceProfileId: unknown }): Promise<CatalogMutationResult>;
  async function createProfile(...args: CreateProfileArgs): Promise<CatalogMutationResult> {
    return serialized(async () => {
    let ifMatch: string | undefined;
    let name: unknown;
    let sourceProfileId: unknown;
    if (args.length === 2) {
      ifMatch = args[0];
      const input = args[1];
      if (!isRecord(input)) return { kind: "invalid", issues: [customIssue("Ungültige Profildaten")] };
      name = input.name;
      sourceProfileId = input.sourceProfileId;
    } else {
      ifMatch = args[0];
      name = args[1];
      sourceProfileId = args[2];
    }

    const document = await readDocumentUnlocked();
    if (ifMatch !== document.profilesUpdatedAt) {
      return { kind: "conflict", current: document.profilesUpdatedAt };
    }

    const sourceId = profileIdIssues(sourceProfileId);
    if (Array.isArray(sourceId)) return { kind: "invalid", issues: sourceId };
    const source = document.profiles.find((entry) => entry.id === sourceId);
    if (source === undefined) return { kind: "not-found" };

    if (document.profiles.length >= MAX_PROFILES) {
      return { kind: "invalid", issues: [customIssue("Es sind höchstens 16 Profile erlaubt", ["profiles"])] };
    }

    const generatedId = profileIdIssues(randomUUID());
    if (Array.isArray(generatedId)) return { kind: "invalid", issues: generatedId };
    const parsedName = profileName(name, generatedId);
    if ("issues" in parsedName) return { kind: "invalid", issues: parsedName.issues };
    const normalizedName = parsedName.name.toLocaleLowerCase("de-DE");
    if (document.profiles.some((entry) => entry.name.toLocaleLowerCase("de-DE") === normalizedName)) {
      return { kind: "invalid", issues: [customIssue("Profilname darf nur einmal vorkommen", ["name"])] };
    }

    const copiedConfig = clone(source.config);
    copiedConfig.updatedAt = nextRevision(source.config.updatedAt);
    const nextDocument = clone(document);
    nextDocument.profiles.push({ id: generatedId, name: parsedName.name, config: copiedConfig });
    nextDocument.profilesUpdatedAt = nextRevision(document.profilesUpdatedAt);
    const parsedDocument = profileDocumentSchema.safeParse(nextDocument);
    if (!parsedDocument.success) return { kind: "invalid", issues: parsedDocument.error.issues };
    const persisted = await writeDocumentUnlocked(parsedDocument.data, document);
    return { kind: "ok", catalog: catalogFromDocument(persisted), createdId: generatedId };
    });
  }

  const renameProfile: RenameProfileFunction = async (profileId, ifMatch, input) => serialized(async () => {
    const document = await readDocumentUnlocked();
    if (ifMatch !== document.profilesUpdatedAt) {
      return { kind: "conflict", current: document.profilesUpdatedAt };
    }
    const parsedId = profileIdIssues(profileId);
    if (Array.isArray(parsedId)) return { kind: "invalid", issues: parsedId };
    const profileIndex = document.profiles.findIndex((entry) => entry.id === parsedId);
    if (profileIndex < 0) return { kind: "not-found" };
    const name = isRecord(input) && "name" in input ? input.name : input;
    const parsedName = profileName(name, parsedId);
    if ("issues" in parsedName) return { kind: "invalid", issues: parsedName.issues };
    const normalizedName = parsedName.name.toLocaleLowerCase("de-DE");
    if (document.profiles.some((entry, index) => index !== profileIndex && entry.name.toLocaleLowerCase("de-DE") === normalizedName)) {
      return { kind: "invalid", issues: [customIssue("Profilname darf nur einmal vorkommen", ["name"])] };
    }

    const nextDocument = clone(document);
    const profile = nextDocument.profiles[profileIndex];
    if (profile === undefined) return { kind: "not-found" };
    profile.name = parsedName.name;
    nextDocument.profilesUpdatedAt = nextRevision(document.profilesUpdatedAt);
    const parsedDocument = profileDocumentSchema.safeParse(nextDocument);
    if (!parsedDocument.success) return { kind: "invalid", issues: parsedDocument.error.issues };
    const persisted = await writeDocumentUnlocked(parsedDocument.data, document);
    return { kind: "ok", catalog: catalogFromDocument(persisted) };
  });

  async function deleteProfile(profileId: ProfileId, ifMatch: string | undefined): Promise<CatalogMutationResult> {
    return serialized(async () => {
      const document = await readDocumentUnlocked();
      const parsedId = profileIdIssues(profileId);
      if (Array.isArray(parsedId)) return { kind: "invalid", issues: parsedId };
      const profileIndex = document.profiles.findIndex((entry) => entry.id === parsedId);
      if (profileIndex < 0) return { kind: "not-found" };
      if (document.profiles.length <= 1) return { kind: "last-profile" };
      if (ifMatch !== document.profilesUpdatedAt) {
        return { kind: "conflict", current: document.profilesUpdatedAt };
      }

      const nextDocument = clone(document);
      nextDocument.profiles.splice(profileIndex, 1);
      nextDocument.profilesUpdatedAt = nextRevision(document.profilesUpdatedAt);
      const parsedDocument = profileDocumentSchema.safeParse(nextDocument);
      if (!parsedDocument.success) return { kind: "invalid", issues: parsedDocument.error.issues };
      const persisted = await writeDocumentUnlocked(parsedDocument.data, document);
      return { kind: "ok", catalog: catalogFromDocument(persisted) };
    });
  }

  async function updateConfig(profileId: ProfileId, ifMatch: string | undefined, candidate: unknown): Promise<ProfileConfigUpdateResult>;
  async function updateConfig(ifMatch: string | undefined, candidate: unknown): Promise<ConfigUpdateResult>;
  async function updateConfig(...args: UpdateConfigArgs): Promise<ProfileConfigUpdateResult> {
    return serialized(async () => {
    let profileId: ProfileId;
    let ifMatch: string | undefined;
    let candidate: unknown;
    if (args.length === 3) {
      profileId = args[0];
      ifMatch = args[1];
      candidate = args[2];
    } else {
      profileId = DEFAULT_PROFILE_ID;
      ifMatch = args[0];
      candidate = args[1];
    }

    const document = await readDocumentUnlocked();
    const parsedId = profileIdIssues(profileId);
    if (Array.isArray(parsedId)) return { kind: "not-found" };
    const profileIndex = document.profiles.findIndex((entry) => entry.id === parsedId);
    if (profileIndex < 0) return { kind: "not-found" };
    const currentProfile = document.profiles[profileIndex];
    if (currentProfile === undefined) return { kind: "not-found" };
    if (ifMatch !== currentProfile.config.updatedAt) {
      return { kind: "conflict", current: currentProfile.config.updatedAt };
    }

    const body = isRecord(candidate) ? dropUnknownPanesFromConfig(candidate) : {};
    const parsed = configSchema.safeParse({
      ...(isRecord(body) ? body : {}),
      updatedAt: nextRevision(currentProfile.config.updatedAt),
    });
    if (!parsed.success) return { kind: "invalid", issues: parsed.error.issues };
    const config = addMissingPanes(parsed.data);

    const nextDocument = clone(document);
    const profile = nextDocument.profiles[profileIndex];
    if (profile === undefined) return { kind: "not-found" };
    profile.config = config;
    const parsedDocument = profileDocumentSchema.safeParse(nextDocument);
    if (!parsedDocument.success) return { kind: "invalid", issues: parsedDocument.error.issues };
    await writeDocumentUnlocked(parsedDocument.data, document);
    return { kind: "ok", config: clone(config) };
    });
  }

  async function readConfig(): Promise<Config> {
    const result = await readProfileConfig(DEFAULT_PROFILE_ID);
    return result.kind === "ok" ? result.config : clone(defaultConfig);
  }

  async function writeConfig(cfg: Config): Promise<void> {
    return serialized(async () => {
      const parsed = configSchema.safeParse(dropUnknownPanesFromConfig(cfg));
      if (!parsed.success) {
        throw new ConfigStoreError("Config ist ungültig");
      }
      const document = await readDocumentUnlocked();
      const profileIndex = document.profiles.findIndex((entry) => entry.id === DEFAULT_PROFILE_ID);
      if (profileIndex < 0) {
        throw new ConfigStoreError("Standardprofil nicht gefunden");
      }
      const nextDocument = clone(document);
      const profile = nextDocument.profiles[profileIndex];
      if (profile === undefined) throw new ConfigStoreError("Standardprofil nicht gefunden");
      profile.config = addMissingPanes(parsed.data);
      await writeDocumentUnlocked(nextDocument, document);
    });
  }

  return {
    readConfig,
    writeConfig,
    readCatalog,
    readProfileConfig,
    createProfile,
    renameProfile,
    deleteProfile,
    updateConfig,
  };
}
