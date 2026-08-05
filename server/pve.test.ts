import { describe, expect, it } from "vitest";
import { buildHomelab, type PveRaw } from "./pve.ts";
import { defaultConfig } from "../src/config/defaults";

const cfg = { ...defaultConfig.homelab, expectRunning: [100, 110] };
const NOW = new Date("2026-08-05T14:00:00Z");
const H = 3600_000;

function raw(overrides: Partial<PveRaw> = {}): PveRaw {
  return {
    status: {
      cpu: 0.12,
      memory: { used: 41, total: 100 },
      rootfs: { used: 23, total: 100 },
      uptime: 87 * 86400,
    },
    rrd: [],
    resources: [],
    storages: [],
    tasks: [],
    updates: [],
    reachability: [],
    ...overrides,
  };
}

function guest(vmid: number, status: string, extra: Record<string, unknown> = {}) {
  return { vmid, name: `gast-${vmid}`, type: "lxc", status, cpu: 0.01, mem: 10, maxmem: 100, ...extra };
}

describe("buildHomelab · expectRunning", () => {
  it("gestoppter Gast in expectRunning erzeugt crit", () => {
    const d = buildHomelab(raw({ resources: [guest(110, "stopped")] }), cfg, NOW);
    expect(d.alerts).toContainEqual({ level: "crit", text: "gast gast-110 läuft nicht" });
  });

  it("gestoppter Gast außerhalb von expectRunning erzeugt keine Zeile", () => {
    const d = buildHomelab(raw({ resources: [guest(108, "stopped")] }), cfg, NOW);
    expect(d.alerts.filter((a) => a.text.includes("läuft nicht"))).toHaveLength(0);
  });
});

describe("buildHomelab · Backups", () => {
  it("leere vzdump-Liste erzeugt genau eine Zeile", () => {
    const d = buildHomelab(raw({ resources: [guest(100, "running"), guest(110, "running")] }), cfg, NOW);
    const backupAlerts = d.alerts.filter((a) => a.text.includes("vzdump") || a.text.includes("backup"));
    expect(backupAlerts).toEqual([{ level: "crit", text: "keine vzdump-Backups konfiguriert" }]);
  });

  it("Gast ohne Backup-Historie erzeugt keine Zeile", () => {
    const d = buildHomelab(raw({
      resources: [guest(100, "running"), guest(101, "running")],
      tasks: [{ id: "100", starttime: 1, endtime: (NOW.getTime() - 2 * H) / 1000, status: "OK" }],
    }), cfg, NOW);
    expect(d.alerts.filter((a) => a.text.includes("101"))).toHaveLength(0);
  });

  it("erfolgreiches, frisches vzdump erzeugt keine Zeile", () => {
    const d = buildHomelab(raw({
      resources: [guest(100, "running")],
      tasks: [{ id: "100", starttime: 1, endtime: (NOW.getTime() - 2 * H) / 1000, status: "OK" }],
    }), cfg, NOW);
    expect(d.alerts.filter((a) => a.text.startsWith("backup"))).toHaveLength(0);
  });

  it("vzdump älter als die Schwelle erzeugt warn", () => {
    const d = buildHomelab(raw({
      resources: [guest(100, "running")],
      tasks: [{ id: "100", starttime: 1, endtime: (NOW.getTime() - 48 * H) / 1000, status: "OK" }],
    }), cfg, NOW);
    expect(d.alerts).toContainEqual({ level: "warn", text: "backup gast-100 alt: vor 2 d" });
  });

  it("fehlgeschlagenes vzdump erzeugt crit, laufende Tasks werden ignoriert", () => {
    const d = buildHomelab(raw({
      resources: [guest(100, "running")],
      tasks: [
        { id: "100", starttime: 1, endtime: (NOW.getTime() - 3 * H) / 1000, status: "FAILED: io error" },
        { id: "100", starttime: 2 },   // läuft noch
      ],
    }), cfg, NOW);
    expect(d.alerts).toContainEqual({ level: "crit", text: "backup gast-100 fehlgeschlagen vor 3 h" });
  });
});

describe("buildHomelab · Rest", () => {
  it("überspringt Gäste mit template: 1", () => {
    const d = buildHomelab(raw({ resources: [guest(100, "running"), guest(900, "stopped", { template: 1 })] }), cfg, NOW);
    expect(d.guests.map((g) => g.vmid)).toEqual([100]);
  });

  it("rrddata mit Lücken erzeugt keine NaN", () => {
    const d = buildHomelab(raw({
      rrd: [{ cpu: 0.5, memused: 50, memtotal: 100 }, {}, { cpu: undefined }, { cpu: 1, memused: 100, memtotal: 100 }],
    }), cfg, NOW);
    expect(d.node.cpuSpark).toEqual([50, 100]);
    expect(d.node.memSpark).toEqual([50, 100]);
    expect(d.node.cpuSpark.some(Number.isNaN)).toBe(false);
    expect(d.node.memSpark.some(Number.isNaN)).toBe(false);
  });

  it("meldet ausstehende Updates und volle Storages", () => {
    const d = buildHomelab(raw({
      storages: [{ storage: "tank", total: 100, used: 90, active: 1 }],
      updates: [{}],
    }), cfg, NOW);
    expect(d.alerts).toContainEqual({ level: "warn", text: "pve 1 updates verfügbar" });
    expect(d.alerts).toContainEqual({ level: "warn", text: "storage tank zu 90% voll" });
  });

  it("meldet nicht erreichbare Ziele als crit", () => {
    const d = buildHomelab(raw({ reachability: [{ label: "pihole", ok: false }] }), cfg, NOW);
    expect(d.alerts).toContainEqual({ level: "crit", text: "pihole nicht erreichbar" });
  });
});
