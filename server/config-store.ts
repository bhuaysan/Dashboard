import { randomUUID } from "node:crypto";
import { copyFile, readFile, rename, unlink, writeFile } from "node:fs/promises";
import type { ZodIssue } from "zod";
import { configSchema, type Config } from "../src/config/schema.ts";
import { defaultConfig } from "../src/config/defaults.ts";
import { env } from "./env.ts";

const configPath = env.configPath;
const KEEP_BACKUPS = 7;

// Panes, die das Schema nicht mehr kennt (z. B. "music" nach dessen Entfernung), lässt das
// enum in configSchema sonst am ganzen layout-Array scheitern — nicht nur an dem einen
// veralteten Eintrag. Deshalb hier herausfiltern, bevor die Live-Config überhaupt geparst wird.
const KNOWN_PANE_IDS = new Set<string>(configSchema.shape.layout.element.shape.id.options);

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

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function describeStoreError(message: string, error: unknown): ConfigStoreError {
  return new ConfigStoreError(message, { cause: error });
}

async function preserveBrokenConfig(): Promise<void> {
  try {
    await copyFile(configPath, `${configPath}.bak`);
  } catch (error) {
    throw describeStoreError("Beschädigte Config konnte nicht gesichert werden", error);
  }
}

export async function writeAtomic(path: string, data: string): Promise<void> {
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

async function readConfigUnlocked(): Promise<Config> {
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    if (isMissing(error)) return defaultConfig;
    throw describeStoreError("Config-Datei nicht lesbar", error);
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

export async function readConfig(): Promise<Config> {
  return readConfigUnlocked();
}

// Alle Schreibvorgänge dieses Prozesses laufen durch dieselbe Promise-Queue. Die Kette wird
// auch nach einem Fehler freigegeben, damit ein einzelner defekter Write keinen Deadlock erzeugt.
let writeQueue: Promise<void> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function keepPreviousVersion(): Promise<void> {
  for (let i = KEEP_BACKUPS - 1; i >= 1; i--) {
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
  await keepPreviousVersion();
  await writeAtomic(configPath, JSON.stringify(cfg, null, 2));
}

// Für die Backup-Rotation und die bestehenden Store-Tests bleibt ein direkter Schreibhelfer
// verfügbar. Der API-Pfad verwendet ausschließlich updateConfig, also die CAS-Transaktion.
export async function writeConfig(cfg: Config): Promise<void> {
  return serialized(() => writeConfigUnlocked(cfg));
}

function nextRevision(previous: string): string {
  const previousMs = Date.parse(previous);
  const now = Date.now();
  const minimum = Number.isFinite(previousMs) ? previousMs + 1 : now;
  return new Date(Math.max(now, minimum)).toISOString();
}

export type ConfigUpdateResult =
  | { kind: "ok"; config: Config }
  | { kind: "conflict"; current: string }
  | { kind: "invalid"; issues: ZodIssue[] };

export async function updateConfig(ifMatch: string | undefined, candidate: unknown): Promise<ConfigUpdateResult> {
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
