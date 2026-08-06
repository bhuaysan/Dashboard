import { Agent, fetch as undiciFetch } from "undici";
import { readFileSync } from "node:fs";
import { env } from "./env.ts";
import { checkReachability, type ReachResult } from "./reachability.ts";
import { relativeTime } from "../src/lib/relativeTime.ts";
import type { Config } from "../src/config/schema.ts";

export type Level = "ok" | "warn" | "crit";

export type HomelabData = {
  node: { cpu: number; mem: number; root: number; uptimeDays: number;
          cpuSpark: number[]; memSpark: number[];
          cpuLevel: Level; memLevel: Level; rootLevel: Level };
  guests: { vmid: number; name: string; running: boolean; cpu: number; mem: number;
            cpuLevel: Level; memLevel: Level }[];
  storage: { name: string; pct: number; level: Level }[];
  alerts: { level: "warn" | "crit"; text: string }[];
  configured: boolean;    // false, wenn env.pve undefined ist
};

export const emptyHomelab: HomelabData = {
  configured: false,
  node: { cpu: 0, mem: 0, root: 0, uptimeDays: 0, cpuSpark: [], memSpark: [],
          cpuLevel: "ok", memLevel: "ok", rootLevel: "ok" },
  guests: [],
  storage: [],
  alerts: [],
};

/**
 * Warnung oberhalb der eingestellten Schwelle, kritisch auf halbem Weg von dort nach
 * 100 %. Bei mem: 85 heißt das warn über 85, krit über 92,5. Ein zweiter Schwellwert in
 * der Config wäre ein weiteres Feld, das gepflegt werden will; so folgt die kritische
 * Marke automatisch der eingestellten.
 *
 * Echt größer, nicht größer-gleich: so gilt für Storage weiter genau die Grenze, die die
 * Regel vorher hatte. Ein gestoppter Gast hat keine Last und damit keinen Pegel.
 */
export function levelFor(pct: number, threshold: number): Level {
  if (pct > threshold + (100 - threshold) / 2) return "crit";
  if (pct > threshold) return "warn";
  return "ok";
}

type NodeStatus = {
  cpu: number;
  memory: { used: number; total: number };
  rootfs: { used: number; total: number };
  uptime: number;
};
type RrdPoint = { cpu?: number; memused?: number; memtotal?: number };
type Resource = {
  vmid: number; name?: string; type: string; status: string;
  cpu?: number; mem?: number; maxmem?: number; template?: number;
};
type StorageEntry = { storage: string; total: number; used: number; active: number };
type Task = { id?: string; starttime: number; endtime?: number; status?: string };

export type PveRaw = {
  status: NodeStatus;
  rrd: RrdPoint[];
  resources: Resource[];
  storages: StorageEntry[];
  tasks: Task[];
  updates: unknown[];
  reachability: ReachResult[];
};

let agent: Agent | undefined;

// Das Proxmox-Zertifikat ist selbst ausgestellt. Wir prüfen es korrekt gegen die eigene CA,
// statt die Prüfung abzuschalten. servername ist nötig, weil wir per IP verbinden,
// das Zertifikat aber auf pve.homelab.local lautet.
function pveAgent(): Agent {
  if (!env.pve) throw new Error("PVE nicht konfiguriert");
  agent ??= new Agent({
    connect: { ca: readFileSync(env.pve.caPath), servername: "pve.homelab.local" },
  });
  return agent;
}

async function pveGet<T>(path: string): Promise<T> {
  if (!env.pve) throw new Error("PVE nicht konfiguriert");
  const res = await undiciFetch(`${env.pve.url}/api2/json${path}`, {
    headers: { Authorization: `PVEAPIToken=${env.pve.tokenId}=${env.pve.secret}` },
    dispatcher: pveAgent(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`PVE ${path}: HTTP ${res.status}`);
  return (await res.json() as { data: T }).data;
}

export function buildHomelab(raw: PveRaw, cfg: Config["homelab"], now = new Date()): HomelabData {
  const pct = (used: number, total: number) => (total > 0 ? Math.round((used / total) * 100) : 0);

  const cpuSpark = raw.rrd.filter((p) => p.cpu !== undefined).slice(-30)
    .map((p) => Math.round((p.cpu ?? 0) * 100));
  const memSpark = raw.rrd.filter((p) => p.memused !== undefined && p.memtotal).slice(-30)
    .map((p) => pct(p.memused ?? 0, p.memtotal ?? 0));

  const guests = raw.resources
    .filter((r) => r.template !== 1)
    .map((r) => {
      const running = r.status === "running";
      const cpu = Math.round((r.cpu ?? 0) * 100);
      const mem = r.maxmem ? pct(r.mem ?? 0, r.maxmem) : 0;
      return {
        vmid: r.vmid,
        name: r.name ?? `vmid ${r.vmid}`,
        running,
        cpu,
        mem,
        cpuLevel: running ? levelFor(cpu, cfg.thresholds.cpu) : ("ok" as Level),
        memLevel: running ? levelFor(mem, cfg.thresholds.mem) : ("ok" as Level),
      };
    })
    .sort((a, b) => a.vmid - b.vmid);

  const storage = raw.storages
    .filter((s) => s.active === 1 && s.total > 0)
    .map((s) => {
      const p = pct(s.used, s.total);
      return { name: s.storage, pct: p, level: levelFor(p, cfg.thresholds.storage) };
    });

  const nameOf = (vmid: number) => guests.find((g) => g.vmid === vmid)?.name ?? `vmid ${vmid}`;
  const alerts: HomelabData["alerts"] = [];

  for (const vmid of cfg.expectRunning) {
    const g = guests.find((x) => x.vmid === vmid);
    if (g && !g.running) alerts.push({ level: "crit", text: `gast ${g.name} läuft nicht` });
  }

  if (raw.tasks.length === 0) {
    alerts.push({ level: "crit", text: "keine vzdump-Backups konfiguriert" });
  } else {
    const latestByVmid = new Map<number, Task>();
    for (const t of raw.tasks) {
      if (t.endtime === undefined) continue;   // läuft noch
      const vmid = Number(t.id);
      if (!Number.isInteger(vmid)) continue;
      const prev = latestByVmid.get(vmid);
      if (!prev || (t.endtime ?? 0) > (prev.endtime ?? 0)) latestByVmid.set(vmid, t);
    }
    for (const [vmid, task] of latestByVmid) {
      const end = new Date((task.endtime ?? 0) * 1000);
      const rel = relativeTime(end, now);
      if (task.status !== "OK") {
        alerts.push({ level: "crit", text: `backup ${nameOf(vmid)} fehlgeschlagen ${rel}` });
      } else if (now.getTime() - end.getTime() > cfg.thresholds.backupAgeHours * 3600_000) {
        alerts.push({ level: "warn", text: `backup ${nameOf(vmid)} alt: ${rel}` });
      }
    }
  }

  if (raw.updates.length > 0) {
    alerts.push({ level: "warn", text: `pve ${raw.updates.length} updates verfügbar` });
  }

  for (const s of storage) {
    if (s.level !== "ok") {
      alerts.push({ level: s.level, text: `storage ${s.name} zu ${s.pct}% voll` });
    }
  }

  // Nur der kritische Pegel bekommt eine Zeile. Die Warnstufe steht schon farbig in der
  // Tabelle, und bei vierzehn Gästen wäre eine Zeile je Warnung wieder die Alarmflut,
  // die die leere vzdump-Liste einmal erzeugt hat.
  //
  // Und nur Speicher, nicht CPU: die Auslastung ist ein einzelner Messwert. Ein Gast,
  // der gerade rechnet, ist kein Alarm — voller Speicher dagegen ist einer.
  const nodeMemLevel = levelFor(pct(raw.status.memory.used, raw.status.memory.total),
                                cfg.thresholds.mem);
  if (nodeMemLevel === "crit") {
    alerts.push({
      level: "crit",
      text: `node speicher zu ${pct(raw.status.memory.used, raw.status.memory.total)}% belegt`,
    });
  }
  for (const g of guests) {
    if (g.memLevel === "crit") {
      alerts.push({ level: "crit", text: `gast ${g.name} speicher zu ${g.mem}% belegt` });
    }
  }

  for (const r of raw.reachability) {
    if (!r.ok) alerts.push({ level: "crit", text: `${r.label} nicht erreichbar` });
  }

  return {
    configured: true,
    node: {
      cpu: Math.round(raw.status.cpu * 100),
      mem: pct(raw.status.memory.used, raw.status.memory.total),
      root: pct(raw.status.rootfs.used, raw.status.rootfs.total),
      uptimeDays: Math.floor(raw.status.uptime / 86400),
      cpuSpark,
      memSpark,
      cpuLevel: levelFor(Math.round(raw.status.cpu * 100), cfg.thresholds.cpu),
      memLevel: nodeMemLevel,
      // root ist ein Dateisystem und richtet sich nach der Storage-Schwelle.
      rootLevel: levelFor(pct(raw.status.rootfs.used, raw.status.rootfs.total),
                          cfg.thresholds.storage),
    },
    guests,
    storage,
    alerts,
  };
}

export async function fetchHomelab(cfg: Config): Promise<HomelabData> {
  if (!env.pve) return emptyHomelab;
  const node = cfg.homelab.node;
  const [status, rrd, resources, storages, tasks, updates, reachability] = await Promise.all([
    pveGet<NodeStatus>(`/nodes/${node}/status`),
    pveGet<RrdPoint[]>(`/nodes/${node}/rrddata?timeframe=hour&cf=AVERAGE`),
    pveGet<Resource[]>(`/cluster/resources?type=vm`),
    pveGet<StorageEntry[]>(`/nodes/${node}/storage`),
    pveGet<Task[]>(`/nodes/${node}/tasks?typefilter=vzdump&limit=50`),
    pveGet<unknown[]>(`/nodes/${node}/apt/update`),
    checkReachability(cfg.homelab.reachability),
  ]);
  return buildHomelab({ status, rrd, resources, storages, tasks, updates, reachability }, cfg.homelab);
}
