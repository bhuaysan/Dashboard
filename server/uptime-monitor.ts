import type { Config, ProfileId, UptimeTarget } from "../src/config/schema";
import { uptimeResponseSchema, type UptimeResponse } from "../src/lib/uptime";
import type { ConfigStore } from "./config-store";
import type { UptimeProbe, UptimeProbeResult } from "./uptime-probe";
import {
  emptyUptimeState,
  projectProfile,
  recordProbe,
  uptimeStateDocumentSchema,
  type UptimeStateDocument,
} from "./uptime-state";
import type { UptimeStateStore } from "./uptime-store";

const PROBE_INTERVAL_MS = 60_000;
const MAX_CONCURRENT_PROBES = 8;

type ProfileConfig = { profileId: ProfileId; config: Config };
type TimerHandle = { cancel: () => void };

export type UptimeReader = {
  getSnapshot: (profileId: ProfileId) => UptimeResponse;
};

export type UptimeMonitor = UptimeReader & {
  initialize: () => Promise<void>;
  runOnce: () => Promise<void>;
  start: () => void;
  stop: () => void;
};

export type UptimeMonitorOptions = {
  configStore: Pick<ConfigStore, "readAllProfileConfigs">;
  stateStore: UptimeStateStore;
  probe: UptimeProbe;
  now?: () => number;
  setIntervalFn?: (callback: () => void, intervalMs: number) => TimerHandle;
  clearIntervalFn?: (handle: TimerHandle) => void;
};

type ProbeTask = {
  profileId: ProfileId;
  target: UptimeTarget;
};

type CompletedProbe = {
  result: UptimeProbeResult;
  checkedAt: number;
};

function cloneState(document: UptimeStateDocument): UptimeStateDocument {
  return structuredClone(document);
}

export function createUptimeMonitor(options: UptimeMonitorOptions): UptimeMonitor {
  const now = options.now ?? Date.now;
  const setIntervalFn = options.setIntervalFn ?? ((callback, intervalMs) => {
    const handle = setInterval(callback, intervalMs);
    return { cancel: () => clearInterval(handle) };
  });
  const clearIntervalFn = options.clearIntervalFn ?? ((handle) => handle.cancel());
  let state = cloneState(emptyUptimeState);
  let storageOk = true;
  let configuredTargets = new Map<ProfileId, UptimeTarget[]>();
  let initializePromise: Promise<void> | undefined;
  let running: Promise<void> | undefined;
  let timer: TimerHandle | undefined;

  function initialize(): Promise<void> {
    initializePromise ??= options.stateStore.load().then(
      (loaded) => { state = uptimeStateDocumentSchema.parse(loaded); },
      () => {
        state = cloneState(emptyUptimeState);
        storageOk = false;
      },
    );
    return initializePromise;
  }

  async function runTargets(profiles: ProfileConfig[], previous: UptimeStateDocument): Promise<UptimeStateDocument> {
    const tasks: ProbeTask[] = profiles.flatMap(({ profileId, config }) => config.uptime.enabled
      ? config.uptime.targets.map((target) => ({ profileId, target }))
      : []);
    const completed: Array<CompletedProbe | undefined> = Array.from({ length: tasks.length });
    let nextIndex = 0;

    async function worker(): Promise<void> {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        const task = tasks[index];
        if (task === undefined) return;
        let result: UptimeProbeResult;
        try {
          result = await options.probe(task.target);
        } catch {
          result = { ok: false, error: { code: "network" } };
        }
        completed[index] = { result, checkedAt: now() };
      }
    }

    const workerCount = Math.min(MAX_CONCURRENT_PROBES, tasks.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const previousProfiles = new Map(previous.profiles.map((profile) => [profile.id, profile]));
    const taskIndex = new Map(tasks.map((task, index) => [`${task.profileId}:${task.target.id}`, index]));
    const roundCompletedAt = new Date(now()).toISOString();
    return uptimeStateDocumentSchema.parse({
      version: 1,
      profiles: profiles.map(({ profileId, config }) => {
        const oldProfile = previousProfiles.get(profileId);
        const oldTargets = new Map(oldProfile?.targets.map((target) => [target.id, target]));
        const targets = config.uptime.targets.flatMap((target) => {
          if (!config.uptime.enabled) {
            const oldTarget = oldTargets.get(target.id);
            return oldTarget === undefined ? [] : [oldTarget];
          }
          const index = taskIndex.get(`${profileId}:${target.id}`);
          const probe = index === undefined ? undefined : completed[index];
          if (probe === undefined) return [];
          return [recordProbe(oldTargets.get(target.id), target, probe.result, probe.checkedAt)];
        });
        return {
          id: profileId,
          updatedAt: config.uptime.enabled ? roundCompletedAt : oldProfile?.updatedAt ?? null,
          targets,
        };
      }),
    });
  }

  async function executeRound(): Promise<void> {
    try {
      const profiles = await options.configStore.readAllProfileConfigs();
      const next = await runTargets(profiles, state);
      state = next;
      configuredTargets = new Map(profiles.map(({ profileId, config }) => [
        profileId,
        structuredClone(config.uptime.targets),
      ]));
      try {
        await options.stateStore.save(next);
        storageOk = true;
      } catch {
        storageOk = false;
      }
    } catch {
      // Die letzte vollständige Runde bleibt sichtbar und altert natürlich zu unknown.
    }
  }

  function runOnce(): Promise<void> {
    if (running !== undefined) return running;
    running = executeRound().finally(() => { running = undefined; });
    return running;
  }

  function start(): void {
    if (timer !== undefined) return;
    void runOnce();
    timer = setIntervalFn(() => { void runOnce(); }, PROBE_INTERVAL_MS);
  }

  function stop(): void {
    if (timer === undefined) return;
    clearIntervalFn(timer);
    timer = undefined;
  }

  function getSnapshot(profileId: ProfileId): UptimeResponse {
    const targetIds = (configuredTargets.get(profileId) ?? []).map(({ id }) => id);
    return uptimeResponseSchema.parse(projectProfile(profileId, targetIds, state, storageOk, now()));
  }

  return { initialize, runOnce, start, stop, getSnapshot };
}
