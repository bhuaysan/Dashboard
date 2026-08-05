import { relativeTime, shortAge } from "../lib/relativeTime";

export type SourceState = "ok" | "warn" | "crit";

type Source = { label: string; state: SourceState; updatedAt?: number };

type Props = {
  mode: string;
  panes: { n: number; label: string; active: boolean }[];
  sources: Source[];
  clock: string;
  note?: string;
  problem?: string;
};

const STATE_TEXT: Record<SourceState, string> = {
  ok: "in Ordnung",
  warn: "veraltet",
  crit: "Fehler",
};

export function StatusLine({ mode, panes, sources, clock, note, problem }: Props) {
  const now = new Date();
  return (
    <footer className="statusline">
      <span className="sl-name">[dashboard]</span>
      <span className="sl-mode">{mode}</span>
      <span className="sl-panes">
        {panes.map((p) => (
          <span key={p.n} className={p.active ? "is-active" : undefined}>
            <b>{p.n}</b> {p.label}
          </span>
        ))}
      </span>
      <span className="sl-right">
        {sources.map((s) => {
          const stamp = s.updatedAt ? new Date(s.updatedAt) : undefined;
          const spoken = stamp ? `, geladen ${relativeTime(stamp, now)}` : ", noch nicht geladen";
          return (
            <span key={s.label} className="sl-src" aria-label={`${s.label}: ${STATE_TEXT[s.state]}${spoken}`}>
              <span className={s.state} aria-hidden="true">●</span> {s.label}
              {stamp ? <span className="dim" aria-hidden="true">{shortAge(stamp, now)}</span> : null}
            </span>
          );
        })}
        {/* Solange etwas kaputt ist, zählt der Grund mehr als der Tastenhinweis. */}
        {problem
          ? <span className="sl-problem" role="status">! {problem}</span>
          : <span className="dim">? keys</span>}
        <span className="sl-clock">{note ?? clock}</span>
      </span>
    </footer>
  );
}
