import { shortAge, spokenAge } from "../lib/relativeTime";

export type SourceState = "ok" | "warn" | "crit";

type Source = {
  label: string;
  state: SourceState;
  updatedAt?: number;
  alerts?: { count: number; level: "warn" | "crit" };
};

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

// Bisher stand für alle drei Zustände dasselbe ● da — der Unterschied lag allein in der
// Farbe, und Grün und Gelb fallen bei Rotgrünblindheit zusammen. Jetzt trägt schon die
// Form die Aussage: voller Punkt heißt frisch, kleiner Punkt veraltet, ! Fehler.
const STATE_MARK: Record<SourceState, string> = {
  ok: "●",
  warn: "·",
  crit: "!",
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
          const spoken = stamp ? `, geladen ${spokenAge(stamp, now)}` : ", noch nicht geladen";
          // Alarme stehen unten im Pane; ist es ausgeblendet oder weggescrollt, sieht man
          // sie sonst nicht. Der Punkt bleibt davon unberührt — er meint die Quelle, nicht ihren Inhalt.
          const alarm = s.alerts
            ? `, ${s.alerts.count} ${s.alerts.count === 1 ? "Alarm" : "Alarme"}`
            : "";
          return (
            <span key={s.label} className="sl-src" aria-label={`${s.label}: ${STATE_TEXT[s.state]}${spoken}${alarm}`}>
              <span className={`sl-mark ${s.state}`} aria-hidden="true">{STATE_MARK[s.state]}</span> {s.label}
              {stamp ? <span className="dim" aria-hidden="true">{shortAge(stamp, now)}</span> : null}
              {s.alerts
                ? <span className={s.alerts.level} aria-hidden="true">
                    {s.alerts.level === "crit" ? "!!" : "!"}{s.alerts.count}
                  </span>
                : null}
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
