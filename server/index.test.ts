import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROFILE_ID, type Config, type ProfileDocument, type ProfileId } from "../src/config/schema";
import { defaultConfig } from "../src/config/defaults";
import { createApp, inertProxyResponse, readJsonBody } from "./app.ts";
import type { DashboardEnvironment } from "./env.ts";
import { emptyHomelab } from "./pve.ts";
import type { HomelabFetcher } from "./homelab-cache.ts";

type AppFixture = {
  app: ReturnType<typeof createApp>;
  configPath: string;
  tempDir: string;
};

type FixtureOptions = {
  config?: Config;
  document?: ProfileDocument;
  homelabFetcher?: HomelabFetcher;
};

const secondProfileId = "123e4567-e89b-42d3-a456-426614174000" as ProfileId;

const homelabFetcher = vi.fn<HomelabFetcher>(async () => emptyHomelab);

async function createFixture(options: FixtureOptions = {}): Promise<AppFixture> {
  const tempDir = await mkdtemp(join(tmpdir(), "dashboard-api-"));
  const configPath = join(tempDir, "config.json");
  const staticPath = join(tempDir, "static");
  await mkdir(staticPath);
  await mkdir(join(tempDir, "dist"));
  await writeFile(join(tempDir, "dist", "index.html"), '<html><body><div id="root">Dashboard</div></body></html>');
  await writeFile(join(staticPath, "arbeit.ics"), "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
  if (options.document) await writeFile(configPath, JSON.stringify(options.document));
  else if (options.config) await writeFile(configPath, JSON.stringify(options.config));
  const testEnv: DashboardEnvironment = {
    port: 7777,
    configPath,
    staticPath,
    writeAllow: ["127.0.0.1"],
    writeHosts: ["start.home.arpa", "10.0.10.20", "localhost", "127.0.0.1"],
  };
  return {
    app: createApp({
      env: testEnv,
      distRoot: join(tempDir, "dist"),
      homelabFetcher: options.homelabFetcher,
    }),
    configPath,
    tempDir,
  };
}

function itWithApp(name: string, test: (fixture: AppFixture) => Promise<void>, options?: FixtureOptions): void {
  it(name, async () => {
    const fixture = await createFixture(options);
    try {
      await test(fixture);
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  });
}

async function getConfig(app: ReturnType<typeof createApp>): Promise<Config> {
  const res = await app.request(`/api/config?profile=${DEFAULT_PROFILE_ID}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Config;
}

// getConnInfo liest die Absenderadresse aus dem Node-Socket; im Test wird er nachgebildet,
// weil der Write-Guard ohne bekannte Adresse ablehnt.
function connInfo(address: string) {
  return { incoming: { socket: { remoteAddress: address, remotePort: 51234, remoteFamily: "IPv4" } } };
}

function putConfig(app: ReturnType<typeof createApp>, cfg: Config, ifMatch: string, from = "127.0.0.1", extraHeaders: Record<string, string> = {}) {
  return app.request(
    `/api/config?profile=${DEFAULT_PROFILE_ID}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json", "If-Match": ifMatch, host: "localhost:7777", ...extraHeaders },
      body: JSON.stringify(cfg),
    },
    connInfo(from),
  );
}

function nearLimitConfig(base: Config): Config {
  const links: Config["linkGroups"][number]["links"] = Array.from({ length: 100 }, (_, index) => ({
    label: `link-${index}`,
    url: `https://example.com/${"x".repeat(1660)}`,
  }));
  return {
    ...base,
    linkGroups: [
      { title: "groß", links },
      { title: "groß2", links },
      { title: "groß3", links },
    ],
  };
}

function twoProfileDocument(defaultOverrides: Partial<Config> = {}, secondOverrides: Partial<Config> = {}): ProfileDocument {
  return {
    version: 2,
    profilesUpdatedAt: "2026-08-08T12:00:00.000Z",
    profiles: [
      {
        id: DEFAULT_PROFILE_ID,
        name: "Standard",
        config: { ...defaultConfig, ...defaultOverrides },
      },
      {
        id: secondProfileId,
        name: "Arbeit",
        config: { ...defaultConfig, ...secondOverrides },
      },
    ],
  };
}

describe("/api/config", () => {
  itWithApp("GET liefert die Config", async ({ app }) => {
    const cfg = await getConfig(app);
    expect(cfg.location.label).toBe("Heilbronn");
  });

  itWithApp("GET enthält keine Werte aus der .env", async ({ app }) => {
    const res = await app.request(`/api/config?profile=${DEFAULT_PROFILE_ID}`);
    const text = await res.text();
    expect(text.toLowerCase().includes("token")).toBe(false);
    expect(text.toLowerCase().includes("secret")).toBe(false);
  });

  itWithApp("Health liefert ohne Config-Inhalt einen Readiness-Status", async ({ app }) => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  itWithApp("PUT mit passendem If-Match schreibt und erneuert updatedAt", async ({ app, configPath }) => {
    const before = await getConfig(app);
    const next = { ...before, theme: "light" as const };
    const res = await putConfig(app, next, before.updatedAt);
    expect(res.status).toBe(200);
    const saved = (await res.json()) as Config;
    expect(saved.theme).toBe("light");
    expect(saved.updatedAt).not.toBe(before.updatedAt);
    const onDisk = JSON.parse(await readFile(configPath, "utf8")) as { profiles: Array<{ config: Config }> };
    expect(onDisk.profiles[0]?.config.theme).toBe("light");
  });

  itWithApp("PUT mit altem If-Match liefert 409 und den aktuellen Stand", async ({ app }) => {
    const before = await getConfig(app);
    const first = await putConfig(app, { ...before, theme: "dark" as const }, before.updatedAt);
    expect(first.status).toBe(200);
    const firstSaved = (await first.json()) as Config;
    const second = await putConfig(app, { ...before, theme: "light" as const }, before.updatedAt);
    expect(second.status).toBe(409);
    // Der Client braucht diesen Stempel, um einen erneuten Versuch erfolgreich zu
    // wiederholen — ohne ihn würde er mit demselben veralteten If-Match wieder scheitern.
    const body = (await second.json()) as { current?: string };
    expect(body.current).toBe(firstSaved.updatedAt);
  });

  itWithApp("akzeptiert bei parallelen PUTs mit demselben If-Match genau einen Gewinner", async ({ app }) => {
    const before = await getConfig(app);
    const [first, second] = await Promise.all([
      putConfig(app, { ...before, theme: "dark" as const }, before.updatedAt),
      putConfig(app, { ...before, theme: "light" as const }, before.updatedAt),
    ]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409]);
  });

  itWithApp("stellt einen alten Export mit der aktuellen Revision CAS-geschützt wieder her", async ({ app }) => {
    const snapshot = await getConfig(app);
    const changed = await putConfig(app, { ...snapshot, theme: "light" as const }, snapshot.updatedAt);
    expect(changed.status).toBe(200);
    const current = await getConfig(app);
    const restored = await putConfig(app, { ...snapshot, updatedAt: current.updatedAt }, current.updatedAt);
    expect(restored.status).toBe(200);
    const saved = (await restored.json()) as Config;
    expect(saved.theme).toBe(snapshot.theme);
  });

  itWithApp("PUT mit ungültigem Body liefert 400", async ({ app }) => {
    const before = await getConfig(app);
    const res = await putConfig(app, { ...before, location: undefined } as unknown as Config, before.updatedAt);
    expect(res.status).toBe(400);
  });

  itWithApp("PUT von einer nicht freigegebenen Adresse liefert 403", async ({ app }) => {
    const before = await getConfig(app);
    const res = await putConfig(app, before, before.updatedAt, "10.0.99.99");
    expect(res.status).toBe(403);
  });

  itWithApp("PUT ohne erkennbare Absenderadresse liefert 403", async ({ app }) => {
    const before = await getConfig(app);
    const res = await app.request(`/api/config?profile=${DEFAULT_PROFILE_ID}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "If-Match": before.updatedAt, host: "localhost:7777" },
      body: JSON.stringify(before),
    });
    expect(res.status).toBe(403);
  });

  itWithApp("prüft Host und Origin zusätzlich zur Absenderadresse", async ({ app }) => {
    const before = await getConfig(app);
    const foreignHost = await putConfig(app, before, before.updatedAt, "127.0.0.1", { host: "evil.example" });
    expect(foreignHost.status).toBe(403);
    const foreignOrigin = await putConfig(app, before, before.updatedAt, "127.0.0.1", {
      host: "start.home.arpa",
      origin: "http://evil.example",
    });
    expect(foreignOrigin.status).toBe(403);
    const crossPort = await putConfig(app, before, before.updatedAt, "127.0.0.1", {
      host: "start.home.arpa:7777",
      origin: "http://start.home.arpa",
    });
    expect(crossPort.status).toBe(403);
    const crossScheme = await putConfig(app, before, before.updatedAt, "127.0.0.1", {
      host: "start.home.arpa",
      origin: "https://start.home.arpa",
    });
    expect(crossScheme.status).toBe(403);
    const viteDev = await putConfig(app, before, before.updatedAt, "127.0.0.1", {
      host: "localhost:7777",
      origin: "http://localhost:5173",
    });
    expect(viteDev.status).toBe(200);
  });

  itWithApp("kanonisiert Hostnamen auch beim direkten PUT", async ({ app }) => {
    const before = await getConfig(app);
    const candidate = { ...before, proxyAllowlist: ["API.OPEN-METEO.COM"] };
    const res = await putConfig(app, candidate, before.updatedAt);
    expect(res.status).toBe(200);
    const saved = (await res.json()) as Config;
    expect(saved.proxyAllowlist[0]).toBe("api.open-meteo.com");
  });

  itWithApp("persistiert einen abgeleiteten Feed-Host nicht in der manuellen Allowlist", async ({ app }) => {
    const before = await getConfig(app);
    const candidate = {
      ...before,
      feeds: [...before.feeds, { label: "zt", url: "https://newsfeed.zeit.de/index", limit: 5 }],
    };
    const res = await putConfig(app, candidate, before.updatedAt);
    expect(res.status).toBe(200);
    const saved = (await res.json()) as Config;
    expect(saved.proxyAllowlist).toEqual(before.proxyAllowlist);
  });

  itWithApp("weist einen zu großen JSON-Body mit 413 ab", async ({ app }) => {
    const before = await getConfig(app);
    const padding = "x".repeat(600 * 1024);
    const res = await app.request(`/api/config?profile=${DEFAULT_PROFILE_ID}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "If-Match": before.updatedAt, host: "localhost:7777" },
      body: JSON.stringify({ padding }),
    }, connInfo("127.0.0.1"));
    expect(res.status).toBe(413);
  });

  itWithApp("weist eine zu große endgültige Dateidarstellung als Clientfehler ab", async ({ app, configPath }) => {
    const seed = await getConfig(app);
    const seeded = await putConfig(app, seed, seed.updatedAt);
    expect(seeded.status).toBe(200);
    const before = await getConfig(app);
    const beforeDisk = await readFile(configPath, "utf8");
    const res = await putConfig(app, nearLimitConfig(before), before.updatedAt);
    expect(res.status).toBe(413);
    expect(await readFile(configPath, "utf8")).toBe(beforeDisk);
  });

  itWithApp("liefert bei einem nicht sicherbaren Config-Backup 503", async ({ app, configPath }) => {
    await rm(`${configPath}.bak`, { force: true, recursive: true });
    await writeFile(configPath, "{");
    await mkdir(`${configPath}.bak`);
    try {
      const res = await app.request(`/api/config?profile=${DEFAULT_PROFILE_ID}`);
      expect(res.status).toBe(503);
    } finally {
      await rm(`${configPath}.bak`, { force: true, recursive: true });
      await rm(configPath, { force: true });
    }
  });

  itWithApp("verlangt, validiert und verwendet die Profil-ID", async ({ app }) => {
    const missing = await app.request("/api/config");
    expect(missing.status).toBe(400);

    const malformed = await app.request("/api/config?profile=ungueltig");
    expect(malformed.status).toBe(400);

    const unknown = await app.request("/api/config?profile=123e4567-e89b-42d3-a456-426614174000");
    expect(unknown.status).toBe(404);
  });

  itWithApp("liefert die Config des ausgewählten Profils", async ({ app }) => {
    const response = await app.request(`/api/config?profile=${secondProfileId}`);
    expect(response.status).toBe(200);
    const config = (await response.json()) as Config;
    expect(config.location.label).toBe("Arbeit");
  }, {
    document: twoProfileDocument(
      { location: { label: "Standard", lat: 1, lon: 2 } },
      { location: { label: "Arbeit", lat: 3, lon: 4 } },
    ),
  });
});

describe("/api/profiles", () => {
  itWithApp("liefert nur den Profilkatalog", async ({ app }) => {
    const response = await app.request("/api/profiles");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profilesUpdatedAt: defaultConfig.updatedAt,
      profiles: [{ id: DEFAULT_PROFILE_ID, name: "Standard" }],
    });
  });

  itWithApp("legt ein Profil an, benennt es um und löscht es", async ({ app }) => {
    const initial = await app.request("/api/profiles");
    const initialCatalog = await initial.json() as { profilesUpdatedAt: string };
    const created = await app.request("/api/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "If-Match": initialCatalog.profilesUpdatedAt,
        host: "localhost:7777",
      },
      body: JSON.stringify({ name: "Arbeit", sourceProfileId: DEFAULT_PROFILE_ID }),
    }, connInfo("127.0.0.1"));
    expect(created.status).toBe(200);
    const createdBody = await created.json() as {
      createdId?: string;
      catalog: { profilesUpdatedAt: string; profiles: Array<{ id: string; name: string }> };
    };
    expect(createdBody.createdId).toMatch(/^[0-9a-f-]{36}$/);
    expect(createdBody.catalog.profiles).toContainEqual({ id: createdBody.createdId, name: "Arbeit" });

    const renamed = await app.request(`/api/profiles/${createdBody.createdId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "If-Match": createdBody.catalog.profilesUpdatedAt,
        host: "localhost:7777",
      },
      body: JSON.stringify({ name: "Privat" }),
    }, connInfo("127.0.0.1"));
    expect(renamed.status).toBe(200);
    const renamedBody = await renamed.json() as { catalog: { profilesUpdatedAt: string; profiles: Array<{ id: string; name: string }> } };
    expect(renamedBody.catalog.profiles).toContainEqual({ id: createdBody.createdId, name: "Privat" });

    const deleted = await app.request(`/api/profiles/${createdBody.createdId}`, {
      method: "DELETE",
      headers: { "If-Match": renamedBody.catalog.profilesUpdatedAt, host: "localhost:7777" },
    }, connInfo("127.0.0.1"));
    expect(deleted.status).toBe(200);
    const deletedBody = await deleted.json() as { catalog: { profilesUpdatedAt: string; profiles: Array<{ id: string; name: string }> } };
    expect(deletedBody.catalog.profiles).toEqual([{ id: DEFAULT_PROFILE_ID, name: "Standard" }]);
    expect(deletedBody.catalog.profilesUpdatedAt).not.toBe(renamedBody.catalog.profilesUpdatedAt);
  });

  itWithApp("meldet Katalogkonflikte, Duplikate und unbekannte Profile stabil", async ({ app }) => {
    const initial = await app.request("/api/profiles");
    const initialCatalog = await initial.json() as { profilesUpdatedAt: string };
    const stale = await app.request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json", "If-Match": "1999-01-01T00:00:00.000Z", host: "localhost:7777" },
      body: JSON.stringify({ name: "Arbeit", sourceProfileId: DEFAULT_PROFILE_ID }),
    }, connInfo("127.0.0.1"));
    expect(stale.status).toBe(409);

    const created = await app.request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json", "If-Match": initialCatalog.profilesUpdatedAt, host: "localhost:7777" },
      body: JSON.stringify({ name: "Arbeit", sourceProfileId: DEFAULT_PROFILE_ID }),
    }, connInfo("127.0.0.1"));
    expect(created.status).toBe(200);
    const createdBody = await created.json() as { catalog: { profilesUpdatedAt: string }; createdId: string };

    const duplicate = await app.request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json", "If-Match": createdBody.catalog.profilesUpdatedAt, host: "localhost:7777" },
      body: JSON.stringify({ name: "arbeit", sourceProfileId: DEFAULT_PROFILE_ID }),
    }, connInfo("127.0.0.1"));
    expect(duplicate.status).toBe(400);

    const unknownSource = await app.request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json", "If-Match": createdBody.catalog.profilesUpdatedAt, host: "localhost:7777" },
      body: JSON.stringify({ name: "Privat", sourceProfileId: "223e4567-e89b-42d3-a456-426614174000" }),
    }, connInfo("127.0.0.1"));
    expect(unknownSource.status).toBe(404);

    const unknownTarget = await app.request("/api/profiles/223e4567-e89b-42d3-a456-426614174000", {
      method: "PATCH",
      headers: { "content-type": "application/json", "If-Match": createdBody.catalog.profilesUpdatedAt, host: "localhost:7777" },
      body: JSON.stringify({ name: "Privat" }),
    }, connInfo("127.0.0.1"));
    expect(unknownTarget.status).toBe(404);
  });

  itWithApp("verweigert das Löschen des letzten Profils", async ({ app }) => {
    const initial = await app.request("/api/profiles");
    const catalog = await initial.json() as { profilesUpdatedAt: string };
    const response = await app.request(`/api/profiles/${DEFAULT_PROFILE_ID}`, {
      method: "DELETE",
      headers: { "If-Match": catalog.profilesUpdatedAt, host: "localhost:7777" },
    }, connInfo("127.0.0.1"));
    expect(response.status).toBe(409);
  });

  itWithApp("weist ungültige JSON- und zu große Katalog-Bodies ab", async ({ app }) => {
    const malformed = await app.request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json", "If-Match": defaultConfig.updatedAt, host: "localhost:7777" },
      body: "{",
    }, connInfo("127.0.0.1"));
    expect(malformed.status).toBe(400);

    const tooLarge = await app.request(`/api/profiles/${DEFAULT_PROFILE_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "If-Match": defaultConfig.updatedAt, host: "localhost:7777" },
      body: JSON.stringify({ name: "x".repeat(600 * 1024) }),
    }, connInfo("127.0.0.1"));
    expect(tooLarge.status).toBe(413);
  });

  itWithApp("wendet Host-, Origin- und CIDR-Schutz auf POST, PATCH und DELETE an", async ({ app }) => {
    const methods = ["POST", "PATCH", "DELETE"] as const;
    for (const method of methods) {
      const path = method === "POST" ? "/api/profiles" : `/api/profiles/${DEFAULT_PROFILE_ID}`;
      const body = method === "DELETE" ? undefined : JSON.stringify(method === "POST"
        ? { name: "Arbeit", sourceProfileId: DEFAULT_PROFILE_ID }
        : { name: "Privat" });
      const headers: Record<string, string> = {
        ...(body ? { "content-type": "application/json" } : {}),
        "If-Match": defaultConfig.updatedAt,
        host: "evil.example",
      };
      const response = await app.request(path, { method, headers, ...(body ? { body } : {}) }, connInfo("127.0.0.1"));
      expect(response.status).toBe(403);

      headers.host = "localhost:7777";
      headers.origin = "http://evil.example";
      const foreignOrigin = await app.request(path, { method, headers, ...(body ? { body } : {}) }, connInfo("127.0.0.1"));
      expect(foreignOrigin.status).toBe(403);

      delete headers.origin;
      const foreignAddress = await app.request(path, { method, headers, ...(body ? { body } : {}) }, connInfo("10.0.99.99"));
      expect(foreignAddress.status).toBe(403);
    }
  });
});

describe("/api/homelab", () => {
  itWithApp("verlangt und validiert die Profil-ID", async ({ app }) => {
    const missing = await app.request("/api/homelab");
    expect(missing.status).toBe(400);

    const malformed = await app.request("/api/homelab?profile=ungueltig");
    expect(malformed.status).toBe(400);

    const unknown = await app.request("/api/homelab?profile=223e4567-e89b-42d3-a456-426614174000");
    expect(unknown.status).toBe(404);
  });

  itWithApp("weist deaktiviertes Monitoring ab, ohne den Fetcher aufzurufen", async ({ app }) => {
    const response = await app.request(`/api/homelab?profile=${DEFAULT_PROFILE_ID}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Homelab deaktiviert" });
    expect(homelabFetcher).not.toHaveBeenCalled();
  }, {
    config: {
      ...defaultConfig,
      homelab: { ...defaultConfig.homelab, enabled: false },
    },
    homelabFetcher: homelabFetcher,
  });

  itWithApp("isoliert die Homelab-Aktivierung nach Profil", async ({ app }) => {
    homelabFetcher.mockClear();
    const disabled = await app.request(`/api/homelab?profile=${DEFAULT_PROFILE_ID}`);
    expect(disabled.status).toBe(404);
    const enabled = await app.request(`/api/homelab?profile=${secondProfileId}`);
    expect(enabled.status).toBe(200);
    expect(homelabFetcher).toHaveBeenCalledTimes(1);
  }, {
    document: twoProfileDocument(
      { homelab: { ...defaultConfig.homelab, enabled: false } },
      { homelab: { ...defaultConfig.homelab, enabled: true } },
    ),
    homelabFetcher,
  });
});

describe("/api/proxy", () => {
  itWithApp("verlangt und validiert die Profil-ID", async ({ app }) => {
    const missing = await app.request("/api/proxy?url=https%3A%2F%2Fexample.com%2F");
    expect(missing.status).toBe(400);

    const malformed = await app.request("/api/proxy?profile=ungueltig&url=https%3A%2F%2Fexample.com%2F");
    expect(malformed.status).toBe(400);

    const unknown = await app.request("/api/proxy?profile=223e4567-e89b-42d3-a456-426614174000&url=https%3A%2F%2Fexample.com%2F");
    expect(unknown.status).toBe(404);
  });

  itWithApp("berechnet die Allowlist ausschließlich aus dem ausgewählten Profil", async ({ app }) => {
    const privateUrl = "http://10.0.10.10:8006/";
    const allowed = await app.request(`/api/proxy?profile=${DEFAULT_PROFILE_ID}&url=${encodeURIComponent(privateUrl)}`);
    expect(allowed.status).toBe(403);
    expect(await allowed.json()).toEqual({ error: "Private Adresse" });

    const rejected = await app.request(`/api/proxy?profile=${secondProfileId}&url=${encodeURIComponent(privateUrl)}`);
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toEqual({ error: "Host nicht erlaubt" });
  }, {
    document: twoProfileDocument(
      { proxyAllowlist: [...defaultConfig.proxyAllowlist, "10.0.10.10"] },
      { proxyAllowlist: defaultConfig.proxyAllowlist },
    ),
  });

  it("liefert Upstream-Inhalt inert und mit Schutz-Headern aus", async () => {
    const response = inertProxyResponse({
      status: 200,
      body: new TextEncoder().encode("<script>alert(1)</script>"),
    });
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe("attachment");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(await response.text()).toContain("<script>");
  });

  it("reicht einen Upstream-204 ohne unzulässigen Response-Body weiter", async () => {
    const response = inertProxyResponse({
      status: 204,
      body: new TextEncoder().encode("darf nicht im 204-Body stehen"),
    });
    expect(response.status).toBe(204);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  itWithApp("lehnt private Adressen mit 403 ab", async ({ app }) => {
    const res = await app.request(`/api/proxy?profile=${DEFAULT_PROFILE_ID}&url=http://10.0.10.10:8006/`);
    expect(res.status).toBe(403);
  });

  itWithApp("lehnt die Metadaten-Adresse mit 403 ab", async ({ app }) => {
    const res = await app.request(`/api/proxy?profile=${DEFAULT_PROFILE_ID}&url=http://169.254.169.254/`);
    expect(res.status).toBe(403);
  });

  itWithApp("lehnt nicht erlaubte Hosts mit 403 ab", async ({ app }) => {
    const res = await app.request(`/api/proxy?profile=${DEFAULT_PROFILE_ID}&url=https://example.com/`);
    expect(res.status).toBe(403);
  });

  itWithApp("meldet fehlenden url-Parameter mit 400", async ({ app }) => {
    const res = await app.request(`/api/proxy?profile=${DEFAULT_PROFILE_ID}`);
    expect(res.status).toBe(400);
  });

  itWithApp("meldet kaputte Prozentkodierung mit 400 statt 500", async ({ app }) => {
    const res = await app.request(`/api/proxy?profile=${DEFAULT_PROFILE_ID}&url=%zz`);
    expect(res.status).toBe(400);
  });

  // Bei falscher Auswertung landete der erlaubte Host aus callbackurl im Ziel und die
  // Anfrage ginge hinaus, statt am nicht erlaubten Host aus url zu scheitern.
  itWithApp("nimmt den url-Parameter, nicht einen Parameter der auf url endet", async ({ app }) => {
    const res = await app.request(
      `/api/proxy?profile=${DEFAULT_PROFILE_ID}&callbackurl=https%3A%2F%2Fapi.open-meteo.com%2F&url=https%3A%2F%2Fexample.com%2F`,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Host nicht erlaubt" });
  });
});

describe("Static- und Fallback-Routen", () => {
  itWithApp("liefert für eine gültige SPA-Clientroute weiterhin index.html", async ({ app }) => {
    const res = await app.request("/settings");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">Dashboard</div>');
  });

  itWithApp("liefert lokale ICS-Dateien aus dem separaten Static-Root", async ({ app }) => {
    const res = await app.request("/static/arbeit.ics");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("BEGIN:VCALENDAR");
  });

  itWithApp("liefert für fehlende Static-Dateien und unbekannte APIs 404 statt SPA-HTML", async ({ app }) => {
    const missing = await app.request("/static/fehlt.ics");
    expect(missing.status).toBe(404);
    expect((missing.headers.get("content-type") ?? "").toLowerCase()).toContain("application/json");

    const unknownApi = await app.request("/api/gibt-es-nicht");
    expect(unknownApi.status).toBe(404);
    expect((unknownApi.headers.get("content-type") ?? "").toLowerCase()).toContain("application/json");
  });

  itWithApp("weist Traversal im Static-Pfad ab", async ({ app }) => {
    const res = await app.request("/static/%2e%2e/config.json");
    expect(res.status).toBe(404);
  });
});

describe("readJsonBody", () => {
  it("begrenzt auch einen chunked Body ohne Content-Length", async () => {
    const request = new Request("http://localhost", {
      method: "PUT",
      body: JSON.stringify({ padding: "x".repeat(600 * 1024) }),
    });
    await expect(readJsonBody(request, 512 * 1024)).resolves.toEqual({ kind: "too-large" });
  });
});
