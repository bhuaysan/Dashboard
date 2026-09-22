import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/defaults";
import { DEFAULT_PROFILE_ID, PANE_IDS, profileDocumentSchema, type Config, type ProfileId } from "../src/config/schema";
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

function largeLegacyConfig(): Config {
  const linkGroups = Array.from({ length: 27 }, (_, groupIndex) => ({
    title: `gruppe-${groupIndex}`,
    links: Array.from({ length: 100 }, (_, linkIndex) => ({
      label: `link-${groupIndex}-${linkIndex}-${"l".repeat(47)}`,
      url: `https://example.com/${"x".repeat(33)}-${groupIndex}-${linkIndex}`,
    })),
  }));
  return { ...defaultConfig, linkGroups };
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

  itWithStore("liest eine alte Config ohne Homelab-Schalter als aktiviert und legt kein Backup an", async ({ configPath, dir, store }) => {
    const { enabled: _enabled, ...legacyHomelab } = defaultConfig.homelab;
    await writeFile(configPath, JSON.stringify({ ...defaultConfig, homelab: legacyHomelab }));
    const config = await store.readConfig();
    expect(config.homelab.enabled).toBe(true);
    expect(await readdir(dir)).not.toContain("config.json.bak");
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
      await store.writeConfig({ ...defaultConfig, updatedAt: `2026-08-08T12:00:00.${String(i).padStart(3, "0")}Z` });
    }
    const aktuell = profileDocumentSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
    expect(aktuell.profiles[0]?.config.updatedAt).toBe("2026-08-08T12:00:00.010Z");

    // .1 ist der jüngste vorherige Stand, .7 der älteste
    const backups = await Promise.all(
      [1, 7].map(async (n) => profileDocumentSchema.parse(JSON.parse(await readFile(`${configPath}.${n}`, "utf8")))),
    );
    expect(backups[0]?.profiles[0]?.config.updatedAt).toBe("2026-08-08T12:00:00.009Z");
    expect(backups[1]?.profiles[0]?.config.updatedAt).toBe("2026-08-08T12:00:00.003Z");

    // und es bleiben genau sieben übrig
    const files = await readdir(dir);
    expect(files.filter((f) => /^config\.json\.\d+$/.test(f))).toHaveLength(7);
  });

  itWithStore("weist eine zu große endgültige Darstellung vor der Backup-Rotation ab", async ({ configPath, store }) => {
    const candidate = nearLimitConfig();
    await store.writeConfig({ ...defaultConfig, updatedAt: "2026-08-08T12:00:00.001Z" });
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
    const parsed = profileDocumentSchema.safeParse(persisted);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.profiles[0]?.config.proxyAllowlist).toHaveLength(128);
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

describe("profile document migration", () => {
  itWithStore("liest eine Legacy-Config als deterministisches Standardprofil ohne zu schreiben", async ({ configPath, store }) => {
    const legacy = JSON.stringify({ ...defaultConfig, theme: "light" });
    await writeFile(configPath, legacy);

    const before = await readFile(configPath, "utf8");
    const first = await store.readCatalog();
    const second = await store.readCatalog();

    expect(first.profiles).toEqual([{ id: DEFAULT_PROFILE_ID, name: "Standard" }]);
    expect(second).toEqual(first);
    expect(await readFile(configPath, "utf8")).toBe(before);
  });

  itWithStore("persistiert beim ersten erfolgreichen Update ein Version-2-Dokument", async ({ configPath, store }) => {
    await writeFile(configPath, JSON.stringify(defaultConfig));
    const current = await store.readProfileConfig(DEFAULT_PROFILE_ID);
    expect(current.kind).toBe("ok");
    if (current.kind !== "ok") return;

    const result = await store.updateConfig(DEFAULT_PROFILE_ID, current.config.updatedAt, {
      ...current.config,
      theme: "dark",
    });
    expect(result.kind).toBe("ok");
    const persisted: unknown = JSON.parse(await readFile(configPath, "utf8"));
    expect(persisted).toEqual(expect.objectContaining({ version: 2 }));
    expect(persisted).toEqual(expect.objectContaining({
      profiles: [expect.objectContaining({ id: DEFAULT_PROFILE_ID, name: "Standard" })],
    }));
  });

  itWithStore("legt bei der ersten Legacy-Mutation eine vollständige Version-2-Sicherung an", async ({ configPath, store }) => {
    await writeFile(configPath, JSON.stringify({ ...defaultConfig, theme: "light" }));
    const current = await store.readProfileConfig(DEFAULT_PROFILE_ID);
    expect(current.kind).toBe("ok");
    if (current.kind !== "ok") return;

    const result = await store.updateConfig(DEFAULT_PROFILE_ID, current.config.updatedAt, {
      ...current.config,
      theme: "dark",
    });
    expect(result.kind).toBe("ok");

    const backup = profileDocumentSchema.parse(JSON.parse(await readFile(`${configPath}.1`, "utf8")));
    expect(backup.version).toBe(2);
    expect(backup.profiles).toHaveLength(1);
    expect(backup.profiles[0]?.id).toBe(DEFAULT_PROFILE_ID);
    expect(backup.profiles[0]?.config.theme).toBe("light");
  });

  itWithStore("erlaubt eine Mutation einer gültigen Legacy-Config nahe dem Größenlimit", async ({ configPath, store }) => {
    const legacy = largeLegacyConfig();
    const legacyText = JSON.stringify(legacy, null, 2);
    const migrated = {
      version: 2 as const,
      profilesUpdatedAt: defaultConfig.updatedAt,
      profiles: [{ id: DEFAULT_PROFILE_ID, name: "Standard", config: legacy }],
    };
    const prettyMigration = JSON.stringify(migrated, null, 2);
    expect(Buffer.byteLength(legacyText, "utf8")).toBeLessThanOrEqual(MAX_CONFIG_BYTES);
    expect(Buffer.byteLength(prettyMigration, "utf8")).toBeGreaterThan(MAX_CONFIG_BYTES);
    await writeFile(configPath, legacyText);

    const current = await store.readProfileConfig(DEFAULT_PROFILE_ID);
    expect(current.kind).toBe("ok");
    if (current.kind !== "ok") return;

    const result = await store.updateConfig(DEFAULT_PROFILE_ID, current.config.updatedAt, {
      ...defaultConfig,
      theme: "dark",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const backupText = await readFile(`${configPath}.1`, "utf8");
    expect(Buffer.byteLength(backupText, "utf8")).toBeLessThanOrEqual(MAX_CONFIG_BYTES);
    const backup = profileDocumentSchema.parse(JSON.parse(backupText));
    expect(backup.version).toBe(2);
    expect(backup.profiles[0]?.config).toEqual(legacy);

    const active = profileDocumentSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
    expect(active.profiles[0]?.config).toEqual(result.config);
  });

  itWithStore("normalisiert unbekannte und fehlende Panes in jedem Version-2-Profil", async ({ configPath, store }) => {
    const workId = "123e4567-e89b-42d3-a456-426614174000" as ProfileId;
    const firstLayout = defaultConfig.layout.filter((entry) => entry.id !== "news");
    await writeFile(configPath, JSON.stringify({
      version: 2,
      profilesUpdatedAt: defaultConfig.updatedAt,
      profiles: [
        {
          id: DEFAULT_PROFILE_ID,
          name: "Standard",
          config: { ...defaultConfig, layout: [...firstLayout, { id: "music", visible: true, span: 1 }] },
        },
        {
          id: workId,
          name: "Arbeit",
          config: { ...defaultConfig, layout: [{ id: "clock", visible: true, span: 1 }] },
        },
      ],
    }));

    const standard = await store.readProfileConfig(DEFAULT_PROFILE_ID);
    const work = await store.readProfileConfig(workId);
    expect(standard.kind).toBe("ok");
    expect(work.kind).toBe("ok");
    if (standard.kind !== "ok" || work.kind !== "ok") return;
    expect(standard.config.layout.map((entry) => entry.id)).toEqual(expect.arrayContaining(Array.from(PANE_IDS)));
    expect(work.config.layout.map((entry) => entry.id)).toEqual(expect.arrayContaining(Array.from(PANE_IDS)));
  });

  itWithStore("liest alle Profil-Configs validiert, migriert und als unabhängige Kopien", async ({ configPath, store }) => {
    const workId = "123e4567-e89b-42d3-a456-426614174000";
    const { uptime: _uptime, ...legacyConfig } = defaultConfig;
    await writeFile(configPath, JSON.stringify({
      version: 2,
      profilesUpdatedAt: defaultConfig.updatedAt,
      profiles: [
        { id: DEFAULT_PROFILE_ID, name: "Standard", config: legacyConfig },
        { id: workId, name: "Arbeit", config: { ...legacyConfig, theme: "light" } },
      ],
    }));

    const first = await store.readAllProfileConfigs();
    expect(first.map(({ profileId }) => profileId)).toEqual([DEFAULT_PROFILE_ID, workId]);
    expect(first.map(({ config }) => config.uptime)).toEqual([
      { enabled: false, targets: [] },
      { enabled: false, targets: [] },
    ]);
    if (first[0] !== undefined) first[0].config.theme = "dark";

    const second = await store.readAllProfileConfigs();
    expect(second[0]?.config.theme).toBe(defaultConfig.theme);
    expect(second[1]?.config.theme).toBe("light");
  });

  itWithStore("rotiert bei Mutationen vollständige Version-2-Dokumente", async ({ configPath, store }) => {
    const catalog = await store.readCatalog();
    const created = await store.createProfile(catalog.profilesUpdatedAt, "Arbeit", DEFAULT_PROFILE_ID);
    expect(created.kind).toBe("ok");
    if (created.kind !== "ok" || created.createdId === undefined) return;

    const renamed = await store.renameProfile(created.createdId, created.catalog.profilesUpdatedAt, "Office");
    expect(renamed.kind).toBe("ok");
    const backup: unknown = JSON.parse(await readFile(`${configPath}.1`, "utf8"));
    expect(backup).toEqual(expect.objectContaining({ version: 2 }));
    expect(backup).toEqual(expect.objectContaining({ profiles: expect.any(Array) }));
    expect((backup as { profiles: unknown[] }).profiles).toHaveLength(2);
  });
});

describe("profile catalog mutations", () => {
  itWithStore("dupliziert ein Profil vollständig mit neuer UUID und unabhängiger Config-Revision", async ({ store }) => {
    const catalog = await store.readCatalog();
    const source = await store.readProfileConfig(DEFAULT_PROFILE_ID);
    expect(source.kind).toBe("ok");
    if (source.kind !== "ok") return;

    const result = await store.createProfile(catalog.profilesUpdatedAt, "Arbeit", DEFAULT_PROFILE_ID);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || result.createdId === undefined) return;
    expect(result.createdId).not.toBe(DEFAULT_PROFILE_ID);
    expect(result.createdId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const copied = await store.readProfileConfig(result.createdId);
    expect(copied.kind).toBe("ok");
    if (copied.kind !== "ok") return;
    expect(copied.config).toEqual(expect.objectContaining({ ...source.config, updatedAt: expect.any(String) }));
    expect(copied.config.updatedAt).not.toBe(source.config.updatedAt);
  });

  itWithStore("weist doppelte Profilnamen ohne Beachtung der Großschreibung zurück", async ({ store }) => {
    const catalog = await store.readCatalog();
    const result = await store.createProfile(catalog.profilesUpdatedAt, " standard ", DEFAULT_PROFILE_ID);
    expect(result.kind).toBe("invalid");
  });

  itWithStore("benennt ein Profil um und behält seine ID", async ({ store }) => {
    const catalog = await store.readCatalog();
    const created = await store.createProfile(catalog.profilesUpdatedAt, "Arbeit", DEFAULT_PROFILE_ID);
    expect(created.kind).toBe("ok");
    if (created.kind !== "ok" || created.createdId === undefined) return;
    const renamed = await store.renameProfile(created.createdId, created.catalog.profilesUpdatedAt, "Privat");
    expect(renamed.kind).toBe("ok");
    if (renamed.kind !== "ok") return;
    expect(renamed.catalog.profiles).toContainEqual({ id: created.createdId, name: "Privat" });
  });

  itWithStore("löscht ein Profil, aber verweigert das letzte verbleibende Profil", async ({ store }) => {
    const catalog = await store.readCatalog();
    const created = await store.createProfile(catalog.profilesUpdatedAt, "Arbeit", DEFAULT_PROFILE_ID);
    expect(created.kind).toBe("ok");
    if (created.kind !== "ok" || created.createdId === undefined) return;
    const deleted = await store.deleteProfile(created.createdId, created.catalog.profilesUpdatedAt);
    expect(deleted.kind).toBe("ok");
    if (deleted.kind !== "ok") return;
    const last = await store.deleteProfile(DEFAULT_PROFILE_ID, deleted.catalog.profilesUpdatedAt);
    expect(last.kind).toBe("last-profile");
  });

  itWithStore("weist unbekannte Quellen und Ziele sowie einen veralteten Katalog zurück", async ({ store }) => {
    const catalog = await store.readCatalog();
    const unknownSource = await store.createProfile(catalog.profilesUpdatedAt, "Arbeit", "123e4567-e89b-42d3-a456-426614174000");
    expect(unknownSource.kind).toBe("not-found");
    const unknownTarget = await store.renameProfile("123e4567-e89b-42d3-a456-426614174000", catalog.profilesUpdatedAt, "Arbeit");
    expect(unknownTarget.kind).toBe("not-found");
    const stale = await store.createProfile("1999-01-01T00:00:00.000Z", "Arbeit", DEFAULT_PROFILE_ID);
    expect(stale.kind).toBe("conflict");
  });

  itWithStore("begrenzt den Katalog auf 16 Profile", async ({ store }) => {
    let catalog = await store.readCatalog();
    for (let index = 1; index < 16; index += 1) {
      const result = await store.createProfile(catalog.profilesUpdatedAt, `Profil ${index}`, DEFAULT_PROFILE_ID);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      catalog = result.catalog;
    }
    const tooMany = await store.createProfile(catalog.profilesUpdatedAt, "Zu viel", DEFAULT_PROFILE_ID);
    expect(tooMany.kind).toBe("invalid");
  });

  itWithStore("isoliert Config-CAS-Revisionen zwischen Profilen", async ({ store }) => {
    const catalog = await store.readCatalog();
    const created = await store.createProfile(catalog.profilesUpdatedAt, "Arbeit", DEFAULT_PROFILE_ID);
    expect(created.kind).toBe("ok");
    if (created.kind !== "ok" || created.createdId === undefined) return;
    const privateConfig = await store.readProfileConfig(DEFAULT_PROFILE_ID);
    const workConfig = await store.readProfileConfig(created.createdId);
    expect(privateConfig.kind).toBe("ok");
    expect(workConfig.kind).toBe("ok");
    if (privateConfig.kind !== "ok" || workConfig.kind !== "ok") return;

    const privateWrite = await store.updateConfig(DEFAULT_PROFILE_ID, privateConfig.config.updatedAt, {
      ...privateConfig.config,
      theme: "dark",
    });
    const workWrite = await store.updateConfig(created.createdId, workConfig.config.updatedAt, {
      ...workConfig.config,
      theme: "light",
    });
    expect(privateWrite.kind).toBe("ok");
    expect(workWrite.kind).toBe("ok");
  });

  itWithStore("weist eine zu große Duplikation vor der Backup-Rotation ab", async ({ configPath, store }) => {
    const links = Array.from({ length: 100 }, (_, index) => ({
      label: `link-${index}`,
      url: `https://example.com/${"x".repeat(1300)}`,
    }));
    const candidate: Config = {
      ...defaultConfig,
      linkGroups: [
        { title: "groß", links },
        { title: "groß2", links },
        { title: "groß3", links },
      ],
    };
    const current = await store.readProfileConfig(DEFAULT_PROFILE_ID);
    expect(current.kind).toBe("ok");
    if (current.kind !== "ok") return;
    const changed = await store.updateConfig(DEFAULT_PROFILE_ID, current.config.updatedAt, candidate);
    expect(changed.kind).toBe("ok");
    await writeFile(`${configPath}.1`, "unverändert");
    const catalog = await store.readCatalog();
    await expect(store.createProfile(catalog.profilesUpdatedAt, "Arbeit", DEFAULT_PROFILE_ID)).rejects.toThrow("Config-Datei ist zu groß");
    expect(await readFile(`${configPath}.1`, "utf8")).toBe("unverändert");
  });
});
