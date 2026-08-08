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
export const MAX_CONFIG_BODY_BYTES = 512 * 1024;

type JsonBodyResult =
  | { kind: "ok"; value: unknown }
  | { kind: "invalid" }
  | { kind: "too-large" };

export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength.trim())) return { kind: "invalid" };
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength)) return { kind: "invalid" };
    if (declaredLength > maxBytes) return { kind: "too-large" };
  }

  const body = request.body;
  if (!body) return { kind: "invalid" };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let source = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { kind: "too-large" };
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return { kind: "ok", value: JSON.parse(source) as unknown };
  } catch {
    return { kind: "invalid" };
  }
}

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
  const parsedBody = await readJsonBody(c.req.raw, MAX_CONFIG_BODY_BYTES);
  if (parsedBody.kind === "too-large") {
    return c.json({ error: "Anfrage zu groß" }, 413);
  }
  if (parsedBody.kind === "invalid") {
    return c.json({ error: "invalid", issues: [] }, 400);
  }
  try {
    const result = await updateConfig(c.req.header("If-Match"), parsedBody.value);
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
const distRoot = (() => {
  try {
    return resolve(fileURLToPath(import.meta.url), "..", "..", "dist");
  } catch {
    // Vitest stellt import.meta.url als virtuelle URL bereit; dort ist cwd das Repo.
    return resolve("dist");
  }
})();
const staticRoot = resolve(env.staticPath);

// Das Static-Root liegt außerhalb von dist/, damit rsync --delete es nicht entfernt.
// Der Rewrite entfernt den öffentlichen Präfix, bevor serveStatic den Pfad auflöst.
const staticHandler = serveStatic({
  root: staticRoot,
  rewriteRequestPath: (path) => path.slice("/static".length) || "/",
});
app.on(["GET", "HEAD"], "/static/*", staticHandler);
app.all("/static", (c) => c.json({ error: "Nicht gefunden" }, 404));
app.all("/static/*", (c) => c.json({ error: "Nicht gefunden" }, 404));

// API-Fehler dürfen niemals durch den SPA-Fallback als index.html mit 200 beantwortet werden.
app.all("/api", (c) => c.json({ error: "Nicht gefunden" }, 404));
app.all("/api/*", (c) => c.json({ error: "Nicht gefunden" }, 404));

// Nur Client-Routen bekommen den SPA-Fallback; unbekannte API- und Static-Routen sind echte 404.
const distStaticHandler = serveStatic({ root: distRoot });
app.on(["GET", "HEAD"], "/*", distStaticHandler);
app.on(["GET", "HEAD"], "/*", async (c, next) => {
  // Eine unbekannte Datei (auch ein normalisierter Traversal-Versuch wie
  // /static/%2e%2e/config.json) ist keine Client-Route.
  if (c.req.path.includes(".")) return c.json({ error: "Nicht gefunden" }, 404);
  await next();
});
app.on(["GET", "HEAD"], "/*", serveStatic({ root: distRoot, path: "index.html" }));

if (isMain) {
  serve({ fetch: app.fetch, port: env.port }, (info) => {
    console.log(`dashboard-server auf Port ${info.port}`);
  });
}
