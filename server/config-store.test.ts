import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/defaults";
import { configSchema, type Config } from "../src/config/schema";
import { ConfigStoreError, createConfigStore, MAX_CONFIG_BYTES, writeAtomic } from "./config-store.ts";

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

type StoreFixture = {
  dir: string;
  configPath: string;
  store: ReturnType<typeof createConfigStore>;
};

async function createFixture(): Promise<StoreFixture> {
  const dir = await mkdtemp(join(tmpdir(), "dashboard-store-"));
  const configPath = join(dir, "config.json");
  return { dir, configPath, store: createConfigStore(configPath) };
}

function itWithStore(name: string, test: (fixture: StoreFixture) => Promise<void>): void {
  it(name, async () => {
    const fixture = await createFixture();
    try {
      await test(fixture);
    } finally {
      await rm(fixture.dir, { recursive: true, force: true });
    }
  });
}

describe("readConfig", () => {
  itWithStore("liefert Defaults, wenn die Datei fehlt", async ({ store }) => {
    expect(await store.readConfig()).toEqual(defaultConfig);
  });

  itWithStore("legt bei kaputtem Inhalt eine .bak-Datei an und fällt auf Defaults zurück", async ({ configPath, store }) => {
    await writeFile(configPath, JSON.stringify({ version: 99, kaputt: true }));
    expect(await store.readConfig()).toEqual(defaultConfig);
    const bak = JSON.parse(await readFile(`${configPath}.bak`, "utf8")) as { version: number };
    expect(bak.version).toBe(99);
  });

  itWithStore("sichert auch syntaktisch kaputtes JSON vor dem Fallback", async ({ configPath, store }) => {
    await writeFile(configPath, "{");
    expect(await store.readConfig()).toEqual(defaultConfig);
    expect(await readFile(`${configPath}.bak`, "utf8")).toBe("{");
  });

  itWithStore("gibt einen fehlgeschlagenen Backup-Versuch als Fehler weiter", async ({ configPath, store }) => {
    await writeFile(configPath, "{");
    await rm(`${configPath}.bak`, { force: true, recursive: true });
    await mkdir(`${configPath}.bak`);
    await expect(store.readConfig()).rejects.toThrow("Beschädigte Config konnte nicht gesichert werden");
    await rm(`${configPath}.bak`, { recursive: true, force: true });
  });

  itWithStore("verwirft eine unbekannte Pane-Id im Layout, statt an der ganzen Config zu scheitern", async ({ configPath, store }) => {
    await writeFile(configPath, JSON.stringify({
      ...defaultConfig,
      layout: [...defaultConfig.layout, { id: "music", visible: true, span: 1 }],
    }));
    const cfg = await store.readConfig();
    expect(cfg.layout.map((l) => l.id)).not.toContain("music");
    expect(cfg.linkGroups).toEqual(defaultConfig.linkGroups);   // Rest der Config bleibt erhalten
  });

  itWithStore("liest eine übergroße Config nicht vollständig ein", async ({ configPath, store }) => {
    await writeFile(configPath, Buffer.alloc(MAX_CONFIG_BYTES + 1, 120));
    await expect(store.readConfig()).rejects.toThrow("Config-Datei ist zu groß");
  });
});

describe("writeConfig", () => {
  itWithStore("hebt die vorherigen Stände als config.json.1 bis .7 auf", async ({ configPath, dir, store }) => {
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

  itWithStore("weist eine zu große endgültige Darstellung vor der Backup-Rotation ab", async ({ configPath, store }) => {
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
  itWithStore("serialisiert CAS-Updates und erzeugt unter gleicher Uhrzeit neue Revisionen", async ({ store }) => {
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

  itWithStore("persistiert keine abgeleiteten Hosts jenseits der Schema-Grenze", async ({ configPath, store }) => {
    const current = await store.readConfig();
    const candidate: Config = {
      ...current,
      proxyAllowlist: Array.from({ length: 128 }, (_, index) => `manual-${index}.example`),
      feeds: Array.from({ length: 32 }, (_, index) => ({
        label: `Feed ${index}`, url: `https://feed-${index}.example/rss`, limit: 5,
      })),
      calendars: Array.from({ length: 32 }, (_, index) => ({
        label: `Kalender ${index}`, url: `https://cal-${index}.example/work.ics`,
      })),
    };
    const result = await store.updateConfig(current.updatedAt, candidate);
    expect(result.kind).toBe("ok");
    const persisted: unknown = JSON.parse(await readFile(configPath, "utf8"));
    expect(configSchema.safeParse(persisted).success).toBe(true);
    expect((persisted as Config).proxyAllowlist).toHaveLength(128);
  });
});

describe("writeAtomic", () => {
  itWithStore("schreibt vollständig und hinterlässt keine tmp-Datei", async ({ dir }) => {
    const target = join(dir, "atomic.txt");
    await writeAtomic(target, "inhalt");
    expect(await readFile(target, "utf8")).toBe("inhalt");
    const files = await readdir(dir);
    expect(files.some((f) => f.includes(".tmp-"))).toBe(false);
  });

  itWithStore("übersetzt einen finalen Rename-Fehler in ConfigStoreError", async ({ dir }) => {
    await expect(writeAtomic(dir, "inhalt")).rejects.toBeInstanceOf(ConfigStoreError);
    const files = await readdir(join(dir, ".."));
    expect(files.some((file) => file.startsWith(`${dir.split("/").at(-1) ?? ""}.tmp-`))).toBe(false);
  });
});
