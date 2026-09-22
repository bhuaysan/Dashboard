import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ProfileId, UptimeTarget } from "../config/schema";
import type { UptimeError, UptimeResponse, UptimeStatus } from "../lib/uptime";
import { decodeUptime, fetchUptime, Uptime } from "./Uptime";

const PROFILE_ID: ProfileId = "123e4567-e89b-42d3-a456-426614174000";
const HTTP_ID = "123e4567-e89b-42d3-a456-426614174010";
const TCP_ID = "123e4567-e89b-42d3-a456-426614174011";
const NOW = new Date("2026-09-22T13:00:00.000Z");
const STATUS_CASES: Array<[UptimeStatus, string]> = [
  ["up", "erreichbar"],
  ["degraded", "gestört"],
  ["down", "nicht erreichbar"],
  ["unknown", "unbekannt"],
];
const ERROR_CASES: Array<[UptimeError["code"], number | undefined, string]> = [
  ["timeout", undefined, "Zeitüberschreitung"],
  ["dns", undefined, "DNS-Fehler"],
  ["refused", undefined, "Verbindung abgelehnt"],
  ["tls", undefined, "TLS-Fehler"],
  ["redirect", undefined, "Weiterleitungsfehler"],
  ["http", 503, "HTTP 503"],
  ["network", undefined, "Netzwerkfehler"],
];

const httpTarget: UptimeTarget = {
  id: HTTP_ID,
  type: "http",
  label: "Immich",
  url: "https://photos.example/health",
};
const tcpTarget: UptimeTarget = {
  id: TCP_ID,
  type: "tcp",
  label: "Minecraft",
  host: "mc.example",
  port: 25567,
};

function result(id: string, change: Partial<UptimeResponse["targets"][number]> = {}): UptimeResponse["targets"][number] {
  return {
    id,
    status: "up",
    statusSince: "2026-09-22T10:00:00.000Z",
    checkedAt: "2026-09-22T12:59:00.000Z",
    responseTimeMs: 31,
    uptime24h: 99.93,
    measuredMinutes: 1440,
    history: Array.from({ length: 24 }, () => "ok"),
    error: null,
    ...change,
  };
}

function response(change: Partial<UptimeResponse> = {}): UptimeResponse {
  return {
    updatedAt: "2026-09-22T12:59:00.000Z",
    storageOk: true,
    targets: [result(HTTP_ID)],
    ...change,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Uptime API contract", () => {
  it("decodiert eine vollständige Antwort ohne Date-Revival", () => {
    const decoded = decodeUptime(response());
    expect(decoded).toEqual(response());
    expect(typeof decoded?.updatedAt).toBe("string");
    expect(typeof decoded?.targets[0]?.checkedAt).toBe("string");
  });

  it.each([23, 25])("verwirft eine Historie mit %i Einträgen", (length) => {
    expect(decodeUptime(response({
      targets: [result(HTTP_ID, { history: Array.from({ length }, () => "ok") })],
    }))).toBeUndefined();
  });

  it("ruft den profilabhängigen Endpunkt mit AbortSignal auf", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await expect(fetchUptime(PROFILE_ID, controller.signal)).resolves.toEqual(response());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/uptime?profile=${encodeURIComponent(PROFILE_ID)}`,
      { signal: controller.signal },
    );
  });

  it("weist Nicht-2xx-Antworten und ungültiges JSON fachlich ab", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(fetchUptime(PROFILE_ID)).rejects.toThrow("Uptime nicht ladbar (503)");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ targets: [] }), { status: 200 })));
    await expect(fetchUptime(PROFILE_ID)).rejects.toThrow("Uptimeantwort ungültig");
  });
});

describe("Uptime", () => {
  it("rendert Config-Reihenfolge, Messwerte, Verlauf und sichere Zeilentypen", () => {
    render(<Uptime
      targets={[httpTarget, tcpTarget]}
      data={response({ targets: [result(TCP_ID), result(HTTP_ID)] })}
      selIndex={0}
      now={NOW}
    />);

    const httpRow = screen.getByText("Immich").closest("[data-row]");
    const tcpRow = screen.getByText("Minecraft").closest("[data-row]");
    if (httpRow === null || tcpRow === null) throw new Error("Uptime-Zeile fehlt");
    expect(httpRow.compareDocumentPosition(tcpRow) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(httpRow?.tagName).toBe("A");
    expect(httpRow?.getAttribute("href")).toBe("https://photos.example/health");
    expect(httpRow?.className).toContain("is-sel");
    expect(tcpRow?.tagName).toBe("DIV");
    expect(tcpRow?.hasAttribute("href")).toBe(false);
    expect(screen.getByText("https://photos.example/health")).toBeTruthy();
    expect(screen.getByText("mc.example:25567")).toBeTruthy();
    expect(screen.getAllByText("31 ms")).toHaveLength(2);
    expect(screen.getAllByText("99,93 %")).toHaveLength(2);
    expect(screen.getAllByText("seit 3h")).toHaveLength(2);
    expect(httpRow?.querySelectorAll(".uptime-history [aria-hidden='true']")).toHaveLength(24);
    expect(httpRow?.querySelector(".uptime-history")?.getAttribute("aria-label")).toContain("24-Stunden-Verlauf");
  });

  it.each(STATUS_CASES)("benennt den Zustand %s auf Deutsch", (status, label) => {
    const failed = status === "degraded" || status === "down";
    render(<Uptime
      targets={[httpTarget]}
      data={response({ targets: [result(HTTP_ID, {
        status,
        responseTimeMs: failed ? null : 31,
        error: failed ? { code: "network" } : null,
      })] })}
      selIndex={-1}
      now={NOW}
    />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it.each(ERROR_CASES)("erklärt den gebundenen Fehler %s", (code, httpStatus, label) => {
    render(<Uptime
      targets={[httpTarget]}
      data={response({ targets: [result(HTTP_ID, {
        status: "down",
        responseTimeMs: null,
        error: { code, ...(httpStatus === undefined ? {} : { httpStatus }) },
      })] })}
      selIndex={-1}
      now={NOW}
    />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it("zeigt leere, ausstehende, fehlende und nicht speicherbare Zustände", () => {
    const { rerender } = render(<Uptime targets={[]} data={response({ targets: [] })} selIndex={-1} now={NOW} />);
    expect(screen.getByText("keine Uptime-Ziele eingetragen")).toBeTruthy();

    rerender(<Uptime targets={[httpTarget]} selIndex={-1} now={NOW} />);
    expect(screen.getByText("noch keine Uptime-Daten")).toBeTruthy();

    rerender(<Uptime targets={[httpTarget]} data={response({ storageOk: false, targets: [] })} selIndex={-1} now={NOW} />);
    expect(screen.getByText("Uptime-Historie nicht speicherbar")).toBeTruthy();
    expect(screen.getByText("noch keine Messdaten")).toBeTruthy();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});
