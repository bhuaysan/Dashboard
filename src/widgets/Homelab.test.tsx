import { describe, expect, it } from "vitest";
import { decodeHomelab, reviveHomelab } from "./Homelab";
import type { HomelabData } from "./Homelab";

describe("reviveHomelab", () => {
  it("ergänzt die Pegel, die im Cache von vor dem Deploy noch fehlen", () => {
    // So sah die Antwort vor dieser Änderung aus — genau das liegt nach einem Deploy
    // noch im localStorage und wird als Erstes gerendert.
    const alt = {
      configured: true,
      node: { cpu: 6, mem: 53, root: 31, uptimeDays: 88, cpuSpark: [], memSpark: [] },
      guests: [{ vmid: 100, name: "caddy", running: true, cpu: 0, mem: 8 }],
      storage: [{ name: "tank", pct: 24 }],
      alerts: [],
    } as unknown as HomelabData;
    const d = reviveHomelab(alt);
    expect(d.node.memLevel).toBe("ok");
    expect(d.guests[0]?.memLevel).toBe("ok");
    expect(d.storage[0]?.level).toBe("ok");
  });

  it("lässt vorhandene Pegel unangetastet", () => {
    const d = reviveHomelab({
      configured: true,
      node: { cpu: 6, mem: 95, root: 31, uptimeDays: 88, cpuSpark: [], memSpark: [],
              cpuLevel: "ok", memLevel: "crit", rootLevel: "ok" },
      guests: [{ vmid: 100, name: "caddy", running: true, cpu: 0, mem: 88,
                 cpuLevel: "ok", memLevel: "warn" }],
      storage: [{ name: "tank", pct: 97, level: "crit" }],
      alerts: [],
    });
    expect(d.node.memLevel).toBe("crit");
    expect(d.guests[0]?.memLevel).toBe("warn");
    expect(d.storage[0]?.level).toBe("crit");
  });
});

describe("decodeHomelab", () => {
  it("verwirft eine formal gültige, aber strukturell leere Antwort", () => {
    expect(decodeHomelab({ configured: true, node: {}, guests: [], storage: [], alerts: [] })).toBeUndefined();
  });

  it("verwirft endliche, aber unmögliche Prozentwerte", () => {
    expect(decodeHomelab({
      configured: true,
      node: {
        cpu: 101, mem: 0, root: 0, uptimeDays: 1, cpuSpark: [], memSpark: [],
        cpuLevel: "ok", memLevel: "ok", rootLevel: "ok",
      },
      guests: [], storage: [], alerts: [],
    })).toBeUndefined();
  });

  it("ergänzt bei einem alten, ansonsten validen Cache die Pegel", () => {
    const decoded = decodeHomelab({
      configured: true,
      node: { cpu: 6, mem: 53, root: 31, uptimeDays: 88, cpuSpark: [], memSpark: [] },
      guests: [{ vmid: 100, name: "caddy", running: true, cpu: 0, mem: 8 }],
      storage: [{ name: "tank", pct: 24 }],
      alerts: [],
    });
    expect(decoded?.node.memLevel).toBe("ok");
    expect(decoded?.guests[0]?.memLevel).toBe("ok");
  });
});
