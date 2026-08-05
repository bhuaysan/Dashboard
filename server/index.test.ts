import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../src/config/schema";

let app: typeof import("./index.ts").app;
let configPath: string;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "dashboard-api-"));
  configPath = join(dir, "config.json");
  process.env.DASHBOARD_CONFIG = configPath;
  ({ app } = await import("./index.ts"));
});

async function getConfig(): Promise<Config> {
  const res = await app.request("/api/config");
  expect(res.status).toBe(200);
  return (await res.json()) as Config;
}

function putConfig(cfg: Config, ifMatch: string) {
  return app.request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json", "If-Match": ifMatch },
    body: JSON.stringify(cfg),
  });
}

describe("/api/config", () => {
  it("GET liefert die Config", async () => {
    const cfg = await getConfig();
    expect(cfg.location.label).toBe("Heilbronn");
  });

  it("GET enthält keine Werte aus der .env", async () => {
    const res = await app.request("/api/config");
    const text = await res.text();
    for (const key of ["PVE_TOKEN_SECRET", "PVE_TOKEN_ID"]) {
      const value = process.env[key];
      if (value) expect(text.includes(value)).toBe(false);
    }
    expect(text.toLowerCase().includes("token")).toBe(false);
    expect(text.toLowerCase().includes("secret")).toBe(false);
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

  it("PUT mit altem If-Match liefert 409", async () => {
    const before = await getConfig();
    const first = await putConfig({ ...before, theme: "dark" as const }, before.updatedAt);
    expect(first.status).toBe(200);
    const second = await putConfig({ ...before, theme: "light" as const }, before.updatedAt);
    expect(second.status).toBe(409);
  });

  it("PUT mit ungültigem Body liefert 400", async () => {
    const before = await getConfig();
    const res = await putConfig({ ...before, location: undefined } as unknown as Config, before.updatedAt);
    expect(res.status).toBe(400);
  });
});

describe("/api/proxy", () => {
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
});
