import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../src/config/schema";
import { createApp, inertProxyResponse, readJsonBody } from "./app.ts";
import type { DashboardEnvironment } from "./env.ts";

let app: ReturnType<typeof createApp>;
let configPath: string;
let staticPath: string;
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "dashboard-api-"));
  configPath = join(tempDir, "config.json");
  staticPath = join(tempDir, "static");
  await mkdir(staticPath);
  await mkdir(join(tempDir, "dist"));
  await writeFile(join(staticPath, "arbeit.ics"), "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
  const testEnv: DashboardEnvironment = {
    port: 7777,
    configPath,
    staticPath,
    writeAllow: ["127.0.0.1"],
    writeHosts: ["start.home.arpa", "10.0.10.20", "localhost", "127.0.0.1"],
  };
  app = createApp({ env: testEnv, distRoot: join(tempDir, "dist") });
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function getConfig(): Promise<Config> {
  const res = await app.request("/api/config");
  expect(res.status).toBe(200);
  return (await res.json()) as Config;
}

// getConnInfo liest die Absenderadresse aus dem Node-Socket; im Test wird er nachgebildet,
// weil der Write-Guard ohne bekannte Adresse ablehnt.
function connInfo(address: string) {
  return { incoming: { socket: { remoteAddress: address, remotePort: 51234, remoteFamily: "IPv4" } } };
}

function putConfig(cfg: Config, ifMatch: string, from = "127.0.0.1", extraHeaders: Record<string, string> = {}) {
  return app.request(
    "/api/config",
    {
      method: "PUT",
      headers: { "content-type": "application/json", "If-Match": ifMatch, ...extraHeaders },
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

describe("/api/config", () => {
  it("GET liefert die Config", async () => {
    const cfg = await getConfig();
    expect(cfg.location.label).toBe("Heilbronn");
  });

  it("GET enthält keine Werte aus der .env", async () => {
    const res = await app.request("/api/config");
    const text = await res.text();
    expect(text.toLowerCase().includes("token")).toBe(false);
    expect(text.toLowerCase().includes("secret")).toBe(false);
  });

  it("Health liefert ohne Config-Inhalt einen Readiness-Status", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("PUT mit passendem If-Match schreibt und erneuert updatedAt", async () => {
    const before = await getConfig();
    const next = { ...before, theme: "light" as const };
    const res = await putConfig(next, before.updatedAt);
    expect(res.status).toBe(200);
    const saved = (await res.json()) as Config;
    expect(saved.theme).toBe("light");
    expect(saved.updatedAt).not.toBe(before.updatedAt);
    const onDisk = JSON.parse(await readFile(configPath, "utf8")) as Config;
    expect(onDisk.theme).toBe("light");
  });

  it("PUT mit altem If-Match liefert 409 und den aktuellen Stand", async () => {
    const before = await getConfig();
    const first = await putConfig({ ...before, theme: "dark" as const }, before.updatedAt);
    expect(first.status).toBe(200);
    const firstSaved = (await first.json()) as Config;
    const second = await putConfig({ ...before, theme: "light" as const }, before.updatedAt);
    expect(second.status).toBe(409);
    // Der Client braucht diesen Stempel, um einen erneuten Versuch erfolgreich zu
    // wiederholen — ohne ihn würde er mit demselben veralteten If-Match wieder scheitern.
    const body = (await second.json()) as { current?: string };
    expect(body.current).toBe(firstSaved.updatedAt);
  });

  it("akzeptiert bei parallelen PUTs mit demselben If-Match genau einen Gewinner", async () => {
    const before = await getConfig();
    const [first, second] = await Promise.all([
      putConfig({ ...before, theme: "dark" as const }, before.updatedAt),
      putConfig({ ...before, theme: "light" as const }, before.updatedAt),
    ]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409]);
  });

  it("stellt einen alten Export mit der aktuellen Revision CAS-geschützt wieder her", async () => {
    const snapshot = await getConfig();
    const changed = await putConfig({ ...snapshot, theme: "light" as const }, snapshot.updatedAt);
    expect(changed.status).toBe(200);
    const current = await getConfig();
    const restored = await putConfig({ ...snapshot, updatedAt: current.updatedAt }, current.updatedAt);
    expect(restored.status).toBe(200);
    const saved = (await restored.json()) as Config;
    expect(saved.theme).toBe(snapshot.theme);
  });

  it("PUT mit ungültigem Body liefert 400", async () => {
    const before = await getConfig();
    const res = await putConfig({ ...before, location: undefined } as unknown as Config, before.updatedAt);
    expect(res.status).toBe(400);
  });

  it("PUT von einer nicht freigegebenen Adresse liefert 403", async () => {
    const before = await getConfig();
    const res = await putConfig(before, before.updatedAt, "10.0.99.99");
    expect(res.status).toBe(403);
  });

  it("PUT ohne erkennbare Absenderadresse liefert 403", async () => {
    const before = await getConfig();
    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json", "If-Match": before.updatedAt },
      body: JSON.stringify(before),
    });
    expect(res.status).toBe(403);
  });

  it("prüft Host und Origin zusätzlich zur Absenderadresse", async () => {
    const before = await getConfig();
    const foreignHost = await putConfig(before, before.updatedAt, "127.0.0.1", { host: "evil.example" });
    expect(foreignHost.status).toBe(403);
    const foreignOrigin = await putConfig(before, before.updatedAt, "127.0.0.1", {
      host: "start.home.arpa",
      origin: "http://evil.example",
    });
    expect(foreignOrigin.status).toBe(403);
  });

  it("weist einen zu großen JSON-Body mit 413 ab", async () => {
    const before = await getConfig();
    const padding = "x".repeat(600 * 1024);
    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json", "If-Match": before.updatedAt },
      body: JSON.stringify({ padding }),
    }, connInfo("127.0.0.1"));
    expect(res.status).toBe(413);
  });

  it("weist eine zu große endgültige Dateidarstellung als Clientfehler ab", async () => {
    const seed = await getConfig();
    const seeded = await putConfig(seed, seed.updatedAt);
    expect(seeded.status).toBe(200);
    const before = await getConfig();
    const beforeDisk = await readFile(configPath, "utf8");
    const res = await putConfig(nearLimitConfig(before), before.updatedAt);
    expect(res.status).toBe(413);
    expect(await readFile(configPath, "utf8")).toBe(beforeDisk);
  });

  it("liefert bei einem nicht sicherbaren Config-Backup 503", async () => {
    await rm(`${configPath}.bak`, { force: true, recursive: true });
    await writeFile(configPath, "{");
    await mkdir(`${configPath}.bak`);
    try {
      const res = await app.request("/api/config");
      expect(res.status).toBe(503);
    } finally {
      await rm(`${configPath}.bak`, { force: true, recursive: true });
      await rm(configPath, { force: true });
    }
  });
});

describe("/api/proxy", () => {
  it("liefert Upstream-Inhalt inert und mit Schutz-Headern aus", async () => {
    const response = inertProxyResponse({
      status: 200,
      contentType: "text/html",
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
      contentType: "text/plain",
      body: new TextEncoder().encode("darf nicht im 204-Body stehen"),
    });
    expect(response.status).toBe(204);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it("lehnt private Adressen mit 403 ab", async () => {
    const res = await app.request("/api/proxy?url=http://10.0.10.10:8006/");
    expect(res.status).toBe(403);
  });

  it("lehnt die Metadaten-Adresse mit 403 ab", async () => {
    const res = await app.request("/api/proxy?url=http://169.254.169.254/");
    expect(res.status).toBe(403);
  });

  it("lehnt nicht erlaubte Hosts mit 403 ab", async () => {
    const res = await app.request("/api/proxy?url=https://example.com/");
    expect(res.status).toBe(403);
  });

  it("meldet fehlenden url-Parameter mit 400", async () => {
    const res = await app.request("/api/proxy");
    expect(res.status).toBe(400);
  });

  it("meldet kaputte Prozentkodierung mit 400 statt 500", async () => {
    const res = await app.request("/api/proxy?url=%zz");
    expect(res.status).toBe(400);
  });

  // Bei falscher Auswertung landete der erlaubte Host aus callbackurl im Ziel und die
  // Anfrage ginge hinaus, statt am nicht erlaubten Host aus url zu scheitern.
  it("nimmt den url-Parameter, nicht einen Parameter der auf url endet", async () => {
    const res = await app.request(
      "/api/proxy?callbackurl=https%3A%2F%2Fapi.open-meteo.com%2F&url=https%3A%2F%2Fexample.com%2F",
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Host nicht erlaubt" });
  });
});

describe("Static- und Fallback-Routen", () => {
  it("liefert lokale ICS-Dateien aus dem separaten Static-Root", async () => {
    const res = await app.request("/static/arbeit.ics");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("BEGIN:VCALENDAR");
  });

  it("liefert für fehlende Static-Dateien und unbekannte APIs 404 statt SPA-HTML", async () => {
    const missing = await app.request("/static/fehlt.ics");
    expect(missing.status).toBe(404);
    expect((missing.headers.get("content-type") ?? "").toLowerCase()).toContain("application/json");

    const unknownApi = await app.request("/api/gibt-es-nicht");
    expect(unknownApi.status).toBe(404);
    expect((unknownApi.headers.get("content-type") ?? "").toLowerCase()).toContain("application/json");
  });

  it("weist Traversal im Static-Pfad ab", async () => {
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
