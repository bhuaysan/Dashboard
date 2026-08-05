export type SourceState = "ok" | "warn" | "crit";

type Props = {
  mode: string;
  panes: { n: number; label: string; active: boolean }[];
  sources: { label: string; state: SourceState }[];
  clock: string;
  note?: string;
};

export function StatusLine({ mode, panes, sources, clock, note }: Props) {
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
        {sources.map((s) => (
          <span key={s.label} className="sl-src">
            <span className={s.state}>●</span> {s.label}
          </span>
        ))}
        <span className="dim">? keys</span>
        <span className="sl-clock">{note ?? clock}</span>
      </span>
    </footer>
  );
}
