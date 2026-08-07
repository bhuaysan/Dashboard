import { writeFile, rename, readFile, copyFile } from "node:fs/promises";
import { configSchema, type Config } from "../src/config/schema.ts";
import { defaultConfig } from "../src/config/defaults.ts";
import { env } from "./env.ts";

const configPath = env.configPath;

// Panes, die das Schema nicht mehr kennt (z. B. "music" nach dessen Entfernung), lässt das
// enum in configSchema sonst am ganzen layout-Array scheitern — nicht nur an dem einen
// veralteten Eintrag. Deshalb hier herausfiltern, bevor die Live-Config überhaupt geparst wird.
const KNOWN_PANE_IDS = new Set<string>(configSchema.shape.layout.element.shape.id.options);

function dropUnknownPanes(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !("layout" in raw)) return raw;
  const layout = (raw as { layout: unknown }).layout;
  if (!Array.isArray(layout)) return raw;
  return {
    ...raw,
    layout: layout.filter((l) =>
      typeof l === "object" && l !== null && KNOWN_PANE_IDS.has((l as { id?: unknown }).id as string)),
  };
}

export async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, path);        // rename ist atomar, halbe Dateien unmöglich
}

export async function readConfig(): Promise<Config> {
  try {
    const raw = dropUnknownPanes(JSON.parse(await readFile(configPath, "utf8")));
    const parsed = configSchema.safeParse(raw);
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
