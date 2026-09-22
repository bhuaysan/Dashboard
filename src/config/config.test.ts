import { afterEach, describe, expect, it, vi } from "vitest";
import { configSchema, isSafeLocalCalendarPath, profileDocumentSchema } from "./schema";
import { defaultConfig, defaultProfileDocument } from "./defaults";
import { readLocalConfig } from "./local";
import { exportConfig, importConfig, restoreConfig } from "./io";

const HTTP_ID = "123e4567-e89b-42d3-a456-426614174010";
const TCP_ID = "123e4567-e89b-42d3-a456-426614174011";

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

  it("ergänzt Uptime bei einer alten Config deterministisch", () => {
    const { uptime: _omit, ...legacy } = defaultConfig;
    expect(configSchema.parse(legacy).uptime).toEqual({ enabled: false, targets: [] });
  });

  it("akzeptiert HTTP- und TCP-Ziele mit frei wählbarem Port", () => {
    const parsed = configSchema.parse({
      ...defaultConfig,
      uptime: {
        enabled: true,
        targets: [
          { id: HTTP_ID, type: "http", label: "Immich", url: "https://photos.example/health" },
          { id: TCP_ID, type: "tcp", label: "Minecraft", host: "MC.Example", port: 25567 },
        ],
      },
    });
    expect(parsed.uptime.targets[1]).toMatchObject({ host: "mc.example", port: 25567 });
  });

  it.each([
    ["URL mit Zugangsdaten", [{ id: HTTP_ID, type: "http", label: "Web", url: "https://user:pass@example.com/" }]],
    ["Nicht-HTTP-URL", [{ id: HTTP_ID, type: "http", label: "Web", url: "ftp://example.com/" }]],
    ["ungültige UUID", [{ id: "nicht-eindeutig", type: "http", label: "Web", url: "https://example.com/" }]],
    ["leeres Label", [{ id: HTTP_ID, type: "http", label: "   ", url: "https://example.com/" }]],
    ["Label mit Steuerzeichen", [{ id: HTTP_ID, type: "http", label: "Web\nIntern", url: "https://example.com/" }]],
    ["ungültiger Host", [{ id: TCP_ID, type: "tcp", label: "TCP", host: "bad..host", port: 80 }]],
    ["Port 0", [{ id: TCP_ID, type: "tcp", label: "TCP", host: "tcp.example", port: 0 }]],
    ["Port 65536", [{ id: TCP_ID, type: "tcp", label: "TCP", host: "tcp.example", port: 65536 }]],
  ])("weist Uptime-Ziele mit %s ab", (_reason, targets) => {
    expect(configSchema.safeParse({
      ...defaultConfig,
      uptime: { enabled: true, targets },
    }).success).toBe(false);
  });

  it("weist doppelte Uptime-Ziel-IDs ab", () => {
    expect(configSchema.safeParse({
      ...defaultConfig,
      uptime: {
        enabled: true,
        targets: [
          { id: HTTP_ID, type: "http", label: "Web", url: "https://example.com/" },
          { id: HTTP_ID, type: "tcp", label: "TCP", host: "tcp.example", port: 80 },
        ],
      },
    }).success).toBe(false);
  });

  it("weist mehr als 32 Uptime-Ziele ab", () => {
    const targets = Array.from({ length: 33 }, (_, index) => ({
      id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`,
      type: "http" as const,
      label: `Web ${index}`,
      url: `https://service-${index}.example/`,
    }));
    expect(configSchema.safeParse({
      ...defaultConfig,
      uptime: { enabled: true, targets },
    }).success).toBe(false);
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

  it("akzeptiert dreistellige Link-Kürzel", () => {
    const linkGroups = structuredClone(defaultConfig.linkGroups);
    const link = linkGroups[0]?.links[0];
    if (link) link.hint = "gxa";
    expect(configSchema.safeParse({ ...defaultConfig, linkGroups }).success).toBe(true);
  });

  it("weist Kürzel ab, wenn eines Präfix eines anderen ist", () => {
    const linkGroups = structuredClone(defaultConfig.linkGroups);
    const first = linkGroups[0]?.links[0];
    const second = linkGroups[0]?.links[1];
    if (first) first.hint = "gx";
    if (second) second.hint = "gxa";
    expect(configSchema.safeParse({ ...defaultConfig, linkGroups }).success).toBe(false);
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

describe("profileDocumentSchema", () => {
  const validDocument = {
    version: 2,
    profilesUpdatedAt: "2026-09-15T00:00:00.000Z",
    profiles: [
      { id: "default", name: "Standard", config: defaultConfig },
      { id: "123e4567-e89b-42d3-a456-426614174000", name: "Arbeit", config: defaultConfig },
    ],
  };

  it("akzeptiert mehrere gültige Profile", () => {
    const document = profileDocumentSchema.parse(validDocument);
    expect(document.profiles).toHaveLength(2);
  });

  it("weist ein Dokument ohne Profile ab", () => {
    expect(profileDocumentSchema.safeParse({ ...validDocument, profiles: [] }).success).toBe(false);
  });

  it("weist mehr als 16 Profile ab", () => {
    const profiles = Array.from({ length: 17 }, (_, index) => ({
      id: `123e4567-e89b-42d3-a456-426614174${String(index).padStart(3, "0")}`,
      name: `Profil ${index}`,
      config: defaultConfig,
    }));
    expect(profileDocumentSchema.safeParse({ ...validDocument, profiles }).success).toBe(false);
  });

  it("weist doppelte Profil-IDs ab", () => {
    const profiles = [
      ...validDocument.profiles,
      { id: "default", name: "Privat", config: defaultConfig },
    ];
    expect(profileDocumentSchema.safeParse({ ...validDocument, profiles }).success).toBe(false);
  });

  it("weist Profilnamen ab, die sich unabhängig von Groß-/Kleinschreibung wiederholen", () => {
    const profiles = [
      { id: "default", name: "Privat", config: defaultConfig },
      { id: "123e4567-e89b-42d3-a456-426614174000", name: " privat ", config: defaultConfig },
    ];
    expect(profileDocumentSchema.safeParse({ ...validDocument, profiles }).success).toBe(false);
  });

  it("trimmt Profilnamen im geparsten Dokument", () => {
    const profiles = [{ id: "default", name: " Standard ", config: defaultConfig }];
    const parsed = profileDocumentSchema.safeParse({ ...validDocument, profiles });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.profiles[0]?.name).toBe("Standard");
  });

  it.each([
    ["Steuerzeichen", "Pri\nvat"],
    ["nur Leerzeichen", "   "],
  ])("weist Profilnamen mit %s ab", (_reason, name) => {
    const profiles = [{ id: "default", name, config: defaultConfig }];
    expect(profileDocumentSchema.safeParse({ ...validDocument, profiles }).success).toBe(false);
  });

  it.each([
    "DEFAULT",
    "123e4567-e89b-42d3-a456-426614174000 ",
    "123e4567-e89b-12d3-a456-426614174000",
    "123e4567-e89b-42d3-7456-426614174000",
    "123e4567-e89b-42d3-a456-42661417400Z",
  ])("weist eine ungültige Profil-ID ab: %s", (id) => {
    const profiles = [{ id, name: "Standard", config: defaultConfig }];
    expect(profileDocumentSchema.safeParse({ ...validDocument, profiles }).success).toBe(false);
  });

  it("weist ein Dokument mit ungültiger enthaltenen Config ab", () => {
    const { location: _omit, ...invalidConfig } = defaultConfig;
    const profiles = [{ id: "default", name: "Standard", config: invalidConfig }];
    expect(profileDocumentSchema.safeParse({ ...validDocument, profiles }).success).toBe(false);
  });

  it("exportiert das deterministische Standardprofil", () => {
    expect(defaultProfileDocument).toEqual({
      version: 2,
      profilesUpdatedAt: "2026-08-05T00:00:00.000Z",
      profiles: [{ id: "default", name: "Standard", config: defaultConfig }],
    });
  });
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

describe("exportConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["Arbeit Zuhause", "dashboard-arbeit-zuhause.json"],
    ["Arbeit/Zuhause", "dashboard-arbeit-zuhause.json"],
    ["Arbeit\nZuhause", "dashboard-arbeit-zuhause.json"],
    ["/\\\u0000", "dashboard-profil.json"],
  ])("bereinigt den Profilnamen %j zum Dateinamen %j", (profileName, expected) => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
    let download = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      download = this.download;
    });

    exportConfig(defaultConfig, profileName);

    expect(download).toBe(expected);
  });
});
