// Vorlage — muss vor allen anderen Importen stehen, die process.env lesen
import "./load-env.ts";

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
import { fetchHomelab, type HomelabData } from "./pve.ts";
import { fetchMusic, sendMusicCommand, emptyMusic, MUSIC_COMMANDS, type MusicCommand, type MusicData } from "./spotify.ts";
import { buildWavHeader, PcmBroadcaster } from "./stream.ts";
import { stream } from "hono/streaming";

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
  // Jeder Aufrufer kodiert die Ziel-URL mit encodeURIComponent, eigene & stehen darin
  // als %26 — der Query-Parser liefert sie deshalb vollständig zurück.
  const raw = c.req.query("url");
  if (raw === undefined || raw === "") return c.json({ error: "Parameter url fehlt" }, 400);
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

let homelabCache: { t: number; data: HomelabData } | undefined;

app.get("/api/homelab", async (c) => {
  if (homelabCache && Date.now() - homelabCache.t < 60_000) {
    return c.json(homelabCache.data);
  }
  try {
    const cfg = await readConfig();
    const data = await fetchHomelab(cfg);
    homelabCache = { t: Date.now(), data };
    return c.json(data);
  } catch {
    return c.json({ error: "Homelab nicht erreichbar" }, 502);
  }
});

let musicCache: { t: number; data: MusicData } | undefined;

app.get("/api/music", async (c) => {
  const cfg = await readConfig();
  if (!cfg.music.enabled || cfg.music.source !== "spotify") {
    return c.json(emptyMusic);
  }
  if (musicCache && Date.now() - musicCache.t < 5_000) {
    return c.json(musicCache.data);
  }
  try {
    const data = await fetchMusic();
    musicCache = { t: Date.now(), data };
    return c.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Musik nicht erreichbar";
    return c.json({ error: msg }, 502);
  }
});

// Steuerung ist ein schreibender Zugriff aufs Konto — dieselbe Absender-Sperre wie
// beim Config-PUT.
app.post("/api/music/command", writeGuard, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid" }, 400);
  }
  const cmd = (body as { cmd?: string }).cmd;
  if (!MUSIC_COMMANDS.includes(cmd as MusicCommand)) {
    return c.json({ error: "unbekanntes Kommando" }, 400);
  }
  try {
    const cfg = await readConfig();
    await sendMusicCommand(cmd as MusicCommand, cfg.music.device);
    musicCache = undefined;   // naechstes GET zeigt sofort den neuen Zustand
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Kommando fehlgeschlagen";
    return c.json({ error: msg }, 502);
  }
});

// Rohes PCM von go-librespot, mit WAV-Header als audio/wav — das <audio>-Element
// im Browser spielt es ohne weitere Infrastruktur. Ein Leser auf der FIFO,
// verteilt auf alle Hörer.
const pcm = new PcmBroadcaster(env.musicPcmPath);

app.get("/api/music/stream", (c) => {
  c.header("content-type", "audio/wav");
  c.header("cache-control", "no-store");
  return stream(c, async (s) => {
    await s.write(buildWavHeader());
    const sink = { write: (chunk: Uint8Array) => s.write(chunk), close: () => void s.close() };
    pcm.add(sink);
    await new Promise<void>((resolve) => {
      s.onAbort(() => { pcm.remove(sink); resolve(); });
    });
  });
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
