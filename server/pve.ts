import { Agent, fetch as undiciFetch } from "undici";
import { readFileSync } from "node:fs";
import type { DashboardEnvironment } from "./env.ts";
import { checkReachability, type ReachResult } from "./reachability.ts";
import { relativeTime } from "../src/lib/relativeTime.ts";
import type { Config } from "../src/config/schema.ts";
import {
  homelabDataSchema,
  MAX_HOMELAB_TEXT_LENGTH,
  type HomelabData,
  type Level,
} from "../src/lib/homelab.ts";
import { z } from "zod";

export type { HomelabData, Level } from "../src/lib/homelab.ts";

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
type Task = { id?: string | null; starttime: number; endtime?: number; status?: string };

const finite = z.number().finite();
const nonNegative = finite.min(0);
const ratio = finite.min(0).max(1);
const unixSeconds = nonNegative.refine(
  (value) => Number.isFinite(new Date(value * 1000).getTime()),
  "Ungültiger Zeitstempel",
);
const nodeStatusSchema = z.object({
  cpu: ratio,
  memory: z.object({ used: nonNegative, total: nonNegative }),
  rootfs: z.object({ used: nonNegative, total: nonNegative }),
  uptime: nonNegative,
});
const rrdPointSchema = z.object({
  cpu: ratio.optional(), memused: nonNegative.optional(), memtotal: nonNegative.optional(),
});
const resourceSchema = z.object({
  vmid: z.number().int().positive().max(999999), name: z.string().max(256).optional(), type: z.string(),
  status: z.string().max(64), cpu: ratio.optional(), mem: nonNegative.optional(),
  maxmem: nonNegative.optional(), template: z.number().int().optional(),
});
const storageEntrySchema = z.object({
  storage: z.string().min(1).max(256), total: nonNegative, used: nonNegative,
  active: z.number().int().min(0).max(1),
});
const taskSchema = z.object({
  id: z.string().max(256).nullable().optional(), starttime: unixSeconds,
  endtime: unixSeconds.optional(), status: z.string().max(256).optional(),
});

export type PveRaw = {
  status: NodeStatus;
  rrd: RrdPoint[];
  resources: Resource[];
  storages: StorageEntry[];
  tasks: Task[];
  updates: unknown[];
  reachability: ReachResult[];
};

// Das Proxmox-Zertifikat ist selbst ausgestellt. Wir prüfen es korrekt gegen die eigene CA,
// statt die Prüfung abzuschalten. servername ist nötig, weil wir per IP verbinden,
// das Zertifikat aber auf pve.homelab.local lautet.
function pveAgent(runtimeEnv: DashboardEnvironment): Agent {
  if (!runtimeEnv.pve) throw new Error("PVE nicht konfiguriert");
  return new Agent({
    connect: { ca: readFileSync(runtimeEnv.pve.caPath), servername: "pve.homelab.local" },
  });
}

export function parsePveEnvelope<T>(raw: unknown, path: string, schema: z.ZodType<T>): T {
  const envelope = z.object({ data: z.unknown() }).safeParse(raw);
  const hasData = typeof raw === "object" && raw !== null && !Array.isArray(raw) && "data" in raw;
  if (!envelope.success || !hasData) throw new Error(`PVE ${path}: ungültige Antwort`);
  const data = schema.safeParse(envelope.data.data);
  if (!data.success) throw new Error(`PVE ${path}: ungültige Daten`);
  return data.data;
}

export const MAX_PVE_RESPONSE_BYTES = 2 * 1024 * 1024;

async function cancelResponseBody(res: Response): Promise<void> {
  try { await res.body?.cancel(); } catch { /* best effort */ }
}

async function readPveJson(res: Response, path: string): Promise<unknown> {
  const declared = res.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_PVE_RESPONSE_BYTES) {
      await cancelResponseBody(res);
      throw new Error(`PVE ${path}: Antwort zu groß`);
    }
  }
  if (!res.body) throw new Error(`PVE ${path}: ungültige Antwort`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let source = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PVE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(`PVE ${path}: Antwort zu groß`);
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error(`PVE ${path}: ungültige Antwort`);
  }
}

async function pveGet<T>(
  runtimeEnv: DashboardEnvironment,
  agent: Agent,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!runtimeEnv.pve) throw new Error("PVE nicht konfiguriert");
  const res = await undiciFetch(`${runtimeEnv.pve.url}/api2/json${path}`, {
    headers: { Authorization: `PVEAPIToken=${runtimeEnv.pve.tokenId}=${runtimeEnv.pve.secret}` },
    dispatcher: agent,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    await cancelResponseBody(res);
    throw new Error(`PVE ${path}: HTTP ${res.status}`);
  }
  const raw = await readPveJson(res, path);
  return parsePveEnvelope(raw, path, schema);
}

export function pveNodePathSegment(node: string): string {
  return encodeURIComponent(node);
}

export function buildHomelab(raw: PveRaw, cfg: Config["homelab"], now = new Date()): HomelabData {
  const pct = (used: number, total: number) => total > 0
    ? Math.max(0, Math.min(100, Math.round((used / total) * 100)))
    : 0;

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
  const pushAlert = (level: "warn" | "crit", message: string) => {
    const text = message.length <= MAX_HOMELAB_TEXT_LENGTH
      ? message
      : `${message.slice(0, MAX_HOMELAB_TEXT_LENGTH - 1)}…`;
    alerts.push({ level, text });
  };

  for (const vmid of cfg.expectRunning) {
    const g = guests.find((x) => x.vmid === vmid);
    if (!g) {
      pushAlert("crit", `gast vmid ${vmid} nicht gefunden`);
    } else if (!g.running) {
      pushAlert("crit", `gast ${g.name} läuft nicht`);
    }
  }

  if (raw.tasks.length === 0) {
    pushAlert("crit", "keine vzdump-Backups konfiguriert");
  } else {
    const latestByVmid = new Map<number, Task>();
    for (const t of raw.tasks) {
      if (t.endtime === undefined) continue;   // läuft noch
      if (typeof t.id !== "string" || !/^\d+$/.test(t.id)) continue;
      const vmid = Number(t.id);
      if (!Number.isSafeInteger(vmid) || vmid <= 0) continue;
      const prev = latestByVmid.get(vmid);
      if (!prev || (t.endtime ?? 0) > (prev.endtime ?? 0)) latestByVmid.set(vmid, t);
    }
    for (const [vmid, task] of latestByVmid) {
      const end = new Date((task.endtime ?? 0) * 1000);
      const rel = relativeTime(end, now);
      if (task.status !== "OK") {
        pushAlert("crit", `backup ${nameOf(vmid)} fehlgeschlagen ${rel}`);
      } else if (now.getTime() - end.getTime() > cfg.thresholds.backupAgeHours * 3600_000) {
        pushAlert("warn", `backup ${nameOf(vmid)} alt: ${rel}`);
      }
    }
  }

  if (raw.updates.length > 0) {
    pushAlert("warn", `pve ${raw.updates.length} updates verfügbar`);
  }

  for (const s of storage) {
    if (s.level !== "ok") {
      pushAlert(s.level, `storage ${s.name} zu ${s.pct}% voll`);
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
    pushAlert("crit", `node speicher zu ${pct(raw.status.memory.used, raw.status.memory.total)}% belegt`);
  }
  for (const g of guests) {
    if (g.memLevel === "crit") {
      pushAlert("crit", `gast ${g.name} speicher zu ${g.mem}% belegt`);
    }
  }

  for (const r of raw.reachability) {
    if (!r.ok) pushAlert("crit", `${r.label} nicht erreichbar`);
  }

  return homelabDataSchema.parse({
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
  });
}

export async function fetchHomelab(cfg: Config, runtimeEnv: DashboardEnvironment): Promise<HomelabData> {
  if (!runtimeEnv.pve) return emptyHomelab;
  const node = pveNodePathSegment(cfg.homelab.node);
  const agent = pveAgent(runtimeEnv);
  try {
    const [status, rrd, resources, storages, tasks, updates, reachability] = await Promise.all([
      pveGet<NodeStatus>(runtimeEnv, agent, `/nodes/${node}/status`, nodeStatusSchema),
      pveGet<RrdPoint[]>(runtimeEnv, agent, `/nodes/${node}/rrddata?timeframe=hour&cf=AVERAGE`, z.array(rrdPointSchema).max(10000)),
      pveGet<Resource[]>(runtimeEnv, agent, `/cluster/resources?type=vm`, z.array(resourceSchema).max(10000)),
      pveGet<StorageEntry[]>(runtimeEnv, agent, `/nodes/${node}/storage`, z.array(storageEntrySchema).max(1000)),
      pveGet<Task[]>(runtimeEnv, agent, `/nodes/${node}/tasks?typefilter=vzdump&limit=50`, z.array(taskSchema).max(1000)),
      pveGet<unknown[]>(runtimeEnv, agent, `/nodes/${node}/apt/update`, z.array(z.unknown()).max(1000)),
      checkReachability(cfg.homelab.reachability),
    ]);
    return buildHomelab({ status, rrd, resources, storages, tasks, updates, reachability }, cfg.homelab);
  } finally {
    await agent.close();
  }
}
