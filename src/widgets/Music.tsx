import { useEffect, useState } from "react";
import { MUSIC_COMMANDS, type MusicCommand, type MusicData } from "../../server/spotify";

export type { MusicCommand, MusicData };
export { MUSIC_COMMANDS };

/** „streamToggle" ist ein lokaler Schalter (Audio-Element), kein Server-Kommando. */
export type MusicRowAction = MusicCommand | "streamToggle";

export type MusicRow = { action: MusicRowAction; altAction?: MusicCommand; aria: string };

/**
 * Die einzige Stelle, die festlegt, welche Zeilen die Pane hat — App baut daraus
 * die Tastatur-Zeilen, das Widget rendert genau dieselbe Liste. Reihenfolge und
 * Anzahl müssen immer übereinstimmen, sonst zeigt die Auswahl ins Leere.
 */
export function musicRows(
  data: MusicData | undefined,
  streaming: boolean,
  deviceName: string,
): MusicRow[] {
  if (!data?.configured) return [];
  const streamRow: MusicRow = {
    action: "streamToggle",
    aria: streaming ? "Stream stumm schalten" : "Stream anhören",
  };
  if (!data.active) {
    return [{ action: "transfer", aria: `Auf ${deviceName} abspielen` }, streamRow];
  }
  const rows: MusicRow[] = [
    { action: "toggle", altAction: "next", aria: "Wiedergabe / Pause, mit Shift nächster Titel" },
  ];
  if (data.volume >= 0) {
    rows.push({ action: "volumeUp", altAction: "volumeDown", aria: "Lauter, mit Shift leiser" });
  }
  rows.push(streamRow);
  return rows;
}

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

// Ein Segment in einer Steuerzeile, das selbst klickbar ist, ohne die Zeile
// auszulösen (die per Enter oder Klick ihre eigene Hauptaktion hat).
function Segment({ glyph, label, onCommand }: {
  glyph: string; label: string; onCommand: () => void;
}) {
  return (
    <span
      className="music-skip"
      role="button"
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); onCommand(); }}
    >{glyph}</span>
  );
}

type MusicProps = {
  data?: MusicData;
  selIndex: number;
  streaming: boolean;
  deviceName: string;
  onCommand: (cmd: MusicCommand) => void;
  onToggleStream: () => void;
};

export function Music({ data, selIndex, streaming, deviceName, onCommand, onToggleStream }: MusicProps) {
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

  const rows = musicRows(data, streaming, deviceName);
  const rowCls = (i: number, base: string) => `row ${base}${i === selIndex ? " is-sel" : ""}`;
  const rowAt = (i: number): MusicRow | undefined => rows[i];

  const streamLine = (i: number) => (
    <div
      key="stream"
      className={rowCls(i, "music-transport")}
      data-row
      role="button"
      tabIndex={-1}
      aria-label={rowAt(i)?.aria}
      title={rowAt(i)?.aria}
      onClick={onToggleStream}
    >
      <span className={streaming ? "music-live" : "music-skip"} aria-hidden="true">
        {streaming ? "≋ ●" : "≋ ○"}
      </span>
    </div>
  );

  return (
    <>
      {data.active && (
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
      )}
      <div role="group" aria-label="Wiedergabe steuern">
        {!data.active && (
          <div
            className={rowCls(0, "music-transport")}
            data-row
            role="button"
            tabIndex={-1}
            aria-label={rowAt(0)?.aria}
            title={rowAt(0)?.aria}
            onClick={() => onCommand("transfer")}
          >
            <span className="music-playbtn" aria-hidden="true">▶ {deviceName}</span>
          </div>
        )}
        {data.active && (
          <div
            className={rowCls(0, "music-transport")}
            data-row
            role="button"
            tabIndex={-1}
            aria-label={rowAt(0)?.aria}
            title={rowAt(0)?.aria}
            onClick={() => onCommand("toggle")}
          >
            <Segment glyph="«" label="Vorheriger Titel" onCommand={() => onCommand("prev")} />
            <span className="music-playbtn" aria-hidden="true">{playing ? "▶" : "‖"}</span>
            <Segment glyph="»" label="Nächster Titel" onCommand={() => onCommand("next")} />
          </div>
        )}
        {data.active && data.volume >= 0 && (
          <div
            className={rowCls(1, "music-volrow")}
            data-row
            role="button"
            tabIndex={-1}
            aria-label={rowAt(1)?.aria}
            title={rowAt(1)?.aria}
            onClick={() => onCommand("volumeUp")}
          >
            <Segment glyph="−" label="Leiser" onCommand={() => onCommand("volumeDown")} />
            <Bar pct={data.volume} width={13} ariaLabel={`Lautstärke ${data.volume} Prozent`} />
            <span className="dim">{data.volume} %</span>
            <Segment glyph="+" label="Lauter" onCommand={() => onCommand("volumeUp")} />
          </div>
        )}
        {streamLine(rows.length - 1)}
      </div>
      {!data.active && (
        <div className="dim music-artist" style={{ textAlign: "center" }}>
          kein aktives Gerät — oben auf {deviceName} starten
        </div>
      )}
    </>
  );
}
