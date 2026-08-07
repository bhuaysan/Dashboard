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

// Enter löst cmd aus, Shift+Enter altCmd — so bleiben beide Richtungen einer
// Aktion auf einer Zeile erreichbar, statt je eine eigene Zeile zu belegen.
export const MUSIC_ROWS: { cmd: MusicCommand; altCmd?: MusicCommand; label: string }[] = [
  { cmd: "toggle", label: "wiedergabe / pause" },
  { cmd: "next", altCmd: "prev", label: "weiter · zurück" },
  { cmd: "volumeUp", altCmd: "volumeDown", label: "lauter · leiser" },
];

function msToClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function Bar({ pct, ariaLabel }: { pct: number; ariaLabel: string }) {
  const width = 13;
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
          <div>♪ {data.artist} – {data.title}</div>
          <div className="dim">
            {"  "}{[data.album, data.device].filter(Boolean).join("  ·  ")}
          </div>
          <div>
            <span className="dim">{msToClock(elapsed)}</span>{" "}
            <Bar
              pct={data.durationMs > 0 ? (elapsed / data.durationMs) * 100 : 0}
              ariaLabel={`Fortschritt ${msToClock(elapsed)} von ${msToClock(data.durationMs)}`}
            />{" "}
            <span className="dim">{msToClock(data.durationMs)}</span>{" "}
            <span className="dim">{playing ? "play" : "pause"}</span>
          </div>
          {data.volume >= 0 && (
            <div>
              <span className="dim">vol</span>{" "}
              <Bar pct={data.volume} ariaLabel={`Lautstärke ${data.volume} Prozent`} />{" "}
              <span className="dim">{data.volume} %</span>
            </div>
          )}
        </div>
      ) : (
        <div className="dim">kein aktives Gerät — Spotify irgendwo starten</div>
      )}
      <div role="group" aria-label="Wiedergabe steuern">
        {MUSIC_ROWS.map((r, i) => (
          <div
            key={r.cmd}
            className={`row music-cmd${i === selIndex ? " is-sel" : ""}`}
            data-row
            role="button"
            tabIndex={-1}
            title={r.altCmd ? "Shift: zweite Aktion" : undefined}
            onClick={() => onCommand(r.cmd)}
          >
            {r.label}
          </div>
        ))}
      </div>
    </>
  );
}
