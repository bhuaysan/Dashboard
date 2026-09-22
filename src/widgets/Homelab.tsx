import { sparkline } from "../lib/sparkline";
import { safeHref } from "../lib/url";
import { homelabDataSchema, type HomelabData, type Level } from "../lib/homelab";
import { z } from "zod";
import type { ProfileId } from "../config/schema";
import { profileApiUrl } from "../api/profileUrl";

export type { HomelabData };

const percentage = z.number().finite().min(0).max(100);
const nonNegative = z.number().finite().min(0);
const text = z.string().min(1).max(256);

// Vor dem Hinzufügen der Pegel enthielt der Cache dieselben Messfelder ohne die
// cpuLevel/memLevel/rootLevel-Felder. Strict verhindert, dass eine Antwort mit einem
// vorhandenen, aber ungültigen Pegel still als alte Antwort akzeptiert wird.
const legacyHomelabDataSchema = z.object({
  configured: z.boolean(),
  node: z.object({
    cpu: percentage, mem: percentage, root: percentage, uptimeDays: nonNegative,
    cpuSpark: z.array(percentage).max(1000), memSpark: z.array(percentage).max(1000),
  }).strict(),
  guests: z.array(z.object({
    vmid: z.number().int().positive().max(999999), name: text, running: z.boolean(),
    cpu: percentage, mem: percentage,
  }).strict()).max(1000),
  storage: z.array(z.object({ name: text, pct: percentage }).strict()).max(1000),
  alerts: z.array(z.object({ level: z.enum(["warn", "crit"]), text }).strict()).max(1000),
}).strict();

export function decodeHomelab(value: unknown): HomelabData | undefined {
  const parsed = homelabDataSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const legacy = legacyHomelabDataSchema.safeParse(value);
  return legacy.success ? reviveHomelab(legacy.data) : undefined;
}

export async function fetchHomelab(profileId: ProfileId, signal?: AbortSignal): Promise<HomelabData> {
  const url = profileApiUrl("/api/homelab", profileId);
  const res = signal === undefined ? await fetch(url) : await fetch(url, { signal });
  if (!res.ok) throw new Error(`Homelab nicht ladbar (${res.status})`);
  const data = decodeHomelab(await res.json());
  if (data === undefined) throw new Error("Homelabantwort ungültig");
  return data;
}

function asLevel(v: unknown): Level {
  return v === "warn" || v === "crit" ? v : "ok";
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
  // Name, Wert, Balken — dieselbe Reihenfolge wie bei den Knotenwerten darüber. Vorher
  // stand der Balken zwischen Name und Prozentzahl und damit anders herum als dort.
  return (
    <span className="metric metric--store">
      <span>{name}</span>
      <span className={`val${cls(level)}`}>{pct} %</span>
      <span className="bar" aria-label={`${LEVEL_WORD[asLevel(level)]}${name} zu ${pct} Prozent belegt`}>
        <span className={`bar-on${cls(level)}`}>{"━".repeat(filled)}</span>
        <span className="bar-off">{"─".repeat(width - filled)}</span>
      </span>
    </span>
  );
}

type HomelabShape = {
  configured: boolean;
  node: {
    cpu: number; mem: number; root: number; uptimeDays: number;
    cpuSpark: number[]; memSpark: number[];
    cpuLevel?: unknown; memLevel?: unknown; rootLevel?: unknown;
  };
  guests: {
    vmid: number; name: string; running: boolean; cpu: number; mem: number;
    cpuLevel?: unknown; memLevel?: unknown;
  }[];
  storage: { name: string; pct: number; level?: unknown }[];
  alerts: { level: "warn" | "crit"; text: string }[];
};

export function reviveHomelab(d: HomelabShape): HomelabData {
  return {
    ...d,
    node: {
      ...d.node,
      cpuLevel: asLevel(d.node.cpuLevel),
      memLevel: asLevel(d.node.memLevel),
      rootLevel: asLevel(d.node.rootLevel),
    },
    guests: d.guests.map((g) => ({
      ...g, cpuLevel: asLevel(g.cpuLevel), memLevel: asLevel(g.memLevel),
    })),
    storage: d.storage.map((s) => ({ ...s, level: asLevel(s.level) })),
  };
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
          <span className={`val${cls(n.cpuLevel)}`}>{n.cpu} %</span>
          <span className="spark" aria-label={`CPU-Auslastung der letzten 30 Minuten: ${n.cpuSpark.join(", ")} Prozent`}>
            {sparkline(n.cpuSpark)}
          </span>
        </span>
        <span className="metric">
          <span className="dim">mem</span>
          <span className={`val${cls(n.memLevel)}`}>{n.mem} %</span>
          <span className="spark" aria-label={`Speicherauslastung der letzten 30 Minuten: ${n.memSpark.join(", ")} Prozent`}>
            {sparkline(n.memSpark)}
          </span>
        </span>
        <span className="metric">
          <span className="dim">root</span>
          <span className={`val${cls(n.rootLevel)}`}>{n.root} %</span>
        </span>
        <span className="metric"><span className="dim">up</span><span className="val">{n.uptimeDays} d</span></span>
      </div>
      <div className="lab-store">
        {data.storage.map((s) => <Bar key={s.name} name={s.name} pct={s.pct} level={s.level} />)}
      </div>
      <table className="lab-guests">
        <thead>
          {/* Dieselbe Zeilenklasse wie ein Gast, damit die sechs Spalten übereinander
              stehen. „Zustand" bleibt für Screenreader, sichtbar wäre das Wort über
              einem einzelnen ● nur Ballast. */}
          <tr className="guest guest--head">
            <th scope="col"><span className="sr-only">Zustand</span></th>
            <th scope="col" className="num">VMID</th>
            <th scope="col">Name</th>
            <th scope="col">Status</th>
            <th scope="col" className="val">CPU</th>
            <th scope="col" className="val">Mem</th>
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
