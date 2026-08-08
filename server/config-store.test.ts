import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/defaults";
import type { Config } from "../src/config/schema";
import { createConfigStore, MAX_CONFIG_BYTES, writeAtomic } from "./config-store.ts";

let dir: string;
let configPath: string;
let store: ReturnType<typeof createConfigStore>;

function nearLimitConfig(): Config {
  const links: Config["linkGroups"][number]["links"] = Array.from({ length: 100 }, (_, index) => ({
    label: `link-${index}`,
    url: `https://example.com/${"x".repeat(1660)}`,
  }));
  return {
    ...defaultConfig,
    linkGroups: [
      { title: "groß", links },
      { title: "groß2", links },
      { title: "groß3", links },
    ],
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dashboard-store-"));
  configPath = join(dir, "config.json");
  store = createConfigStore(configPath);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readConfig", () => {
  it("liefert Defaults, wenn die Datei fehlt", async () => {
    expect(await store.readConfig()).toEqual(defaultConfig);
  });

  it("legt bei kaputtem Inhalt eine .bak-Datei an und fällt auf Defaults zurück", async () => {
    await writeFile(configPath, JSON.stringify({ version: 99, kaputt: true }));
    expect(await store.readConfig()).toEqual(defaultConfig);
    const bak = JSON.parse(await readFile(`${configPath}.bak`, "utf8")) as { version: number };
    expect(bak.version).toBe(99);
  });

  it("sichert auch syntaktisch kaputtes JSON vor dem Fallback", async () => {
    await writeFile(configPath, "{");
    expect(await store.readConfig()).toEqual(defaultConfig);
    expect(await readFile(`${configPath}.bak`, "utf8")).toBe("{");
  });

  it("gibt einen fehlgeschlagenen Backup-Versuch als Fehler weiter", async () => {
    await writeFile(configPath, "{");
    await rm(`${configPath}.bak`, { force: true, recursive: true });
    await mkdir(`${configPath}.bak`);
    await expect(store.readConfig()).rejects.toThrow("Beschädigte Config konnte nicht gesichert werden");
    await rm(`${configPath}.bak`, { recursive: true, force: true });
  });

  it("verwirft eine unbekannte Pane-Id im Layout, statt an der ganzen Config zu scheitern", async () => {
    await writeFile(configPath, JSON.stringify({
      ...defaultConfig,
      layout: [...defaultConfig.layout, { id: "music", visible: true, span: 1 }],
    }));
    const cfg = await store.readConfig();
    expect(cfg.layout.map((l) => l.id)).not.toContain("music");
    expect(cfg.linkGroups).toEqual(defaultConfig.linkGroups);   // Rest der Config bleibt erhalten
  });

  it("liest eine übergroße Config nicht vollständig ein", async () => {
    await writeFile(configPath, Buffer.alloc(MAX_CONFIG_BYTES + 1, 120));
    await expect(store.readConfig()).rejects.toThrow("Config-Datei ist zu groß");
  });
});

describe("writeConfig", () => {
  it("hebt die vorherigen Stände als config.json.1 bis .7 auf", async () => {
    // zehn Speichervorgänge mit unterscheidbarem Inhalt
    for (let i = 1; i <= 10; i++) {
      await store.writeConfig({ ...defaultConfig, updatedAt: `stand-${i}` });
    }
    const aktuell = JSON.parse(await readFile(configPath, "utf8")) as { updatedAt: string };
    expect(aktuell.updatedAt).toBe("stand-10");

    // .1 ist der jüngste vorherige Stand, .7 der älteste
    const backups = await Promise.all(
      [1, 7].map(async (n) => JSON.parse(await readFile(`${configPath}.${n}`, "utf8")) as { updatedAt: string }),
    );
    expect(backups[0]?.updatedAt).toBe("stand-9");
    expect(backups[1]?.updatedAt).toBe("stand-3");

    // und es bleiben genau sieben übrig
    const files = await readdir(dir);
    expect(files.filter((f) => /^config\.json\.\d+$/.test(f))).toHaveLength(7);
  });

  it("weist eine zu große endgültige Darstellung vor der Backup-Rotation ab", async () => {
    const candidate = nearLimitConfig();
    await store.writeConfig({ ...defaultConfig, updatedAt: "vorher" });
    const before = await readFile(configPath, "utf8");
    await writeFile(`${configPath}.1`, "unverändert");

    await expect(store.writeConfig(candidate)).rejects.toThrow("Config-Datei ist zu groß");
    expect(await readFile(configPath, "utf8")).toBe(before);
    expect(await readFile(`${configPath}.1`, "utf8")).toBe("unverändert");
  });
});

describe("updateConfig", () => {
  it("serialisiert CAS-Updates und erzeugt unter gleicher Uhrzeit neue Revisionen", async () => {
    const first = await store.readConfig();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00.000Z"));
    try {
      const one = await store.updateConfig(first.updatedAt, { ...first, theme: "dark" });
      expect(one.kind).toBe("ok");
      if (one.kind !== "ok") return;
      const two = await store.updateConfig(one.config.updatedAt, { ...one.config, theme: "light" });
      expect(two.kind).toBe("ok");
      if (two.kind !== "ok") return;
      expect(two.config.updatedAt).not.toBe(one.config.updatedAt);
      expect(Date.parse(two.config.updatedAt)).toBeGreaterThan(Date.parse(one.config.updatedAt));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("writeAtomic", () => {
  it("schreibt vollständig und hinterlässt keine tmp-Datei", async () => {
    const target = join(dir, "atomic.txt");
    await writeAtomic(target, "inhalt");
    expect(await readFile(target, "utf8")).toBe("inhalt");
    const files = await readdir(dir);
    expect(files.some((f) => f.includes(".tmp-"))).toBe(false);
  });
});
