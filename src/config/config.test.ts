import { describe, expect, it } from "vitest";
import { configSchema, isSafeLocalCalendarPath } from "./schema";
import { defaultConfig } from "./defaults";
import { readLocalConfig } from "./local";
import { importConfig, restoreConfig } from "./io";

function configFile(value: unknown): File {
  const source = JSON.stringify(value);
  const file = new File([source], "config.json");
  // Die schlanke jsdom-File-Implementierung hat in dieser Testumgebung kein Blob.text().
  Object.defineProperty(file, "text", { configurable: true, value: async () => source });
  return file;
}

describe("configSchema", () => {
  it("akzeptiert die Defaults", () => {
    expect(() => configSchema.parse(defaultConfig)).not.toThrow();
  });

  it("weist ein Objekt ohne location ab", () => {
    const { location: _omit, ...rest } = defaultConfig;
    expect(configSchema.safeParse(rest).success).toBe(false);
  });

  it("ergänzt die Feiertagsregion bei einer alten Config deterministisch", () => {
    const { holidayRegion: _omit, ...legacy } = defaultConfig;
    const parsed = configSchema.parse(legacy);
    expect(parsed.holidayRegion).toBe("BW");
  });

  it("aktiviert Homelab-Monitoring bei einer alten Config ohne Schalter", () => {
    const { enabled: _enabled, ...legacyHomelab } = defaultConfig.homelab;
    const legacy = { ...defaultConfig, homelab: legacyHomelab };
    expect(configSchema.parse(legacy).homelab.enabled).toBe(true);
    expect(defaultConfig.homelab.enabled).toBe(false);
  });

  it("entfernt das historische, wirkungslose Homelab-span beim Parsen", () => {
    const legacy = {
      ...defaultConfig,
      layout: defaultConfig.layout.map((entry) => entry.id === "homelab"
        ? { ...entry, span: 1 }
        : entry),
    };
    const parsed = configSchema.parse(legacy);
    expect(parsed.layout.find((entry) => entry.id === "homelab")).toEqual({
      id: "homelab",
      visible: true,
    });
  });

  it.each([
    ["ungültige Zeitzone", { clock: { secondary: [{ label: "x", tz: "Nicht/Real" }] } }],
    ["ungültige Koordinaten", { location: { ...defaultConfig.location, lat: 91 } }],
    ["ungültigen Port", { homelab: { ...defaultConfig.homelab, reachability: [{ label: "x", host: "localhost", port: 65536 }] } }],
    ["ungültige Suchvorlage", { search: { ...defaultConfig.search, default: "javascript:alert(%s)" } }],
    ["ungültigen Kalenderpfad", { calendars: [{ label: "x", url: "//evil.example/work.ics" }] }],
    ["Proxmox-URL mit Fragment", { homelab: { ...defaultConfig.homelab, uiUrl: "https://pve.example/#overview" } }],
    ["Proxmox-URL mit Pfad", { homelab: { ...defaultConfig.homelab, uiUrl: "https://pve.example/ui" } }],
  ])("weist %s zentral ab", (_name, change) => {
    expect(configSchema.safeParse({ ...defaultConfig, ...change }).success).toBe(false);
  });

  it("weist doppelte Pane-IDs, VMIDs und Link-Kürzel ab", () => {
    const duplicatePane = defaultConfig.layout.map((entry, index) => index === 1 ? { ...entry, id: "clock" as const } : entry);
    const duplicateVmid = { ...defaultConfig.homelab, expectRunning: [100, 100] };
    const duplicateHint = defaultConfig.linkGroups.map((group, groupIndex) => groupIndex === 0
      ? { ...group, links: group.links.map((link, linkIndex) => linkIndex === 1 ? { ...link, hint: "gd" } : link) }
      : group);

    expect(configSchema.safeParse({ ...defaultConfig, layout: duplicatePane }).success).toBe(false);
    expect(configSchema.safeParse({ ...defaultConfig, homelab: duplicateVmid }).success).toBe(false);
    expect(configSchema.safeParse({ ...defaultConfig, linkGroups: duplicateHint }).success).toBe(false);
  });

  it("akzeptiert sichere Proxmox-Node-Namen", () => {
    for (const node of ["pve", "pve-home-01"]) {
      const parsed = configSchema.safeParse({
        ...defaultConfig,
        homelab: { ...defaultConfig.homelab, node },
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("kanonisiert Allowlist- und Erreichbarkeits-Hosts auf lowercase", () => {
    const parsed = configSchema.parse({
      ...defaultConfig,
      proxyAllowlist: ["API.Open-Meteo.COM"],
      homelab: {
        ...defaultConfig.homelab,
        reachability: [{ label: "Router", host: "ROUTER.Home", port: 80 }],
      },
    });
    expect(parsed.proxyAllowlist).toEqual(["api.open-meteo.com"]);
    expect(parsed.homelab.reachability[0]?.host).toBe("router.home");
  });

  it.each([
    "-router.home",
    "router-.home",
    "router..home",
    `${"a".repeat(64)}.home`,
    `${"a".repeat(250)}.home`,
  ])("weist einen ungültigen DNS-Hostnamen ab: %s", (host) => {
    const parsed = configSchema.safeParse({
      ...defaultConfig,
      proxyAllowlist: [host],
    });
    expect(parsed.success).toBe(false);
  });

  it.each(["d", "g", "g_", "g-", "Gd"])("weist ein nicht auslösbares Link-Kürzel ab: %s", (hint) => {
    const parsed = configSchema.safeParse({
      ...defaultConfig,
      linkGroups: defaultConfig.linkGroups.map((group, groupIndex) => groupIndex === 0
        ? { ...group, links: group.links.map((link, linkIndex) => linkIndex === 0 ? { ...link, hint } : link) }
        : group),
    });
    expect(parsed.success).toBe(false);
  });

  it.each(["/", "..", "../cluster", "pve?x=1", "pve#x", "pve\\home", "pve home"])(
    "weist einen unsicheren Proxmox-Node-Namen ab: %s",
    (node) => {
      const parsed = configSchema.safeParse({
        ...defaultConfig,
        homelab: { ...defaultConfig.homelab, node },
      });
      expect(parsed.success).toBe(false);
    },
  );
});

describe("isSafeLocalCalendarPath", () => {
  it("akzeptiert nur einen lokalen ICS-Pfad unter /static", () => {
    expect(isSafeLocalCalendarPath("/static/arbeit.ics")).toBe(true);
    expect(isSafeLocalCalendarPath("/static/team/arbeit.ics")).toBe(true);
    expect(isSafeLocalCalendarPath("//evil.example/work.ics")).toBe(false);
    expect(isSafeLocalCalendarPath("/static/../config.json")).toBe(false);
    expect(isSafeLocalCalendarPath("/static/%2e%2e/config.json")).toBe(false);
    expect(isSafeLocalCalendarPath("/static/work.ics\\evil")).toBe(false);
  });
});

describe("readLocalConfig", () => {
  it("liefert bei kaputtem JSON undefined und wirft nicht", () => {
    localStorage.setItem("dashboard:config", "{kaputt");
    expect(() => readLocalConfig()).not.toThrow();
    expect(readLocalConfig()).toBeUndefined();
  });

  it("liefert undefined, wenn nichts gespeichert ist", () => {
    localStorage.removeItem("dashboard:config");
    expect(readLocalConfig()).toBeUndefined();
  });
});

describe("restoreConfig", () => {
  it("übernimmt beim Restore die aktuelle Serverrevision", () => {
    const imported = { ...defaultConfig, theme: "light" as const, updatedAt: "alter-stand" };
    const current = { ...defaultConfig, updatedAt: "aktueller-stand" };
    const restored = restoreConfig(imported, current);
    expect(restored.theme).toBe("light");
    expect(restored.updatedAt).toBe("aktueller-stand");
  });
});

describe("importConfig", () => {
  it("kanonisiert eine gültige importierte Allowlist", async () => {
    const imported = { ...defaultConfig, proxyAllowlist: ["API.OPEN-METEO.COM"] };
    const result = await importConfig(configFile(imported));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.proxyAllowlist).toEqual(["api.open-meteo.com"]);
  });

  it("weist einen nichtkanonischen DNS-Labelrand im Import ab", async () => {
    const imported = { ...defaultConfig, proxyAllowlist: ["-api.open-meteo.com"] };
    const result = await importConfig(configFile(imported));
    expect(result.ok).toBe(false);
  });
});
