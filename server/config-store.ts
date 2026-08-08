import { randomUUID } from "node:crypto";
import { copyFile, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { ZodIssue } from "zod";
import { configSchema, PANE_IDS, type Config } from "../src/config/schema.ts";
import { defaultConfig } from "../src/config/defaults.ts";
import { env } from "./env.ts";

const KEEP_BACKUPS = 7;
export const MAX_CONFIG_BYTES = 512 * 1024;

// Panes, die das Schema nicht mehr kennt (z. B. "music" nach dessen Entfernung), lässt das
// enum in configSchema sonst am ganzen layout-Array scheitern — nicht nur an dem einen
// veralteten Eintrag. Deshalb hier herausfiltern, bevor die Live-Config überhaupt geparst wird.
const KNOWN_PANE_IDS = new Set<string>(PANE_IDS);

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dropUnknownPanes(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.layout)) return raw;
  return {
    ...raw,
    layout: raw.layout.filter((entry) =>
      isRecord(entry) && typeof entry.id === "string" && KNOWN_PANE_IDS.has(entry.id),
    ),
  };
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
  } finally {
    if (!renamed) {
      try { await unlink(tmp); } catch { /* best effort: der ursprüngliche Fehler bleibt maßgeblich */ }
    }
  }
}

export type ConfigUpdateResult =
  | { kind: "ok"; config: Config }
  | { kind: "conflict"; current: string }
  | { kind: "invalid"; issues: ZodIssue[] };

export type ConfigStore = {
  readConfig: () => Promise<Config>;
  writeConfig: (cfg: Config) => Promise<void>;
  updateConfig: (ifMatch: string | undefined, candidate: unknown) => Promise<ConfigUpdateResult>;
};

export function createConfigStore(configPath: string): ConfigStore {
  async function preserveBrokenConfig(): Promise<void> {
    try {
      await copyFile(configPath, `${configPath}.bak`);
    } catch (error) {
      throw describeStoreError("Beschädigte Config konnte nicht gesichert werden", error);
    }
  }

  async function readConfigUnlocked(): Promise<Config> {
    try {
      const info = await stat(configPath);
      if (info.size > MAX_CONFIG_BYTES) {
        throw new ConfigStoreError("Config-Datei ist zu groß");
      }
    } catch (error) {
      if (isMissing(error)) return defaultConfig;
      if (error instanceof ConfigStoreError) throw error;
      throw describeStoreError("Config-Datei nicht lesbar", error);
    }

    let text: string;
    try {
      text = await readFile(configPath, "utf8");
    } catch (error) {
      if (isMissing(error)) return defaultConfig;
      throw describeStoreError("Config-Datei nicht lesbar", error);
    }
    if (Buffer.byteLength(text, "utf8") > MAX_CONFIG_BYTES) {
      throw new ConfigStoreError("Config-Datei ist zu groß");
    }

    let raw: unknown;
    try {
      raw = dropUnknownPanes(JSON.parse(text));
    } catch (error) {
      await preserveBrokenConfig();
      if (error instanceof SyntaxError) return defaultConfig;
      throw describeStoreError("Config-Datei konnte nicht gelesen werden", error);
    }

    const parsed = configSchema.safeParse(raw);
    if (!parsed.success) {
      await preserveBrokenConfig();
      return defaultConfig;
    }

    // Neue Panes fehlen in einer älteren config.json — ohne sie könnte man die Pane
    // in den Einstellungen weder sehen noch schalten. Anhängen, nicht umsortieren:
    // die Reihenfolge im Raster gibt ohnehin App.tsx vor.
    for (const entry of defaultConfig.layout) {
      if (!parsed.data.layout.some((layout) => layout.id === entry.id)) {
        parsed.data.layout.push(entry);
      }
    }
    return parsed.data;
  }

  // Alle Schreibvorgänge dieses Stores laufen durch dieselbe Promise-Queue. Das ist auch
  // für mehrere App-Instanzen im Test nützlich: kein globaler Prozesszustand wird geteilt.
  let writeQueue: Promise<void> = Promise.resolve();

  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function keepPreviousVersion(): Promise<void> {
    for (let i = KEEP_BACKUPS - 1; i >= 1; i -= 1) {
      try {
        await rename(`${configPath}.${i}`, `${configPath}.${i + 1}`);
      } catch (error) {
        if (!isMissing(error)) {
          throw describeStoreError(`Sicherung ${i} nicht verschiebbar`, error);
        }
      }
    }
    try {
      await copyFile(configPath, `${configPath}.1`);
    } catch (error) {
      if (!isMissing(error)) {
        throw describeStoreError("Sicherung nicht anlegbar", error);
      }
    }
  }

  async function writeConfigUnlocked(cfg: Config): Promise<void> {
    const serialized = JSON.stringify(cfg, null, 2);
    if (Buffer.byteLength(serialized, "utf8") > MAX_CONFIG_BYTES) {
      throw new ConfigTooLargeError();
    }
    await keepPreviousVersion();
    await writeAtomic(configPath, serialized);
  }

  function nextRevision(previous: string): string {
    const previousMs = Date.parse(previous);
    const now = Date.now();
    const minimum = Number.isFinite(previousMs) ? previousMs + 1 : now;
    return new Date(Math.max(now, minimum)).toISOString();
  }

  async function readConfig(): Promise<Config> {
    return readConfigUnlocked();
  }

  async function writeConfig(cfg: Config): Promise<void> {
    return serialized(() => writeConfigUnlocked(cfg));
  }

  async function updateConfig(ifMatch: string | undefined, candidate: unknown): Promise<ConfigUpdateResult> {
    return serialized(async () => {
      const current = await readConfigUnlocked();
      if (ifMatch !== current.updatedAt) {
        return { kind: "conflict", current: current.updatedAt };
      }

      const body = isRecord(candidate) ? candidate : {};
      const parsed = configSchema.safeParse({ ...body, updatedAt: nextRevision(current.updatedAt) });
      if (!parsed.success) {
        return { kind: "invalid", issues: parsed.error.issues };
      }

      await writeConfigUnlocked(parsed.data);
      return { kind: "ok", config: parsed.data };
    });
  }

  return { readConfig, writeConfig, updateConfig };
}

// Legacy-Exports für direkte Server-/Store-Nutzung. Die App-Fabrik verwendet für Tests und
// mehrere Instanzen die explizite Factory oben.
const defaultStore = createConfigStore(env.configPath);
export const readConfig = defaultStore.readConfig;
export const writeConfig = defaultStore.writeConfig;
export const updateConfig = defaultStore.updateConfig;
