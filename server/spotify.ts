import { fetch as undiciFetch } from "undici";
import { env } from "./env.ts";

export type MusicCommand = "toggle" | "next" | "prev" | "volumeUp" | "volumeDown";

export const MUSIC_COMMANDS: readonly MusicCommand[] = [
  "toggle", "next", "prev", "volumeUp", "volumeDown",
];

export type MusicData = {
  configured: boolean;   // false, wenn env.spotify undefined ist
  active: boolean;       // false = kein aktives Gerät / nichts geladen
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  device: string;
  elapsedMs: number;
  durationMs: number;
  volume: number;        // 0–100, -1 wenn das Gerät keine Lautstärke meldet
  fetchedAt: number;     // epoch ms — der Client rechnet den Fortschritt daraus weiter
};

export const emptyMusic: MusicData = {
  configured: false,
  active: false,
  playing: false,
  title: "",
  artist: "",
  album: "",
  device: "",
  elapsedMs: 0,
  durationMs: 0,
  volume: -1,
  fetchedAt: 0,
};

// Antwortform von GET /v1/me/player — nur die Felder, die wir lesen.
export type SpotifyPlayer = {
  is_playing: boolean;
  progress_ms: number | null;
  device: { name: string; volume_percent: number | null };
  item: {
    name: string;
    duration_ms: number;
    artists: { name: string }[];
    album: { name: string } | null;   // Episoden haben kein Album
  } | null;
};

export function buildMusic(raw: SpotifyPlayer | null, now = Date.now()): MusicData {
  if (raw === null || raw.item === null) {
    return { ...emptyMusic, configured: true, fetchedAt: now };
  }
  const item = raw.item;
  return {
    configured: true,
    active: true,
    playing: raw.is_playing,
    title: item.name,
    artist: item.artists.map((a) => a.name).join(", "),
    album: item.album?.name ?? "",
    device: raw.device.name,
    // progress_ms kann älter sein als der Track — nie über die Dauer hinaus anzeigen.
    elapsedMs: Math.max(0, Math.min(raw.progress_ms ?? 0, item.duration_ms)),
    durationMs: item.duration_ms,
    volume: raw.device.volume_percent ?? -1,
    fetchedAt: now,
  };
}

export const VOLUME_STEP = 10;

export function clampVolume(v: number): number {
  return Math.max(0, Math.min(100, v));
}

let tokenCache: { accessToken: string; expiresAt: number } | undefined;

async function accessToken(): Promise<string> {
  if (!env.spotify) throw new Error("Spotify nicht konfiguriert");
  // 60 s Puffer, damit kein Token unterwegs abläuft.
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.accessToken;
  const res = await undiciFetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${env.spotify.clientId}:${env.spotify.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.spotify.refreshToken,
    }).toString(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Spotify-Token: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  return tokenCache.accessToken;
}

async function spotifyFetch(path: string, method: string, query?: Record<string, string>) {
  const token = await accessToken();
  const url = new URL(`https://api.spotify.com/v1${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await undiciFetch(url, {
    method,
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  // Token war doch schon fällig: einmal frisch holen und wiederholen.
  if (res.status === 401) {
    tokenCache = undefined;
    const fresh = await accessToken();
    return undiciFetch(url, {
      method,
      headers: { authorization: `Bearer ${fresh}` },
      signal: AbortSignal.timeout(5000),
    });
  }
  return res;
}

export async function fetchMusic(): Promise<MusicData> {
  if (!env.spotify) return emptyMusic;
  const res = await spotifyFetch("/me/player", "GET");
  if (res.status === 204) return buildMusic(null);   // kein aktives Gerät
  if (!res.ok) throw new Error(`Spotify player: HTTP ${res.status}`);
  return buildMusic((await res.json()) as SpotifyPlayer);
}

export async function sendMusicCommand(cmd: MusicCommand): Promise<void> {
  if (!env.spotify) throw new Error("Spotify nicht konfiguriert");
  if (cmd === "toggle") {
    const state = await fetchMusic();
    if (!state.active) throw new Error("kein aktives Gerät");
    const res = await spotifyFetch(`/me/player/${state.playing ? "pause" : "play"}`, "PUT");
    if (!res.ok && res.status !== 204) throw new Error(`Spotify toggle: HTTP ${res.status}`);
    return;
  }
  if (cmd === "next" || cmd === "prev") {
    const res = await spotifyFetch(`/me/player/${cmd === "next" ? "next" : "previous"}`, "POST");
    if (!res.ok && res.status !== 204) throw new Error(`Spotify ${cmd}: HTTP ${res.status}`);
    return;
  }
  const state = await fetchMusic();
  if (!state.active) throw new Error("kein aktives Gerät");
  if (state.volume < 0) throw new Error("Gerät meldet keine Lautstärke");
  const next = clampVolume(state.volume + (cmd === "volumeUp" ? VOLUME_STEP : -VOLUME_STEP));
  const res = await spotifyFetch("/me/player/volume", "PUT", { volume_percent: String(next) });
  if (!res.ok && res.status !== 204) throw new Error(`Spotify volume: HTTP ${res.status}`);
}
