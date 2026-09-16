import { randomUUID } from "node:crypto";
import { link, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig } from "../src/config/defaults.ts";
import { DEFAULT_PROFILE_ID, type ProfileDocument } from "../src/config/schema.ts";

export async function seedVpsConfig(configPath: string): Promise<"created" | "existing"> {
  const updatedAt = new Date().toISOString();
  const config = {
    ...defaultConfig,
    updatedAt,
    homelab: { ...defaultConfig.homelab, enabled: false },
    layout: defaultConfig.layout.map((pane) => pane.id === "homelab" ? { ...pane, visible: false } : pane),
  };
  const document: ProfileDocument = {
    version: 2,
    profilesUpdatedAt: updatedAt,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: "Standard", config }],
  };
  const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
    await file.sync();
    // A hard link publishes the complete file atomically, without replacing an existing path.
    try {
      await link(temporaryPath, configPath);
      return "created";
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") return "existing";
      throw error;
    }
  } finally {
    await file.close();
    await unlink(temporaryPath);
  }
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
  try {
    const result = await seedVpsConfig(process.env.DASHBOARD_CONFIG ?? "/data/config.json");
    console.log(result === "created" ? "VPS-Einstellungen initialisiert." : "Vorhandene VPS-Einstellungen beibehalten.");
  } catch {
    console.error("VPS-Einstellungen konnten nicht initialisiert werden.");
    process.exitCode = 1;
  }
}
