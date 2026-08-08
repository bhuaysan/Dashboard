// Vorlage — muss vor allen anderen Importen stehen, die process.env lesen
import "./load-env.ts";

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { env } from "./env.ts";
import { ConfigStoreError, readConfig, updateConfig } from "./config-store.ts";
import { writeGuard } from "./write-guard.ts";
import { proxyFetch, type ProxyResult } from "./proxy.ts";
import type { Config } from "../src/config/schema.ts";
import { fetchHomelab, type HomelabData } from "./pve.ts";

export const app = new Hono();

export function inertProxyResponse(result: ProxyResult): Response {
  return new Response(result.body, {
    status: result.status,
    headers: {
      // Fremder Inhalt darf unter der Dashboard-Origin weder als Dokument noch als
      // eingebettetes aktives Format interpretiert werden.
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": "attachment",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
    },
  });
}

app.get("/api/config", async (c) => {
  try {
    return c.json(await readConfig());
  } catch (error) {
    if (error instanceof ConfigStoreError) {
      return c.json({ error: "Config nicht verfügbar" }, 503);
    }
    throw error;
  }
});

app.put("/api/config", writeGuard, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid", issues: [] }, 400);
  }
  try {
    const result = await updateConfig(c.req.header("If-Match"), body);
    if (result.kind === "conflict") {
      return c.json({ error: "conflict", current: result.current }, 409);
    }
    if (result.kind === "invalid") {
      return c.json({ error: "invalid", issues: result.issues }, 400);
    }
    return c.json(result.config);
  } catch (error) {
    if (error instanceof ConfigStoreError) {
      return c.json({ error: "Config nicht verfügbar" }, 503);
    }
    throw error;
  }
});

app.get("/api/proxy", async (c) => {
  // Jeder Aufrufer kodiert die Ziel-URL mit encodeURIComponent, eigene & stehen darin
  // als %26 — der Query-Parser liefert sie deshalb vollständig zurück.
  const raw = c.req.query("url");
  if (raw === undefined || raw === "") return c.json({ error: "Parameter url fehlt" }, 400);
  try {
    new URL(raw);
  } catch {
    return c.json({ error: "Ungültige URL" }, 400);
  }
  let cfg: Config;
  try {
    cfg = await readConfig();
  } catch (error) {
    if (error instanceof ConfigStoreError) {
      return c.json({ error: "Config nicht verfügbar" }, 503);
    }
    throw error;
  }
  try {
    const result = await proxyFetch(raw, cfg.proxyAllowlist);
    return inertProxyResponse(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Proxy-Fehler";
    if (msg === "Schema" || msg === "Host nicht erlaubt" || msg === "Private Adresse") {
      return c.json({ error: msg }, 403);
    }
    return c.json({ error: msg }, 502);
  }
});

let homelabCache: { t: number; data: HomelabData } | undefined;

app.get("/api/homelab", async (c) => {
  let cfg: Config;
  try {
    cfg = await readConfig();
  } catch (error) {
    if (error instanceof ConfigStoreError) {
      return c.json({ error: "Config nicht verfügbar" }, 503);
    }
    return c.json({ error: "Homelab nicht erreichbar" }, 502);
  }
  if (homelabCache && Date.now() - homelabCache.t < 60_000) {
    return c.json(homelabCache.data);
  }
  try {
    const data = await fetchHomelab(cfg);
    homelabCache = { t: Date.now(), data };
    return c.json(data);
  } catch {
    return c.json({ error: "Homelab nicht erreichbar" }, 502);
  }
});

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
  const distRoot = fileURLToPath(new URL("../dist", import.meta.url));
  app.use("/*", serveStatic({ root: distRoot }));
  app.use("/*", serveStatic({ root: distRoot, path: "index.html" }));
  serve({ fetch: app.fetch, port: env.port }, (info) => {
    console.log(`dashboard-server auf Port ${info.port}`);
  });
}
