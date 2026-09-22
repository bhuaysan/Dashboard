import { z } from "zod";
import { profileIdSchema, type ProfileId, type UptimeTarget } from "../src/config/schema";
import {
  uptimeErrorSchema,
  uptimeResponseSchema,
  type UptimeHistoryState,
  type UptimeResponse,
  type UptimeTargetResult,
} from "../src/lib/uptime";
import type { UptimeProbeResult } from "./uptime-probe";

const MINUTE_MS = 60_000;
const STALE_AFTER_MS = 150_000;
const HISTORY_MINUTES = 1_440;

export const storedTargetStateSchema = z.object({
  id: z.string().uuid(),
  fingerprint: z.string().min(1).max(4096),
  sampleMinute: z.number().int().nonnegative(),
  samples: z.string().regex(/^[01?]{1,1440}$/),
  status: z.enum(["up", "degraded", "down"]),
  statusSince: z.string().datetime({ offset: true }),
  checkedAt: z.string().datetime({ offset: true }),
  responseTimeMs: z.number().int().nonnegative().nullable(),
  consecutiveFailures: z.number().int().min(0),
  error: uptimeErrorSchema.nullable(),
}).strict();

const storedProfileStateSchema = z.object({
  id: profileIdSchema,
  updatedAt: z.string().datetime({ offset: true }).nullable(),
  targets: z.array(storedTargetStateSchema).max(32),
}).strict().superRefine((profile, ctx) => {
  const targetIds = new Set<string>();
  profile.targets.forEach((target, index) => {
    if (targetIds.has(target.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targets", index, "id"],
        message: "Uptime-Ziel-ID darf nur einmal vorkommen",
      });
    }
    targetIds.add(target.id);
  });
});

export const uptimeStateDocumentSchema = z.object({
  version: z.literal(1),
  profiles: z.array(storedProfileStateSchema).max(16),
}).strict().superRefine((document, ctx) => {
  const profileIds = new Set<string>();
  document.profiles.forEach((profile, index) => {
    if (profileIds.has(profile.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profiles", index, "id"],
        message: "Profil-ID darf nur einmal vorkommen",
      });
    }
    profileIds.add(profile.id);
  });
});

export type StoredTargetState = z.infer<typeof storedTargetStateSchema>;
export type UptimeStateDocument = z.infer<typeof uptimeStateDocumentSchema>;

export const emptyUptimeState: UptimeStateDocument = { version: 1, profiles: [] };

export function targetFingerprint(target: UptimeTarget): string {
  if (target.type === "http") {
    return JSON.stringify(["http", new URL(target.url).toString()]);
  }
  return JSON.stringify(["tcp", target.host.toLowerCase(), target.port]);
}

export function recordProbe(
  previous: StoredTargetState | undefined,
  target: UptimeTarget,
  result: UptimeProbeResult,
  nowMs: number,
): StoredTargetState {
  const fingerprint = targetFingerprint(target);
  const sampleMinute = Math.max(0, Math.floor(nowMs / MINUTE_MS));
  const checkedAt = new Date(nowMs).toISOString();
  const sample = result.ok ? "1" : "0";
  const usablePrevious = previous !== undefined &&
    previous.fingerprint === fingerprint &&
    previous.sampleMinute <= sampleMinute
    ? previous
    : undefined;

  let samples = sample;
  if (usablePrevious !== undefined) {
    const minuteGap = sampleMinute - usablePrevious.sampleMinute;
    if (minuteGap === 0) {
      samples = `${usablePrevious.samples.slice(0, -1)}${sample}`;
    } else {
      const missingMinutes = Math.min(minuteGap - 1, HISTORY_MINUTES - 1);
      samples = `${usablePrevious.samples}${"?".repeat(missingMinutes)}${sample}`.slice(-HISTORY_MINUTES);
    }
  }

  const consecutiveFailures = result.ok ? 0 : (usablePrevious?.consecutiveFailures ?? 0) + 1;
  const status = result.ok ? "up" : consecutiveFailures === 1 ? "degraded" : "down";
  const statusSince = usablePrevious?.status === status ? usablePrevious.statusSince : checkedAt;

  return {
    id: target.id,
    fingerprint,
    sampleMinute,
    samples,
    status,
    statusSince,
    checkedAt,
    responseTimeMs: result.ok ? result.responseTimeMs : null,
    consecutiveFailures,
    error: result.ok ? null : result.error,
  };
}

function projectHistory(samples: string): UptimeHistoryState[] {
  const padded = samples.slice(-HISTORY_MINUTES).padStart(HISTORY_MINUTES, "?");
  return Array.from({ length: 24 }, (_, index) => {
    const hour = padded.slice(index * 60, (index + 1) * 60);
    const hasSuccess = hour.includes("1");
    const hasFailure = hour.includes("0");
    if (hasSuccess && hasFailure) return "mixed";
    if (hasSuccess) return "ok";
    if (hasFailure) return "down";
    return "unknown";
  });
}

export function projectTarget(
  targetId: string,
  state: StoredTargetState | undefined,
  nowMs: number,
): UptimeTargetResult {
  if (state === undefined) {
    return {
      id: targetId,
      status: "unknown",
      statusSince: null,
      checkedAt: null,
      responseTimeMs: null,
      uptime24h: null,
      measuredMinutes: 0,
      history: Array.from({ length: 24 }, () => "unknown"),
      error: null,
    };
  }

  let successes = 0;
  let failures = 0;
  for (const sample of state.samples) {
    if (sample === "1") successes += 1;
    if (sample === "0") failures += 1;
  }
  const measuredMinutes = successes + failures;
  const rawUptime = measuredMinutes === 0 ? null : (successes / measuredMinutes) * 100;
  const uptime24h = rawUptime === null ? null : Math.round(rawUptime * 100) / 100;
  const checkedAtMs = Date.parse(state.checkedAt);
  const stale = nowMs - checkedAtMs > STALE_AFTER_MS;

  return {
    id: targetId,
    status: stale ? "unknown" : state.status,
    statusSince: stale ? new Date(checkedAtMs + STALE_AFTER_MS).toISOString() : state.statusSince,
    checkedAt: state.checkedAt,
    responseTimeMs: state.responseTimeMs,
    uptime24h,
    measuredMinutes,
    history: projectHistory(state.samples),
    error: state.error,
  };
}

export function projectProfile(
  profileId: ProfileId,
  targetIds: string[],
  document: UptimeStateDocument,
  storageOk: boolean,
  nowMs: number,
): UptimeResponse {
  const profile = document.profiles.find(({ id }) => id === profileId);
  const targetsById = new Map(profile?.targets.map((target) => [target.id, target]));
  return uptimeResponseSchema.parse({
    updatedAt: profile?.updatedAt ?? null,
    storageOk,
    targets: targetIds.map((id) => projectTarget(id, targetsById.get(id), nowMs)),
  });
}
