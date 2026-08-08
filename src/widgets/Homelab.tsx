import { sparkline } from "../lib/sparkline";
import { safeHref } from "../lib/useKeymap";
import type { HomelabData, Level } from "../../server/pve";
import { z } from "zod";

export type { HomelabData };

const levelSchema = z.enum(["ok", "warn", "crit"]);
const homelabDataSchema = z.object({
  configured: z.boolean(),
  node: z.object({
    cpu: z.number().finite(), mem: z.number().finite(), root: z.number().finite(),
    uptimeDays: z.number().finite(), cpuSpark: z.array(z.number().finite()).max(1000),
    memSpark: z.array(z.number().finite()).max(1000), cpuLevel: levelSchema,
    memLevel: levelSchema, rootLevel: levelSchema,
  }),
  guests: z.array(z.object({
    vmid: z.number().int().positive(), name: z.string(), running: z.boolean(),
    cpu: z.number().finite(), mem: z.number().finite(), cpuLevel: levelSchema,
    memLevel: levelSchema,
  })).max(1000),
  storage: z.array(z.object({
    name: z.string(), pct: z.number().finite(), level: levelSchema,
  })).max(1000),
  alerts: z.array(z.object({ level: z.enum(["warn", "crit"]), text: z.string() })).max(1000),
});

export function decodeHomelab(value: unknown): HomelabData | undefined {
  const parsed = homelabDataSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export async function fetchHomelab(): Promise<HomelabData> {
  const res = await fetch("/api/homelab");
  if (!res.ok) throw new Error(`Homelab nicht ladbar (${res.status})`);
  const data = decodeHomelab(await res.json());
  if (data === undefined) throw new Error("Homelabantwort ungültig");
  return data;
}

function asLevel(v: unknown): Level {
  return v === "warn" || v === "crit" ? v : "ok";
}

/**
 * Im localStorage liegt nach einem Deploy noch die Antwortform von vorher. Die Pegel
 * kamen erst später dazu — ohne diese Auffrischung rendert die erste Darstellung aus
 * dem Cache, bevor der erste Fetch zurück ist, mit fehlenden Feldern. Dasselbe Ventil,
 * das reviveEvents und reviveNews für ihre Date-Felder benutzen.
 */
export function reviveHomelab(d: HomelabData): HomelabData {
  return {
    ...d,
    node: {
      ...d.node,
      cpuLevel: asLevel(d.node?.cpuLevel),
      memLevel: asLevel(d.node?.memLevel),
      rootLevel: asLevel(d.node?.rootLevel),
    },
    guests: (d.guests ?? []).map((g) => ({
      ...g, cpuLevel: asLevel(g.cpuLevel), memLevel: asLevel(g.memLevel),
    })),
    storage: (d.storage ?? []).map((s) => ({ ...s, level: asLevel(s.level) })),
  };
}

// Nur warn und crit bekommen Farbe. Wäre auch der Normalfall eingefärbt, hätte die Farbe
// nichts mehr zu sagen — sie wirkt hier gerade dadurch, dass sie selten ist.
const LEVEL_CLASS: Record<Level, string> = { ok: "", warn: " warn", crit: " crit" };
const LEVEL_WORD: Record<Level, string> = { ok: "", warn: "Warnung: ", crit: "kritisch: " };
// Über asLevel, damit auch eine unerwartete Antwort eine Zeile ergibt statt einer leeren Seite.
const cls = (level: Level) => LEVEL_CLASS[asLevel(level)];

function Bar({ name, pct, level }: { name: string; pct: number; level: Level }) {
  const width = 13;
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  return (
    <span>
      {name}{" "}
      <span className="bar" aria-label={`${LEVEL_WORD[asLevel(level)]}${name} zu ${pct} Prozent belegt`}>
        <span className={`bar-on${cls(level)}`}>{"━".repeat(filled)}</span>
        <span className="bar-off">{"─".repeat(width - filled)}</span>
      </span>{" "}
      <span className={`dim${cls(level)}`}>{pct} %</span>
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
          <span className="dim">cpu</span>
          <span className={cls(n.cpuLevel).trim() || undefined}>{n.cpu} %</span>
          <span className="spark" aria-label={`CPU-Auslastung der letzten 30 Minuten: ${n.cpuSpark.join(", ")} Prozent`}>
            {sparkline(n.cpuSpark)}
          </span>
        </span>
        <span className="metric">
          <span className="dim">mem</span>
          <span className={cls(n.memLevel).trim() || undefined}>{n.mem} %</span>
          <span className="spark" aria-label={`Speicherauslastung der letzten 30 Minuten: ${n.memSpark.join(", ")} Prozent`}>
            {sparkline(n.memSpark)}
          </span>
        </span>
        <span className="metric">
          <span className="dim">root</span>
          <span className={cls(n.rootLevel).trim() || undefined}>{n.root} %</span>
        </span>
        <span className="metric"><span className="dim">up</span><span>{n.uptimeDays} d</span></span>
      </div>
      <div className="lab-store">
        {data.storage.map((s) => <Bar key={s.name} name={s.name} pct={s.pct} level={s.level} />)}
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
                    <td className={`val${cls(g.cpuLevel)}`}>{g.cpu} %</td>
                    <td className={`val${cls(g.memLevel)}`}>{g.mem} %</td>
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
            // Ein Ausrufezeichen für warn, zwei für krit: der Schweregrad steht sonst
            // nur in der Farbe, und Rot und Gelb liegen bei Rotgrünblindheit nah beieinander.
            <div key={i} className={`alert ${a.level}`}>
              <span className="mark" aria-hidden="true">{a.level === "crit" ? "!!" : "!"}</span>
              <span><span className="sr-only">{LEVEL_WORD[a.level]}</span>{a.text}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
