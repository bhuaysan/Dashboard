import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeHttp, probeTcp } from "./uptime-probe";

const HTTP_ID = "123e4567-e89b-42d3-a456-426614174010";
const TCP_ID = "123e4567-e89b-42d3-a456-426614174011";

const httpTarget = {
  id: HTTP_ID,
  type: "http" as const,
  label: "Web",
  url: "https://example.com/health",
};

class TestSocket extends EventEmitter {
  destroyed = false;
  timeoutMs: number | undefined;

  setTimeout(timeoutMs: number): this {
    this.timeoutMs = timeoutMs;
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

describe("probeHttp", () => {
  it.each([200, 304, 399])("akzeptiert HTTP %i ohne Location", async (status) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status }));
    await expect(probeHttp(httpTarget, { fetchImpl, now: () => 10 })).resolves.toEqual({
      ok: true,
      responseTimeMs: 0,
    });
  });

  it("misst die Zeit bis zu den Antwort-Headern", async () => {
    const times = [100, 137];
    await expect(probeHttp(httpTarget, {
      fetchImpl: async () => new Response(null, { status: 200 }),
      now: () => times.shift() ?? 137,
    })).resolves.toEqual({ ok: true, responseTimeMs: 37 });
  });

  it("bricht den Antwort-Body ab, ohne ihn zu lesen", async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel: () => { cancelled = true; } });
    await probeHttp(httpTarget, {
      fetchImpl: async () => new Response(body, { status: 200 }),
      now: () => 0,
    });
    expect(cancelled).toBe(true);
  });

  it("liefert gebundene HTTP-Fehler", async () => {
    await expect(probeHttp(httpTarget, {
      fetchImpl: async () => new Response(null, { status: 400 }),
      now: () => 0,
    })).resolves.toEqual({ ok: false, error: { code: "http", httpStatus: 400 } });
  });

  it.each([
    [new Response(null, { status: 302 }), "redirect"],
    [new Response(null, { status: 302, headers: { location: "ftp://example.com/file" } }), "redirect"],
    [new Response(null, { status: 302, headers: { location: "https://user:pass@example.com/" } }), "redirect"],
  ])("weist unsichere Weiterleitung ab", async (response, code) => {
    const fetchImpl = vi.fn(async () => response);
    await expect(probeHttp(httpTarget, { fetchImpl, now: () => 0 })).resolves.toMatchObject({
      ok: false,
      error: { code },
    });
  });

  it("folgt höchstens fünf Weiterleitungen mit demselben Deadline-Signal", async () => {
    const statuses = [301, 302, 303, 307, 308, 301];
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.signal instanceof AbortSignal) signals.push(init.signal);
      const status = statuses.shift() ?? 200;
      return new Response(null, { status, headers: { location: "/next" } });
    });

    await expect(probeHttp(httpTarget, { fetchImpl, now: () => 0 })).resolves.toEqual({
      ok: false,
      error: { code: "redirect" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(new Set(signals).size).toBe(1);
  });

  it("erlaubt private Ziele in Weiterleitungen des konfigurierten Monitors", async () => {
    const responses = [
      new Response(null, { status: 302, headers: { location: "http://10.0.10.20/health" } }),
      new Response(null, { status: 204 }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift() ?? new Response(null, { status: 500 }));
    await expect(probeHttp(httpTarget, { fetchImpl, now: () => 0 })).resolves.toEqual({
      ok: true,
      responseTimeMs: 0,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    [Object.assign(new Error("dns"), { code: "ENOTFOUND" }), "dns"],
    [Object.assign(new Error("refused"), { code: "ECONNREFUSED" }), "refused"],
    [Object.assign(new Error("certificate"), { code: "CERT_HAS_EXPIRED" }), "tls"],
    [new DOMException("aborted", "AbortError"), "timeout"],
    [new Error("raw internal detail"), "network"],
  ])("begrenzt Netzwerkfehler auf %s", async (error, code) => {
    await expect(probeHttp(httpTarget, {
      fetchImpl: async () => { throw error; },
      now: () => 0,
    })).resolves.toEqual({ ok: false, error: { code } });
  });
});

describe("probeTcp", () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it("verbindet sich mit einem lokalen TCP-Dienst und schließt sofort", async () => {
    let notePeerClosed: (() => void) | undefined;
    const peerClosed = new Promise<void>((resolve) => { notePeerClosed = resolve; });
    const server = createServer((socket) => socket.once("close", () => notePeerClosed?.()));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("TCP-Testserver hat keine IP-Adresse");

    await expect(probeTcp({
      id: TCP_ID,
      type: "tcp",
      label: "Lokal",
      host: "127.0.0.1",
      port: address.port,
    })).resolves.toMatchObject({ ok: true });
    await peerClosed;
  });

  it("beendet einen hängenden Socket nach dem Timeout", async () => {
    const socket = new TestSocket();
    const resultPromise = probeTcp(
      { id: TCP_ID, type: "tcp", label: "Minecraft", host: "mc.example", port: 25567 },
      { connect: () => socket, now: () => 0, timeoutMs: 5_000 },
    );
    expect(socket.timeoutMs).toBe(5_000);
    socket.emit("timeout");
    await expect(resultPromise).resolves.toEqual({ ok: false, error: { code: "timeout" } });
    expect(socket.destroyed).toBe(true);
  });

  it.each([
    ["ECONNREFUSED", "refused"],
    ["ENOTFOUND", "dns"],
  ])("begrenzt den TCP-Fehler %s", async (systemCode, code) => {
    const socket = new TestSocket();
    const resultPromise = probeTcp(
      { id: TCP_ID, type: "tcp", label: "Minecraft", host: "mc.example", port: 25567 },
      { connect: () => socket, now: () => 0, timeoutMs: 5_000 },
    );
    socket.emit("error", Object.assign(new Error(systemCode), { code: systemCode }));
    await expect(resultPromise).resolves.toEqual({ ok: false, error: { code } });
    expect(socket.destroyed).toBe(true);
  });
});
