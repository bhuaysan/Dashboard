import { writeFile, rename, readFile, copyFile } from "node:fs/promises";
import { configSchema, type Config } from "../src/config/schema.ts";
import { defaultConfig } from "../src/config/defaults.ts";
import { env } from "./env.ts";

const configPath = env.configPath;

export async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, path);        // rename ist atomar, halbe Dateien unmöglich
}

export async function readConfig(): Promise<Config> {
  try {
    const parsed = configSchema.safeParse(JSON.parse(await readFile(configPath, "utf8")));
    // Neue Panes fehlen in einer älteren config.json — ohne sie könnte man die Pane
    // in den Einstellungen weder sehen noch schalten. Anhängen, nicht umsortieren:
    // die Reihenfolge im Raster gibt ohnehin App.tsx vor.
    if (parsed.success) {
      for (const entry of defaultConfig.layout) {
        if (!parsed.data.layout.some((l) => l.id === entry.id)) {
          parsed.data.layout.push(entry);
        }
      }
      return parsed.data;
    }
    await copyFile(configPath, `${configPath}.bak`);   // kaputte Datei aufbewahren
  } catch { /* Datei fehlt: Defaults */ }
  return defaultConfig;
}

const KEEP_BACKUPS = 7;

function isMissing(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT";
}

// Vor jedem Schreiben den bisherigen Stand wegkopieren: config.json.1 ist der jüngste,
// config.json.7 der älteste. Jedes Gerät im LAN darf die Config überschreiben — ohne das
// hier wäre ein versehentlich gelöschter Link endgültig weg.
async function keepPreviousVersion(): Promise<void> {
  for (let i = KEEP_BACKUPS - 1; i >= 1; i--) {
    try {
      await rename(`${configPath}.${i}`, `${configPath}.${i + 1}`);
    } catch (e) {
      if (!isMissing(e)) console.error(`Sicherung ${i} nicht verschiebbar:`, e);
    }
  }
  try {
    await copyFile(configPath, `${configPath}.1`);
  } catch (e) {
    // Eine misslungene Sicherung darf das Speichern nicht verhindern.
    if (!isMissing(e)) console.error("Sicherung nicht anlegbar:", e);
  }
}

export async function writeConfig(cfg: Config): Promise<void> {
  await keepPreviousVersion();
  await writeAtomic(configPath, JSON.stringify(cfg, null, 2));
}
