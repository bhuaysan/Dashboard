// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock("undici", () => ({
  Agent: class {
    async close(): Promise<void> {}
  },
  fetch: fetchMock,
}));

import { clearProxyCache, MAX_CACHE_BYTES, proxyCacheSize, proxyFetch } from "./proxy.ts";

const HOST = "93.184.216.34";
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
    fetchMock.mockImplementationOnce(async () => new Response(null, {
      status: 200,
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
    }));
    await expect(proxyFetch(`http://${HOST}/zu-groß`, ALLOW, resolveAddress)).rejects.toThrow("Antwort zu groß");
  });
});
