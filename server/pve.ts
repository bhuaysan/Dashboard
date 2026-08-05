import { Agent, fetch as undiciFetch } from "undici";
import { readFileSync } from "node:fs";
import { env } from "./env.ts";
import { checkReachability, type ReachResult } from "./reachability.ts";
import { relativeTime } from "../src/lib/relativeTime.ts";
import type { Config } from "../src/config/schema.ts";

export type HomelabData = {
  node: { cpu: number; mem: number; root: number; uptimeDays: number;
          cpuSpark: number[]; memSpark: number[] };
  guests: { vmid: number; name: string; running: boolean; cpu: number; mem: number }[];
  storage: { name: string; pct: number }[];
  alerts: { level: "warn" | "crit"; text: string }[];
  configured: boolean;    // false, wenn env.pve undefined ist
};

export const emptyHomelab: HomelabData = {
  configured: false,
  node: { cpu: 0, mem: 0, root: 0, uptimeDays: 0, cpuSpark: [], memSpark: [] },
  guests: [],
  storage: [],
  alerts: [],
};

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
    .map((r) => ({
      vmid: r.vmid,
      name: r.name ?? `vmid ${r.vmid}`,
      running: r.status === "running",
      cpu: Math.round((r.cpu ?? 0) * 100),
      mem: r.maxmem ? pct(r.mem ?? 0, r.maxmem) : 0,
    }))
    .sort((a, b) => a.vmid - b.vmid);

  const storage = raw.storages
    .filter((s) => s.active === 1 && s.total > 0)
    .map((s) => ({ name: s.storage, pct: pct(s.used, s.total) }));

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
    if (s.pct > cfg.thresholds.storage) {
      alerts.push({ level: "warn", text: `storage ${s.name} zu ${s.pct}% voll` });
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
