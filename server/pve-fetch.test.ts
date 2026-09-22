// @vitest-environment node
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock("undici", () => ({
  Agent: class {
    async close(): Promise<void> {}
  },
  fetch: fetchMock,
}));

import { defaultConfig } from "../src/config/defaults";
import type { DashboardEnvironment } from "./env";
import { fetchHomelab, MAX_PVE_RESPONSE_BYTES } from "./pve";

const runtimeEnv: DashboardEnvironment = {
  port: 7777,
  configPath: "unused",
  uptimePath: "unused-uptime",
  staticPath: "unused",
  writeAllow: ["127.0.0.1"],
  writeHosts: ["localhost"],
  pve: {
    url: "https://pve.example:8006",
    tokenId: "dashboard@pve!test",
    secret: "synthetic-secret",
    caPath: fileURLToPath(new URL("../package.json", import.meta.url)),
  },
};

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function validResponse(input: string | URL): Response {
  const path = new URL(input).pathname;
  if (path.endsWith("/status")) {
    return envelope({
      cpu: 0.1,
      memory: { used: 1, total: 2 },
      rootfs: { used: 1, total: 2 },
      uptime: 1,
    });
  }
  return envelope([]);
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: string | URL) => validResponse(input));
});

describe("PVE-HTTP-Grenze", () => {
  it("cancelt den Body einer HTTP-Fehlerantwort", async () => {
    let cancelled = false;
    fetchMock.mockImplementation(async (input: string | URL) => {
      if (new URL(input).pathname.endsWith("/status")) {
        const body = new ReadableStream<Uint8Array>({ cancel: () => { cancelled = true; } });
        return new Response(body, { status: 503 });
      }
      return validResponse(input);
    });
    await expect(fetchHomelab(defaultConfig, runtimeEnv)).rejects.toThrow("HTTP 503");
    expect(cancelled).toBe(true);
  });

  it("weist einen deklarierten übergroßen Antwortkörper vor dem Lesen ab", async () => {
    let cancelled = false;
    fetchMock.mockImplementation(async (input: string | URL) => {
      if (new URL(input).pathname.endsWith("/status")) {
        const body = new ReadableStream<Uint8Array>({ cancel: () => { cancelled = true; } });
        return new Response(body, {
          status: 200,
          headers: { "content-length": String(MAX_PVE_RESPONSE_BYTES + 1) },
        });
      }
      return validResponse(input);
    });
    await expect(fetchHomelab(defaultConfig, runtimeEnv)).rejects.toThrow("Antwort zu groß");
    expect(cancelled).toBe(true);
  });
});
