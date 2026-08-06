#!/usr/bin/env node
// Einmalige Spotify-Einrichtung: holt das Refresh-Token und schreibt es in .env.
//
// Vorbereitung (einmalig, im Browser):
//   1. https://developer.spotify.com/dashboard → App anlegen
//   2. Redirect URI in der App eintragen: http://127.0.0.1:8964/callback
//   3. SPOTIFY_CLIENT_ID und SPOTIFY_CLIENT_SECRET in .env eintragen
//
// Danach:  node scripts/spotify-auth.mjs
// Das Skript öffnet die Anmelde-URL, fängt den Redirect lokal ab und ergänzt
// SPOTIFY_REFRESH_TOKEN in .env. Der Server erneuert daraus fortan die
// kurzlebigen Access-Tokens selbst — dieses Skript wird nur noch gebraucht,
// wenn das Token widerrufen wurde.
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const ENV_PATH = new URL("../.env", import.meta.url);
const REDIRECT_URI = "http://127.0.0.1:8964/callback";
const SCOPES = [
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state",
].join(" ");

function readEnv() {
  try {
    return readFileSync(ENV_PATH, "utf8");
  } catch {
    return "";
  }
}

function envValue(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

async function ask(rl, question, preset) {
  const suffix = preset ? ` [${preset}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || preset;
}

const envText = readEnv();
const rl = createInterface({ input: process.stdin, output: process.stdout });
const clientId = await ask(rl, "Client ID", envValue(envText, "SPOTIFY_CLIENT_ID"));
const clientSecret = await ask(rl, "Client Secret", envValue(envText, "SPOTIFY_CLIENT_SECRET"));
rl.close();
if (!clientId || !clientSecret) {
  console.error("Client ID und Secret werden gebraucht — siehe Kopf dieser Datei.");
  process.exit(1);
}

const code = await new Promise((resolvePromise, rejectPromise) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", REDIRECT_URI);
    if (url.pathname !== "/callback") {
      res.writeHead(404).end("nur /callback");
      return;
    }
    const err = url.searchParams.get("error");
    const c = url.searchParams.get("code");
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(err ? `Fehler: ${err}\nFenster kann geschlossen werden.`
                : "Token empfangen — zurück ins Terminal.\n");
    server.close();
    if (err) rejectPromise(new Error(`Spotify: ${err}`));
    else if (c) resolvePromise(c);
    else rejectPromise(new Error("weder code noch error im Redirect"));
  });
  server.listen(8964, "127.0.0.1", () => {
    const auth = new URL("https://accounts.spotify.com/authorize");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("redirect_uri", REDIRECT_URI);
    auth.searchParams.set("scope", SCOPES);
    console.log("\nDiese URL im Browser öffnen und bestätigen:\n");
    console.log(auth.toString());
    console.log("\nWarte auf den Redirect auf", REDIRECT_URI, "…");
  });
  setTimeout(() => { server.close(); rejectPromise(new Error("Zeitüberschreitung (5 min)")); }, 300_000);
});

const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    client_secret: clientSecret,
  }),
});
if (!tokenRes.ok) {
  console.error(`Token-Tausch fehlgeschlagen: HTTP ${tokenRes.status}`, await tokenRes.text());
  process.exit(1);
}
const tokens = await tokenRes.json();
if (!tokens.refresh_token) {
  console.error("Kein Refresh-Token in der Antwort — App-Einstellungen prüfen.");
  process.exit(1);
}

function upsert(text, key, value) {
  const line = `${key}=${value}`;
  return new RegExp(`^${key}=.*$`, "m").test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${text.replace(/\n?$/, "\n")}${line}\n`;
}

let next = upsert(readEnv(), "SPOTIFY_CLIENT_ID", clientId);
next = upsert(next, "SPOTIFY_CLIENT_SECRET", clientSecret);
next = upsert(next, "SPOTIFY_REFRESH_TOKEN", tokens.refresh_token);
writeFileSync(ENV_PATH, next, { mode: 0o600 });
console.log("\nFertig — SPOTIFY_REFRESH_TOKEN steht in .env. Server neu starten, das war's.");
