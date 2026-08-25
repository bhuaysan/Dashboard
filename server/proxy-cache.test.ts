// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock("undici", () => ({
  Agent: class {
    async close(): Promise<void> {}
  },
  fetch: fetchMock,
}));

import {
  clearProxyCache,
  MAX_CACHE_BYTES,
  MAX_PROXY_IN_FLIGHT,
  MAX_PROXY_QUEUE,
  PROXY_DEADLINE_MS,
  ProxyOverloadedError,
  ProxyTimeoutError,
  proxyCacheSize,
  proxyFetch,
} from "./proxy.ts";

const HOST = "93.184.216.34";
const REDIRECT_HOST = "93.184.216.35";
const ALLOW = [HOST];
const resolveAddress = async (): Promise<{ address: string }> => ({ address: HOST });
const payload = new Uint8Array(2 * 1024 * 1024);

beforeEach(() => {
  clearProxyCache();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(payload, {
    status: 200,
    headers: { "content-length": String(payload.byteLength) },
  }));
});

describe("Proxy-Cache", () => {
  it("teilt 20 gleiche parallele Cache-Misses in einem Upstream-Fetch", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementation(async () => {
      await gate;
      return new Response("ok", { status: 200 });
    });

    const requests = Array.from({ length: 20 }, () => proxyFetch(`http://${HOST}/gleich`, ALLOW, resolveAddress));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release();
    await Promise.all(requests);
  });

  it("begrenzt unterschiedliche parallele URLs auf acht aktive Upstream-Operationen", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let maximum = 0;
    fetchMock.mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await gate;
      active -= 1;
      return new Response("ok", { status: 200 });
    });

    const requests = Array.from({ length: MAX_PROXY_IN_FLIGHT + 4 }, (_, index) =>
      proxyFetch(`http://${HOST}/parallel-${index}`, ALLOW, resolveAddress));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(MAX_PROXY_IN_FLIGHT);
    expect(maximum).toBe(MAX_PROXY_IN_FLIGHT);
    release();
    await Promise.all(requests);
    expect(maximum).toBe(MAX_PROXY_IN_FLIGHT);
  });

  it("weist eine überfüllte Proxy-Warteschlange definiert zurück", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementation(async () => {
      await gate;
      return new Response("ok", { status: 200 });
    });

    const waiting = Array.from({ length: MAX_PROXY_IN_FLIGHT + MAX_PROXY_QUEUE }, (_, index) =>
      proxyFetch(`http://${HOST}/queue-${index}`, ALLOW, resolveAddress));
    const overloaded = proxyFetch(`http://${HOST}/queue-overload`, ALLOW, resolveAddress);
    const overloadedAssertion = expect(overloaded).rejects.toBeInstanceOf(ProxyOverloadedError);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await overloadedAssertion;
    release();
    await Promise.all(waiting);
  });

  it("beendet ein hängendes DNS innerhalb der Gesamtablaufzeit", async () => {
    vi.useFakeTimers();
    try {
      const pending = proxyFetch(
        `http://${HOST}/dns-timeout`,
        ALLOW,
        async () => new Promise<never>(() => undefined),
      );
      const pendingAssertion = expect(pending).rejects.toBeInstanceOf(ProxyTimeoutError);
      await vi.advanceTimersByTimeAsync(PROXY_DEADLINE_MS + 1);
      await pendingAssertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("normalisiert URL-Fragmente und verwendet ein Gesamt-Bytebudget", async () => {
    await proxyFetch(`http://${HOST}/feed#eins`, ALLOW, resolveAddress);
    await proxyFetch(`http://${HOST}/feed#zwei`, ALLOW, resolveAddress);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 9; i += 1) {
      await proxyFetch(`http://${HOST}/feed?seite=${i}`, ALLOW, resolveAddress);
    }
    const size = proxyCacheSize();
    expect(size.bytes).toBeLessThanOrEqual(MAX_CACHE_BYTES);
    expect(size.entries).toBeLessThanOrEqual(8);
  });

  it("weist eine deklarierte Antwort über dem Einzel-Limit vor dem Lesen ab", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
      cancel() { cancelled = true; },
    });
    fetchMock.mockImplementationOnce(async () => new Response(body, {
      status: 200,
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
    }));
    await expect(proxyFetch(`http://${HOST}/zu-groß`, ALLOW, resolveAddress)).rejects.toThrow("Antwort zu groß");
    expect(cancelled).toBe(true);
  });

  it("weist mehr als drei Weiterleitungen als Fehler zurück", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const next = Number(new URL(input).pathname.slice("/redirect-".length));
      return new Response(null, {
        status: 302,
        headers: { location: `http://${HOST}/redirect-${next + 1}` },
      });
    });
    await expect(proxyFetch(`http://${HOST}/redirect-0`, ALLOW, resolveAddress)).rejects.toThrow("Zu viele Weiterleitungen");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("prüft jedes Redirect-Ziel erneut gegen die Allowlist", async () => {
    fetchMock.mockImplementation(async () => new Response(null, {
      status: 302,
      headers: { location: "http://nicht-erlaubt.example/ziel" },
    }));
    await expect(proxyFetch(`http://${HOST}/redirect-fremd`, ALLOW, resolveAddress)).rejects.toThrow("Host nicht erlaubt");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("verwendet einen Redirect-Cache nicht unter einer geänderten Allowlist", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = new URL(input);
      return url.hostname === HOST
        ? new Response(null, { status: 302, headers: { location: `http://${REDIRECT_HOST}/ziel` } })
        : new Response("redirect-inhalt", { status: 200 });
    });
    const allowRedirect = [HOST, REDIRECT_HOST];
    await expect(proxyFetch(`http://${HOST}/policy`, allowRedirect, resolveAddress)).resolves.toBeDefined();
    await expect(proxyFetch(`http://${HOST}/policy`, [HOST], resolveAddress)).rejects.toThrow("Host nicht erlaubt");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("bricht einen zu großen gestreamten Body ab und cancelt ihn", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
      cancel() { cancelled = true; },
    });
    fetchMock.mockImplementationOnce(async () => new Response(body, { status: 200 }));
    await expect(proxyFetch(`http://${HOST}/stream-zu-groß`, ALLOW, resolveAddress)).rejects.toThrow("Antwort zu groß");
    expect(cancelled).toBe(true);
  });
});
