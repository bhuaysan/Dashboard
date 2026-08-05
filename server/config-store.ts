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
    if (parsed.success) return parsed.data;
    await copyFile(configPath, `${configPath}.bak`);   // kaputte Datei aufbewahren
  } catch { /* Datei fehlt: Defaults */ }
  return defaultConfig;
}

export async function writeConfig(cfg: Config): Promise<void> {
  await writeAtomic(configPath, JSON.stringify(cfg, null, 2));
}
