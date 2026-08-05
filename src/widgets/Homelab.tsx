import { sparkline } from "../lib/sparkline";
import type { HomelabData } from "../../server/pve";

export type { HomelabData };

export async function fetchHomelab(): Promise<HomelabData> {
  const res = await fetch("/api/homelab");
  if (!res.ok) throw new Error(`Homelab nicht ladbar (${res.status})`);
  return (await res.json()) as HomelabData;
}

function Bar({ name, pct }: { name: string; pct: number }) {
  const width = 13;
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  return (
    <span>
      {name}{" "}
      <span className="bar" aria-label={`${name} zu ${pct} Prozent belegt`}>
        <span className="bar-on">{"━".repeat(filled)}</span>
        <span className="bar-off">{"─".repeat(width - filled)}</span>
      </span>{" "}
      <span className="dim">{pct} %</span>
    </span>
  );
}

export function Homelab({ data, selIndex }: { data?: HomelabData; selIndex: number }) {
  if (!data) return <div className="dim">noch keine Homelab-Daten</div>;
  if (!data.configured) return <div className="dim">Homelab nicht konfiguriert</div>;
  const n = data.node;
  return (
    <>
      <div className="lab-node">
        <span className="metric">
          <span className="dim">cpu</span><span>{n.cpu} %</span>
          <span className="spark" aria-label={`CPU-Auslastung der letzten 30 Minuten: ${n.cpuSpark.join(", ")} Prozent`}>
            {sparkline(n.cpuSpark)}
          </span>
        </span>
        <span className="metric">
          <span className="dim">mem</span><span>{n.mem} %</span>
          <span className="spark" aria-label={`Speicherauslastung der letzten 30 Minuten: ${n.memSpark.join(", ")} Prozent`}>
            {sparkline(n.memSpark)}
          </span>
        </span>
        <span className="metric"><span className="dim">root</span><span>{n.root} %</span></span>
        <span className="metric"><span className="dim">up</span><span>{n.uptimeDays} d</span></span>
      </div>
      <div className="lab-store">
        {data.storage.map((s) => <Bar key={s.name} name={s.name} pct={s.pct} />)}
      </div>
      <div className="lab-guests">
        {data.guests.map((g, i) => (
          <div key={g.vmid} className={`guest${i === selIndex ? " is-sel" : ""}`} data-row>
            {g.running ? (
              <>
                <span className="ok">●</span><span className="num">{g.vmid}</span>
                <span className="name">{g.name}</span><span className="dim">run</span>
                <span className="val">{g.cpu} %</span>
                <span className="val">{g.mem} %</span>
              </>
            ) : (
              <>
                <span className="dim">○</span><span className="num">{g.vmid}</span>
                <span className="name dim">{g.name}</span><span className="dim">stop</span>
                <span className="val dim">–</span><span className="val dim">–</span>
              </>
            )}
          </div>
        ))}
      </div>
      {data.alerts.length > 0 && (
        <div className="lab-alerts">
          {data.alerts.map((a, i) => (
            <div key={i} className={`alert ${a.level}`}>
              <span className="mark">!</span><span>{a.text}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
