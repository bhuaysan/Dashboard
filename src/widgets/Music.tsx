import { useEffect, useState } from "react";
import type { MusicCommand, MusicData } from "../../server/spotify";

export type { MusicCommand, MusicData };

export async function fetchMusic(): Promise<MusicData> {
  const res = await fetch("/api/music");
  if (!res.ok) throw new Error(`Musik nicht ladbar (${res.status})`);
  return (await res.json()) as MusicData;
}

export async function sendMusicCommand(cmd: MusicCommand): Promise<void> {
  const res = await fetch("/api/music/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Kommando fehlgeschlagen (${res.status})`);
  }
}

// Zwei Zeilen, je zwei Aktionen: Enter löst cmd aus, Shift+Enter altCmd.
// Sichtbar sind nur die Glyphen; die Bedeutung steht im aria-label und Tooltip.
// In der Transport-Zeile sind « und » zusätzlich eigene Klickflächen (prev/next).
export const MUSIC_ROWS: { cmd: MusicCommand; altCmd?: MusicCommand; aria: string }[] = [
  { cmd: "toggle", altCmd: "next", aria: "Wiedergabe / Pause, mit Shift nächster Titel" },
  { cmd: "volumeUp", altCmd: "volumeDown", aria: "Lauter, mit Shift leiser" },
];

function msToClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function Bar({ pct, width, ariaLabel }: { pct: number; width: number; ariaLabel: string }) {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  return (
    <span className="bar" aria-label={ariaLabel}>
      <span className="bar-on">{"━".repeat(filled)}</span>
      <span className="bar-off">{"─".repeat(width - filled)}</span>
    </span>
  );
}

type MusicProps = {
  data?: MusicData;
  selIndex: number;
  onCommand: (cmd: MusicCommand) => void;
};

export function Music({ data, selIndex, onCommand }: MusicProps) {
  // fetchedAt kommt vom Server; dazwischen läuft der Fortschritt weiter, ohne die
  // API zu treffen. tick sorgt nur fürs sekündliche Re-Render. Server und Clients
  // hängen am selben NTP — ein etwaiger Versatz ist kleiner als die Anzeigegenauigkeit.
  const [tick, setTick] = useState(0);
  const playing = data?.playing ?? false;
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [playing]);

  if (!data) return <div className="dim">noch keine Musik-Daten</div>;
  if (!data.configured) return <div className="dim">Musik nicht konfiguriert</div>;

  void tick;
  const elapsed = data.active && playing
    ? Math.min(data.elapsedMs + (Date.now() - data.fetchedAt), data.durationMs)
    : data.elapsedMs;

  return (
    <>
      {data.active ? (
        <div>
          <div className="music-hero">
            <div className="music-title">{data.title}</div>
            <div className="dim music-artist">
              {[data.artist, data.album].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="music-progress">
            <span className="dim">{msToClock(elapsed)}</span>
            <Bar
              pct={data.durationMs > 0 ? (elapsed / data.durationMs) * 100 : 0}
              width={20}
              ariaLabel={`Fortschritt ${msToClock(elapsed)} von ${msToClock(data.durationMs)}`}
            />
            <span className="dim">{msToClock(data.durationMs)}</span>
          </div>
        </div>
      ) : (
        <div className="dim">kein aktives Gerät — Spotify irgendwo starten</div>
      )}
      <div role="group" aria-label="Wiedergabe steuern">
        <div
          className={`row music-transport${selIndex === 0 ? " is-sel" : ""}`}
          data-row
          role="button"
          tabIndex={-1}
          aria-label={MUSIC_ROWS[0]?.aria}
          title={MUSIC_ROWS[0]?.aria}
          onClick={() => onCommand("toggle")}
        >
          <span
            className="music-skip"
            role="button"
            aria-label="Vorheriger Titel"
            title="Vorheriger Titel"
            onClick={(e) => { e.stopPropagation(); onCommand("prev"); }}
          >«</span>
          <span className="music-playbtn" aria-hidden="true">{playing ? "▶" : "‖"}</span>
          <span
            className="music-skip"
            role="button"
            aria-label="Nächster Titel"
            title="Nächster Titel"
            onClick={(e) => { e.stopPropagation(); onCommand("next"); }}
          >»</span>
        </div>
        {data.volume >= 0 && (
          <div
            className={`row music-volrow${selIndex === 1 ? " is-sel" : ""}`}
            data-row
            role="button"
            tabIndex={-1}
            aria-label={MUSIC_ROWS[1]?.aria}
            title={MUSIC_ROWS[1]?.aria}
            onClick={() => onCommand("volumeUp")}
          >
            <span
              className="music-skip"
              role="button"
              aria-label="Leiser"
              title="Leiser"
              onClick={(e) => { e.stopPropagation(); onCommand("volumeDown"); }}
            >−</span>
            <Bar pct={data.volume} width={13} ariaLabel={`Lautstärke ${data.volume} Prozent`} />
            <span className="dim">{data.volume} %</span>
            <span
              className="music-skip"
              role="button"
              aria-label="Lauter"
              title="Lauter"
              onClick={(e) => { e.stopPropagation(); onCommand("volumeUp"); }}
            >+</span>
          </div>
        )}
      </div>
    </>
  );
}
