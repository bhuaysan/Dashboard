import { describe, expect, it } from "vitest";
import type { UptimeTarget } from "../src/config/schema";
import {
  emptyUptimeState,
  projectProfile,
  projectTarget,
  recordProbe,
  targetFingerprint,
  uptimeStateDocumentSchema,
  type StoredTargetState,
} from "./uptime-state";

const HTTP_ID = "123e4567-e89b-42d3-a456-426614174010";
const TCP_ID = "123e4567-e89b-42d3-a456-426614174011";
const NOW = Date.parse("2026-09-22T10:03:00Z");

const target: UptimeTarget = {
  id: HTTP_ID,
  type: "http",
  label: "Immich",
  url: "https://photos.example/health",
};

function stored(change: Partial<StoredTargetState> = {}): StoredTargetState {
  return {
    id: HTTP_ID,
    fingerprint: targetFingerprint(target),
    sampleMinute: Math.floor(NOW / 60_000),
    samples: "1010",
    status: "down",
    statusSince: "2026-09-22T10:02:00.000Z",
    checkedAt: "2026-09-22T10:03:00.000Z",
    responseTimeMs: null,
    consecutiveFailures: 2,
    error: { code: "timeout" },
    ...change,
  };
}

describe("recordProbe", () => {
  it("durchläuft up, degraded, down und nach Erfolg wieder up", () => {
    const first = recordProbe(undefined, target, { ok: true, responseTimeMs: 31 }, Date.parse("2026-09-22T10:00:00Z"));
    const warning = recordProbe(first, target, { ok: false, error: { code: "timeout" } }, Date.parse("2026-09-22T10:01:00Z"));
    const down = recordProbe(warning, target, { ok: false, error: { code: "timeout" } }, Date.parse("2026-09-22T10:02:00Z"));
    const recovered = recordProbe(down, target, { ok: true, responseTimeMs: 27 }, Date.parse("2026-09-22T10:03:00Z"));

    expect([first.status, warning.status, down.status, recovered.status])
      .toEqual(["up", "degraded", "down", "up"]);
    expect([first.samples, warning.samples, down.samples, recovered.samples])
      .toEqual(["1", "10", "100", "1001"]);
    expect(warning.responseTimeMs).toBeNull();
    expect(recovered.consecutiveFailures).toBe(0);
    expect(recovered.error).toBeNull();
  });

  it("stuft bereits den ersten Fehler als gestört und den zweiten als ausgefallen ein", () => {
    const first = recordProbe(undefined, target, { ok: false, error: { code: "dns" } }, NOW);
    const second = recordProbe(first, target, { ok: false, error: { code: "dns" } }, NOW + 60_000);
    expect(first).toMatchObject({ status: "degraded", consecutiveFailures: 1 });
    expect(second).toMatchObject({ status: "down", consecutiveFailures: 2 });
  });

  it("ersetzt ein Ergebnis derselben Minute statt einen Slot anzuhängen", () => {
    const first = recordProbe(undefined, target, { ok: true, responseTimeMs: 10 }, NOW);
    const replaced = recordProbe(first, target, { ok: false, error: { code: "timeout" } }, NOW + 20_000);
    expect(replaced.samples).toBe("0");
    expect(replaced.sampleMinute).toBe(first.sampleMinute);
  });

  it("fügt für drei Minuten Abstand zwei unbekannte Slots ein", () => {
    const first = recordProbe(undefined, target, { ok: true, responseTimeMs: 10 }, NOW);
    const later = recordProbe(first, target, { ok: false, error: { code: "timeout" } }, NOW + 180_000);
    expect(later.samples).toBe("1??0");
  });

  it("begrenzt eine beliebig große Zeitlücke auf 1440 Slots", () => {
    const first = recordProbe(undefined, target, { ok: true, responseTimeMs: 10 }, NOW);
    const later = recordProbe(first, target, { ok: false, error: { code: "timeout" } }, NOW + 10_000 * 60_000);
    expect(later.samples).toHaveLength(1440);
    expect(later.samples).toBe(`${"?".repeat(1439)}0`);
  });

  it("setzt eine aus der Zukunft geladene Ringposition zurück", () => {
    const future = stored({ sampleMinute: Math.floor(NOW / 60_000) + 1, samples: "111" });
    const current = recordProbe(future, target, { ok: false, error: { code: "network" } }, NOW);
    expect(current).toMatchObject({
      sampleMinute: Math.floor(NOW / 60_000),
      samples: "0",
      status: "degraded",
      consecutiveFailures: 1,
    });
  });

  it("behält beim Anhängen nur die jüngsten 1440 Slots", () => {
    const full = stored({ sampleMinute: Math.floor(NOW / 60_000), samples: "1".repeat(1440), status: "up", consecutiveFailures: 0, error: null, responseTimeMs: 10 });
    const next = recordProbe(full, target, { ok: false, error: { code: "timeout" } }, NOW + 60_000);
    expect(next.samples).toHaveLength(1440);
    expect(next.samples).toBe(`${"1".repeat(1439)}0`);
  });
});

describe("projectTarget", () => {
  it("berechnet Quote, Messminuten und links aufgefüllte Stunden exakt", () => {
    expect(projectTarget(HTTP_ID, stored(), NOW)).toMatchObject({
      uptime24h: 50,
      measuredMinutes: 4,
      history: [...Array.from({ length: 23 }, () => "unknown"), "mixed"],
    });
  });

  it.each([
    ["1".repeat(60), "ok"],
    ["0".repeat(60), "down"],
    [`${"1".repeat(30)}${"0".repeat(30)}`, "mixed"],
    ["?".repeat(60), "unknown"],
  ])("projiziert einen Stundenblock als %s", (samples, expected) => {
    const projected = projectTarget(HTTP_ID, stored({ samples }), NOW);
    expect(projected.history.at(-1)).toBe(expected);
  });

  it("schließt unbekannte Slots aus der Verfügbarkeitsquote aus", () => {
    expect(projectTarget(HTTP_ID, stored({ samples: "1?0?1" }), NOW)).toMatchObject({
      measuredMinutes: 3,
      uptime24h: 66.67,
    });
    expect(projectTarget(HTTP_ID, stored({ samples: "?" }), NOW).uptime24h).toBeNull();
  });

  it("leitet nach mehr als 150 Sekunden unbekannt seit der Altersgrenze ab", () => {
    const checkedAt = "2026-09-22T10:00:00.000Z";
    const result = projectTarget(HTTP_ID, stored({ checkedAt, status: "up", statusSince: checkedAt, responseTimeMs: 12, error: null }), Date.parse("2026-09-22T10:02:31Z"));
    expect(result).toMatchObject({
      status: "unknown",
      statusSince: "2026-09-22T10:02:30.000Z",
      responseTimeMs: 12,
    });
  });

  it("liefert für ein noch nie gemessenes Ziel einen vollständigen unbekannten Zustand", () => {
    expect(projectTarget(TCP_ID, undefined, NOW)).toEqual({
      id: TCP_ID,
      status: "unknown",
      statusSince: null,
      checkedAt: null,
      responseTimeMs: null,
      uptime24h: null,
      measuredMinutes: 0,
      history: Array.from({ length: 24 }, () => "unknown"),
      error: null,
    });
  });
});

describe("targetFingerprint", () => {
  it("behält den Fingerprint bei reiner Umbenennung", () => {
    expect(targetFingerprint({ ...target, label: "Fotos" })).toBe(targetFingerprint(target));
  });

  it("unterscheidet URL, Host, Port und Zieltyp", () => {
    const tcp: UptimeTarget = { id: HTTP_ID, type: "tcp", label: "TCP", host: "example.com", port: 443 };
    expect(targetFingerprint({ ...target, url: "https://photos.example/ready" })).not.toBe(targetFingerprint(target));
    expect(targetFingerprint({ ...tcp, host: "other.example" })).not.toBe(targetFingerprint(tcp));
    expect(targetFingerprint({ ...tcp, port: 8443 })).not.toBe(targetFingerprint(tcp));
    expect(targetFingerprint(tcp)).not.toBe(targetFingerprint({ ...target, url: "https://example.com:443" }));
  });

  it("normalisiert Host-Schreibweise und HTTP-URLs", () => {
    const upperTcp: UptimeTarget = { id: TCP_ID, type: "tcp", label: "TCP", host: "MC.Example", port: 25565 };
    expect(targetFingerprint(upperTcp)).toBe(targetFingerprint({ ...upperTcp, host: "mc.example" }));
    expect(targetFingerprint({ ...target, url: "https://PHOTOS.EXAMPLE:443/a/../health" }))
      .toBe(targetFingerprint(target));
  });
});

describe("uptime state document", () => {
  it("validiert den leeren Startzustand", () => {
    expect(uptimeStateDocumentSchema.parse(emptyUptimeState)).toEqual({ version: 1, profiles: [] });
  });

  it("projiziert ein Profil in gespeicherter Zielreihenfolge", () => {
    const state = {
      version: 1 as const,
      profiles: [{ id: "default", updatedAt: "2026-09-22T10:03:00.000Z", targets: [stored()] }],
    };
    const projected = projectProfile("default", [TCP_ID, HTTP_ID], state, false, NOW);
    expect(projected.updatedAt).toBe("2026-09-22T10:03:00.000Z");
    expect(projected.storageOk).toBe(false);
    expect(projected.targets.map(({ id }) => id)).toEqual([TCP_ID, HTTP_ID]);
    expect(projected.targets[0]?.status).toBe("unknown");
  });
});
