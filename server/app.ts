import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { resolve } from "node:path";
import { ConfigStoreError, ConfigTooLargeError, createConfigStore, type ConfigStore } from "./config-store.ts";
import { createWriteGuard } from "./write-guard.ts";
import { ProxyOverloadedError, ProxyPolicyError, ProxyTimeoutError, proxyFetch, type ProxyResult } from "./proxy.ts";
import { effectiveProxyHosts } from "../src/config/proxyHosts.ts";
import type { Config } from "../src/config/schema.ts";
import { fetchHomelab } from "./pve.ts";
import { createHomelabCache, type HomelabFetcher } from "./homelab-cache.ts";
import type { DashboardEnvironment } from "./env.ts";

export const MAX_CONFIG_BODY_BYTES = 512 * 1024;

type JsonBodyResult =
  | { kind: "ok"; value: unknown }
  | { kind: "invalid" }
  | { kind: "too-large" };

export type AppOptions = {
  env: DashboardEnvironment;
  distRoot: string;
  configStore?: ConfigStore;
  homelabFetcher?: HomelabFetcher;
};

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
    const value: unknown = JSON.parse(source);
    return { kind: "ok", value };
  } catch {
    return { kind: "invalid" };
  }
}

export function inertProxyResponse(result: ProxyResult): Response {
  const noBody = result.status === 204 || result.status === 205 || result.status === 304;
  return new Response(noBody ? null : result.body, {
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

export function createApp(options: AppOptions): Hono {
  const runtimeEnv = options.env;
  const store = options.configStore ?? createConfigStore(runtimeEnv.configPath);
  const homelabFetcher = options.homelabFetcher ?? ((config: Config) => fetchHomelab(config, runtimeEnv));
  const homelabCache = createHomelabCache(homelabFetcher);
  const app = new Hono();

  app.get("/api/config", async (c) => {
    try {
      return c.json(await store.readConfig());
    } catch (error) {
      if (error instanceof ConfigStoreError) {
        return c.json({ error: "Config nicht verfügbar" }, 503);
      }
      throw error;
    }
  });

  app.get("/api/health", async (c) => {
    try {
      await store.readConfig();
      return c.json({ status: "ok" });
    } catch (error) {
      if (error instanceof ConfigStoreError) {
        return c.json({ status: "nicht bereit" }, 503);
      }
      throw error;
    }
  });

  app.put("/api/config", createWriteGuard(runtimeEnv), async (c) => {
    const parsedBody = await readJsonBody(c.req.raw, MAX_CONFIG_BODY_BYTES);
    if (parsedBody.kind === "too-large") {
      return c.json({ error: "Anfrage zu groß" }, 413);
    }
    if (parsedBody.kind === "invalid") {
      return c.json({ error: "invalid", issues: [] }, 400);
    }
    try {
      const result = await store.updateConfig(c.req.header("If-Match"), parsedBody.value);
      if (result.kind === "conflict") {
        return c.json({ error: "conflict", current: result.current }, 409);
      }
      if (result.kind === "invalid") {
        return c.json({ error: "invalid", issues: result.issues }, 400);
      }
      return c.json(result.config);
    } catch (error) {
      if (error instanceof ConfigTooLargeError) {
        return c.json({ error: "Config-Datei ist zu groß" }, 413);
      }
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
      cfg = await store.readConfig();
    } catch (error) {
      if (error instanceof ConfigStoreError) {
        return c.json({ error: "Config nicht verfügbar" }, 503);
      }
      throw error;
    }
    try {
      const result = await proxyFetch(raw, effectiveProxyHosts(cfg));
      return inertProxyResponse(result);
    } catch (error) {
      if (error instanceof ProxyOverloadedError) {
        return c.json({ error: error.message }, 503);
      }
      if (error instanceof ProxyTimeoutError) {
        return c.json({ error: error.message }, 504);
      }
      if (error instanceof ProxyPolicyError) {
        return c.json({ error: error.message }, 403);
      }
      const msg = error instanceof Error ? error.message : "Proxy-Fehler";
      return c.json({ error: msg }, 502);
    }
  });

  app.get("/api/homelab", async (c) => {
    let cfg: Config;
    try {
      cfg = await store.readConfig();
    } catch (error) {
      if (error instanceof ConfigStoreError) {
        return c.json({ error: "Config nicht verfügbar" }, 503);
      }
      return c.json({ error: "Homelab nicht erreichbar" }, 502);
    }
    if (!cfg.homelab.enabled) {
      return c.json({ error: "Homelab deaktiviert" }, 404);
    }
    try {
      return c.json(await homelabCache.get(cfg));
    } catch {
      return c.json({ error: "Homelab nicht erreichbar" }, 502);
    }
  });

  const staticRoot = resolve(runtimeEnv.staticPath);
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
  const distStaticHandler = serveStatic({ root: options.distRoot });
  app.on(["GET", "HEAD"], "/*", distStaticHandler);
  app.on(["GET", "HEAD"], "/*", async (c, next) => {
    // Eine unbekannte Datei (auch ein normalisierter Traversal-Versuch wie
    // /static/%2e%2e/config.json) ist keine Client-Route.
    if (c.req.path.includes(".")) return c.json({ error: "Nicht gefunden" }, 404);
    await next();
  });
  app.on(["GET", "HEAD"], "/*", serveStatic({ root: options.distRoot, path: "index.html" }));

  return app;
}
