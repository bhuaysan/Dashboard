// Vorlage — muss vor allen anderen Importen stehen, die process.env lesen
import { loadEnvFile } from "node:process";
try { loadEnvFile(); } catch { /* keine .env: echte Umgebungsvariablen nutzen (Produktion) */ }

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { env } from "./env.ts";
import { readConfig, writeConfig } from "./config-store.ts";
import { writeGuard } from "./write-guard.ts";
import { proxyFetch } from "./proxy.ts";
import { configSchema } from "../src/config/schema.ts";

export const app = new Hono();

app.get("/api/config", async (c) => c.json(await readConfig()));

app.put("/api/config", writeGuard, async (c) => {
  const current = await readConfig();
  if (c.req.header("If-Match") !== current.updatedAt) {
    return c.json({ error: "conflict", current: current.updatedAt }, 409);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid", issues: [] }, 400);
  }
  const parsed = configSchema.safeParse({ ...(body as object), updatedAt: new Date().toISOString() });
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  await writeConfig(parsed.data);
  return c.json(parsed.data);
});

app.get("/api/proxy", async (c) => {
  // die Ziel-URL steht komplett hinter "url=", eigene & gehören zu ihr
  const idx = c.req.url.indexOf("url=");
  if (idx < 0) return c.json({ error: "Parameter url fehlt" }, 400);
  const raw = decodeURIComponent(c.req.url.slice(idx + 4));
  try {
    new URL(raw);
  } catch {
    return c.json({ error: "Ungültige URL" }, 400);
  }
  const cfg = await readConfig();
  try {
    const result = await proxyFetch(raw, cfg.proxyAllowlist);
    return new Response(result.body, {
      status: result.status,
      headers: { "content-type": result.contentType },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Proxy-Fehler";
    if (msg === "Schema" || msg === "Host nicht erlaubt" || msg === "Private Adresse") {
      return c.json({ error: msg }, 403);
    }
    return c.json({ error: msg }, 502);
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
