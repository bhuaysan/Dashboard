import { describe, expect, it } from "vitest";
import { configSchema, isSafeLocalCalendarPath } from "./schema";
import { defaultConfig } from "./defaults";
import { readLocalConfig } from "./local";
import { restoreConfig } from "./io";

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

  it.each([
    ["ungültige Zeitzone", { clock: { secondary: [{ label: "x", tz: "Nicht/Real" }] } }],
    ["ungültige Koordinaten", { location: { ...defaultConfig.location, lat: 91 } }],
    ["ungültigen Port", { homelab: { ...defaultConfig.homelab, reachability: [{ label: "x", host: "localhost", port: 65536 }] } }],
    ["ungültige Suchvorlage", { search: { ...defaultConfig.search, default: "javascript:alert(%s)" } }],
    ["ungültigen Kalenderpfad", { calendars: [{ label: "x", url: "//evil.example/work.ics" }] }],
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
