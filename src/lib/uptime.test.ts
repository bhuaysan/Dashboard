import { describe, expect, it } from "vitest";
import { uptimeResponseSchema } from "./uptime";

const HTTP_ID = "123e4567-e89b-42d3-a456-426614174010";

function validResponse() {
  return {
    updatedAt: "2026-09-22T12:00:00.000Z",
    storageOk: true,
    targets: [{
      id: HTTP_ID,
      status: "up",
      statusSince: "2026-09-22T11:00:00.000Z",
      checkedAt: "2026-09-22T12:00:00.000Z",
      responseTimeMs: 23,
      uptime24h: 99.93,
      measuredMinutes: 1440,
      history: Array.from({ length: 24 }, () => "ok"),
      error: null,
    }],
  };
}

describe("uptimeResponseSchema", () => {
  it("akzeptiert eine vollständige Uptime-Antwort", () => {
    expect(uptimeResponseSchema.safeParse(validResponse()).success).toBe(true);
  });

  it.each([23, 25])("weist eine Historie mit %i Stunden ab", (length) => {
    const response = validResponse();
    response.targets[0]!.history = Array.from({ length }, () => "ok");
    expect(uptimeResponseSchema.safeParse(response).success).toBe(false);
  });

  it.each([-0.01, 100.01, Number.POSITIVE_INFINITY])("weist die ungültige Verfügbarkeit %s ab", (uptime24h) => {
    const response = validResponse();
    response.targets[0]!.uptime24h = uptime24h;
    expect(uptimeResponseSchema.safeParse(response).success).toBe(false);
  });

  it.each([
    ["negative Antwortzeit", { responseTimeMs: -1 }],
    ["gebrochene Antwortzeit", { responseTimeMs: 1.5 }],
    ["negative Messminuten", { measuredMinutes: -1 }],
    ["zu viele Messminuten", { measuredMinutes: 1441 }],
    ["gebrochene Messminuten", { measuredMinutes: 1.5 }],
  ])("weist %s ab", (_reason, change) => {
    const response = validResponse();
    Object.assign(response.targets[0]!, change);
    expect(uptimeResponseSchema.safeParse(response).success).toBe(false);
  });

  it.each([
    ["updatedAt", "gestern"],
    ["statusSince", "2026-09-22"],
    ["checkedAt", "12 Uhr"],
  ])("weist einen ungültigen Zeitstempel in %s ab", (field, value) => {
    const response = validResponse();
    if (field === "updatedAt") response.updatedAt = value;
    else Object.assign(response.targets[0]!, { [field]: value });
    expect(uptimeResponseSchema.safeParse(response).success).toBe(false);
  });

  it("verlangt bei erreichbaren Zielen eine Antwortzeit ohne Fehler", () => {
    const response = validResponse();
    Object.assign(response.targets[0]!, {
      responseTimeMs: null,
      error: { code: "network" },
    });
    expect(uptimeResponseSchema.safeParse(response).success).toBe(false);
  });

  it.each(["degraded", "down"])("verlangt bei %s einen Fehler ohne Antwortzeit", (status) => {
    const response = validResponse();
    Object.assign(response.targets[0]!, { status, responseTimeMs: 23, error: null });
    expect(uptimeResponseSchema.safeParse(response).success).toBe(false);
  });

  it("akzeptiert einen gebundenen HTTP-Fehler", () => {
    const response = validResponse();
    Object.assign(response.targets[0]!, {
      status: "degraded",
      responseTimeMs: null,
      error: { code: "http", httpStatus: 503 },
    });
    expect(uptimeResponseSchema.safeParse(response).success).toBe(true);
  });
});
