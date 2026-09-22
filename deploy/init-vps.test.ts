// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { profileDocumentSchema } from "../src/config/schema";
import { seedVpsConfig } from "./init-vps";

const directories: string[] = [];
async function temporaryConfig() {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-init-test-"));
  directories.push(directory);
  return { directory, path: join(directory, "config.json") };
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("VPS-Erstinitialisierung", () => {
  it("erstellt ein gültiges Profildokument ohne Monitoring und ohne HOMELAB-Pane", async () => {
    const { directory, path } = await temporaryConfig();
    expect(await seedVpsConfig(path)).toBe("created");
    const document = profileDocumentSchema.parse(JSON.parse(await readFile(path, "utf8")));
    expect(document.version).toBe(2);
    expect(document.profiles).toHaveLength(1);
    expect(document.profiles[0]?.id).toBe("default");
    expect(document.profiles[0]?.name).toBe("Standard");
    const profile = document.profiles[0];
    if (!profile) throw new Error("Standardprofil fehlt");
    const config = profile.config;
    expect(config.homelab.enabled).toBe(false);
    expect(config.layout.find((pane) => pane.id === "homelab")?.visible).toBe(false);
    expect(await readdir(directory)).toEqual(["config.json"]);
  });

  it("erhält vorhandene Einstellungen bytegenau, auch wenn sie ungültig sind", async () => {
    const { path } = await temporaryConfig();
    const existing = "vorhandene Einstellungen – nicht überschreiben\n";
    await writeFile(path, existing);
    expect(await seedVpsConfig(path)).toBe("existing");
    expect(await readFile(path, "utf8")).toBe(existing);
  });

  it("veröffentlicht bei konkurrierenden Starts genau eine vollständige Config", async () => {
    const { directory, path } = await temporaryConfig();
    const results = await Promise.all(Array.from({ length: 12 }, () => seedVpsConfig(path)));
    expect(results.filter((result) => result === "created")).toHaveLength(1);
    expect(results.filter((result) => result === "existing")).toHaveLength(11);
    expect(profileDocumentSchema.safeParse(JSON.parse(await readFile(path, "utf8"))).success).toBe(true);
    expect(await readdir(directory)).toEqual(["config.json"]);
  });

  it("meldet Schreibfehler statt eine erfolgreiche Initialisierung vorzutäuschen", async () => {
    const { directory } = await temporaryConfig();
    await expect(seedVpsConfig(join(directory, "missing", "config.json"))).rejects.toThrow();
  });
});
