import { sparkline } from "../lib/sparkline";
import { safeHref } from "../lib/useKeymap";
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

type HomelabProps = {
  data?: HomelabData;
  selIndex: number;
  /** Konsolen-Adresse für einen laufenden Gast. Gestoppte bekommen keine. */
  consoleUrl: (vmid: number) => string;
};

export function Homelab({ data, selIndex, consoleUrl }: HomelabProps) {
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
      <table className="lab-guests">
        <thead>
          <tr>
            <th scope="col">Zustand</th><th scope="col">VMID</th><th scope="col">Name</th>
            <th scope="col">Status</th><th scope="col">CPU</th><th scope="col">Speicher</th>
          </tr>
        </thead>
        <tbody>
          {data.guests.map((g, i) => {
            // Eine Konsole zu einem gestoppten Gast öffnet ein leeres noVNC-Fenster.
            const href = g.running ? safeHref(consoleUrl(g.vmid)) : undefined;
            return (
              <tr key={g.vmid} className={`guest${i === selIndex ? " is-sel" : ""}`} data-row>
                {g.running ? (
                  <>
                    <td className="ok">●</td><td className="num">{g.vmid}</td>
                    <td className="name">
                      {href === undefined
                        ? g.name
                        : <a href={href} title={`Konsole von ${g.name} öffnen`}>{g.name}</a>}
                    </td>
                    <td className="dim">run</td>
                    <td className="val">{g.cpu} %</td>
                    <td className="val">{g.mem} %</td>
                  </>
                ) : (
                  <>
                    <td className="dim">○</td><td className="num">{g.vmid}</td>
                    <td className="name dim">{g.name}</td><td className="dim">stop</td>
                    <td className="val dim">–</td><td className="val dim">–</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
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
