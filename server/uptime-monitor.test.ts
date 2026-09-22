// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/defaults";
import { DEFAULT_PROFILE_ID, type Config, type ProfileId, type UptimeTarget } from "../src/config/schema";
import { uptimeResponseSchema } from "../src/lib/uptime";
import type { UptimeProbe, UptimeProbeResult } from "./uptime-probe";
import { createUptimeMonitor } from "./uptime-monitor";
import { emptyUptimeState, recordProbe, type UptimeStateDocument } from "./uptime-state";

const HTTP_ID = "123e4567-e89b-42d3-a456-426614174010";
const TCP_ID = "123e4567-e89b-42d3-a456-426614174011";
const WORK_ID = "123e4567-e89b-42d3-a456-426614174000";
const NOW = Date.parse("2026-09-22T10:03:00Z");

const httpTarget: UptimeTarget = {
  id: HTTP_ID,
  type: "http",
  label: "Web",
  url: "https://example.com/health",
};

const tcpTarget: UptimeTarget = {
  id: TCP_ID,
  type: "tcp",
  label: "Minecraft",
  host: "mc.example",
  port: 25565,
};

function config(targets: UptimeTarget[], enabled = true): Config {
  return { ...defaultConfig, uptime: { enabled, targets } };
}

function profile(profileId: ProfileId, profileConfig: Config) {
  return { profileId, config: profileConfig };
}

function memoryStore(initial: UptimeStateDocument = emptyUptimeState) {
  let document = structuredClone(initial);
  return {
    load: vi.fn(async () => structuredClone(document)),
    save: vi.fn(async (next: UptimeStateDocument) => { document = structuredClone(next); }),
    read: () => structuredClone(document),
  };
}

const successProbe: UptimeProbe = async () => ({ ok: true, responseTimeMs: 20 });

describe("createUptimeMonitor lifecycle", () => {
  it("initialisiert einmal, startet sofort, plant 60 Sekunden und stoppt genau seinen Timer", async () => {
    const stateStore = memoryStore();
    const configStore = { readAllProfileConfigs: vi.fn(async () => []) };
    const timer = { cancel: vi.fn() };
    const setIntervalFn = vi.fn(() => timer);
    const clearIntervalFn = vi.fn();
    const monitor = createUptimeMonitor({
      configStore,
      stateStore,
      probe: successProbe,
      now: () => NOW,
      setIntervalFn,
      clearIntervalFn,
    });

    await monitor.initialize();
    await monitor.initialize();
    monitor.start();
    await vi.waitFor(() => expect(configStore.readAllProfileConfigs).toHaveBeenCalledTimes(1));
    expect(stateStore.load).toHaveBeenCalledTimes(1);
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 60_000);
    monitor.stop();
    monitor.stop();
    expect(clearIntervalFn).toHaveBeenCalledTimes(1);
    expect(clearIntervalFn).toHaveBeenCalledWith(timer);
  });

  it("prüft deaktivierte Profile nicht und behält deren vorhandene Historie", async () => {
    const previous = recordProbe(undefined, httpTarget, { ok: true, responseTimeMs: 15 }, NOW);
    const stateStore = memoryStore({
      version: 1,
      profiles: [{ id: DEFAULT_PROFILE_ID, updatedAt: new Date(NOW).toISOString(), targets: [previous] }],
    });
    const probe = vi.fn(successProbe);
    const monitor = createUptimeMonitor({
      configStore: { readAllProfileConfigs: async () => [profile(DEFAULT_PROFILE_ID, config([httpTarget], false))] },
      stateStore,
      probe,
      now: () => NOW,
    });
    await monitor.initialize();
    await monitor.runOnce();
    expect(probe).not.toHaveBeenCalled();
    expect(stateStore.read().profiles[0]?.targets).toEqual([previous]);
  });

  it("entfernt gelöschte Profile und Ziele in der nächsten Runde", async () => {
    const stateStore = memoryStore({
      version: 1,
      profiles: [
        { id: DEFAULT_PROFILE_ID, updatedAt: null, targets: [recordProbe(undefined, httpTarget, { ok: true, responseTimeMs: 10 }, NOW), recordProbe(undefined, tcpTarget, { ok: true, responseTimeMs: 10 }, NOW)] },
        { id: WORK_ID, updatedAt: null, targets: [] },
      ],
    });
    const monitor = createUptimeMonitor({
      configStore: { readAllProfileConfigs: async () => [profile(DEFAULT_PROFILE_ID, config([httpTarget]))] },
      stateStore,
      probe: successProbe,
      now: () => NOW + 60_000,
    });
    await monitor.initialize();
    await monitor.runOnce();
    expect(stateStore.read().profiles.map(({ id }) => id)).toEqual([DEFAULT_PROFILE_ID]);
    expect(stateStore.read().profiles[0]?.targets.map(({ id }) => id)).toEqual([HTTP_ID]);
  });

  it("behält Historie bei Umbenennung und setzt sie bei geändertem Endpunkt zurück", async () => {
    let currentTarget: UptimeTarget = { ...httpTarget, label: "Neu" };
    let now = NOW + 60_000;
    const stateStore = memoryStore({
      version: 1,
      profiles: [{
        id: DEFAULT_PROFILE_ID,
        updatedAt: new Date(NOW).toISOString(),
        targets: [recordProbe(undefined, httpTarget, { ok: true, responseTimeMs: 10 }, NOW)],
      }],
    });
    const monitor = createUptimeMonitor({
      configStore: { readAllProfileConfigs: async () => [profile(DEFAULT_PROFILE_ID, config([currentTarget]))] },
      stateStore,
      probe: successProbe,
      now: () => now,
    });
    await monitor.initialize();
    await monitor.runOnce();
    expect(stateStore.read().profiles[0]?.targets[0]?.samples).toBe("11");

    currentTarget = { ...httpTarget, label: "Neu", url: "https://example.com/ready" };
    now += 60_000;
    await monitor.runOnce();
    expect(stateStore.read().profiles[0]?.targets[0]?.samples).toBe("1");
  });
});

describe("createUptimeMonitor sequencing", () => {
  it("begrenzt global auf acht Probes und startet keine überlappende Runde", async () => {
    const targets = Array.from({ length: 9 }, (_, index): UptimeTarget => ({
      ...httpTarget,
      id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`,
      label: `Web ${index}`,
      url: `https://service-${index}.example/`,
    }));
    const resolvers: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;
    const probe = vi.fn(async (): Promise<UptimeProbeResult> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => resolvers.push(resolve));
      active -= 1;
      return { ok: true, responseTimeMs: 10 };
    });
    const configStore = { readAllProfileConfigs: vi.fn(async () => [profile(DEFAULT_PROFILE_ID, config(targets))]) };
    const monitor = createUptimeMonitor({ configStore, stateStore: memoryStore(), probe, now: () => NOW });
    await monitor.initialize();

    const firstRun = monitor.runOnce();
    const overlappingRun = monitor.runOnce();
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(8));
    expect(maximumActive).toBe(8);
    expect(configStore.readAllProfileConfigs).toHaveBeenCalledTimes(1);
    resolvers.shift()?.();
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(9));
    for (const resolve of resolvers.splice(0)) resolve();
    await Promise.all([firstRun, overlappingRun]);
    expect(maximumActive).toBe(8);
    expect(configStore.readAllProfileConfigs).toHaveBeenCalledTimes(1);
  });

  it("behält bei einem Config-Lesefehler den letzten Snapshot", async () => {
    const configStore = {
      readAllProfileConfigs: vi.fn()
        .mockResolvedValueOnce([profile(DEFAULT_PROFILE_ID, config([httpTarget]))])
        .mockRejectedValueOnce(new Error("Config nicht lesbar")),
    };
    const monitor = createUptimeMonitor({ configStore, stateStore: memoryStore(), probe: successProbe, now: () => NOW });
    await monitor.initialize();
    await monitor.runOnce();
    const before = monitor.getSnapshot(DEFAULT_PROFILE_ID);
    await monitor.runOnce();
    expect(monitor.getSnapshot(DEFAULT_PROFILE_ID)).toEqual(before);
  });

  it("meldet einen Schreibfehler, behält neue Messwerte und erholt sich beim nächsten Save", async () => {
    const stateStore = memoryStore();
    stateStore.save.mockRejectedValueOnce(new Error("Datenträger voll"));
    const monitor = createUptimeMonitor({
      configStore: { readAllProfileConfigs: async () => [profile(DEFAULT_PROFILE_ID, config([httpTarget]))] },
      stateStore,
      probe: successProbe,
      now: () => NOW,
    });
    await monitor.initialize();
    await monitor.runOnce();
    expect(monitor.getSnapshot(DEFAULT_PROFILE_ID)).toMatchObject({
      storageOk: false,
      targets: [{ status: "up" }],
    });
    await monitor.runOnce();
    expect(monitor.getSnapshot(DEFAULT_PROFILE_ID).storageOk).toBe(true);
  });
});

describe("createUptimeMonitor snapshots", () => {
  it("liefert schon vor der ersten Runde einen validen leeren Snapshot", () => {
    const monitor = createUptimeMonitor({
      configStore: { readAllProfileConfigs: async () => [] },
      stateStore: memoryStore(),
      probe: successProbe,
      now: () => NOW,
    });
    expect(uptimeResponseSchema.safeParse(monitor.getSnapshot(DEFAULT_PROFILE_ID)).success).toBe(true);
    expect(monitor.getSnapshot(DEFAULT_PROFILE_ID).targets).toEqual([]);
  });

  it("isoliert Profile, hält Config-Reihenfolge und leitet veraltete Zustände ab", async () => {
    let now = NOW;
    const monitor = createUptimeMonitor({
      configStore: {
        readAllProfileConfigs: async () => [
          profile(DEFAULT_PROFILE_ID, config([tcpTarget, httpTarget])),
          profile(WORK_ID, config([{ ...httpTarget, id: TCP_ID, label: "Arbeit" }])),
        ],
      },
      stateStore: memoryStore(),
      probe: successProbe,
      now: () => now,
    });
    await monitor.initialize();
    await monitor.runOnce();
    expect(monitor.getSnapshot(DEFAULT_PROFILE_ID).targets.map(({ id }) => id)).toEqual([TCP_ID, HTTP_ID]);
    expect(monitor.getSnapshot(WORK_ID).targets.map(({ id }) => id)).toEqual([TCP_ID]);
    expect(monitor.getSnapshot(DEFAULT_PROFILE_ID).updatedAt).toBe(new Date(NOW).toISOString());
    expect(monitor.getSnapshot(WORK_ID).updatedAt).toBe(new Date(NOW).toISOString());

    now += 151_000;
    expect(monitor.getSnapshot(DEFAULT_PROFILE_ID).targets.every(({ status }) => status === "unknown")).toBe(true);
  });

  it("projiziert ein konfiguriertes Ziel ohne Historie als unbekannt", async () => {
    const monitor = createUptimeMonitor({
      configStore: { readAllProfileConfigs: async () => [profile(DEFAULT_PROFILE_ID, config([tcpTarget], false))] },
      stateStore: memoryStore(),
      probe: successProbe,
      now: () => NOW,
    });
    await monitor.initialize();
    await monitor.runOnce();
    expect(monitor.getSnapshot(DEFAULT_PROFILE_ID).targets[0]).toMatchObject({
      id: TCP_ID,
      status: "unknown",
      measuredMinutes: 0,
    });
  });
});
