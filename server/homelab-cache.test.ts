// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/defaults";
import { emptyHomelab, type HomelabData } from "./pve";
import { createHomelabCache } from "./homelab-cache";

const config = { ...defaultConfig, updatedAt: "2026-08-08T12:00:00.000Z" };

describe("createHomelabCache", () => {
  it("teilt zehn parallele Anfragen mit derselben Revision", async () => {
    let resolveFetch: (data: HomelabData) => void = () => undefined;
    const pending = new Promise<HomelabData>((resolve) => { resolveFetch = resolve; });
    const fetcher = vi.fn(() => pending);
    const cache = createHomelabCache(fetcher);

    const requests = Array.from({ length: 10 }, () => cache.get(config));
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveFetch(emptyHomelab);
    await expect(Promise.all(requests)).resolves.toHaveLength(10);
    await expect(cache.get(config)).resolves.toBe(emptyHomelab);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("ignoriert einen Cache-Eintrag nach einer neuen Config-Revision", async () => {
    const fetcher = vi.fn(async () => emptyHomelab);
    const cache = createHomelabCache(fetcher);

    await cache.get(config);
    await cache.get({ ...config, updatedAt: "2026-08-08T12:00:00.001Z" });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("cached Fehler kurz negativ und versucht danach erneut", async () => {
    let now = 1_000;
    const fetcher = vi.fn(async () => { throw new Error("PVE ausgefallen"); });
    const cache = createHomelabCache(fetcher, {
      errorBackoffMs: 5_000,
      now: () => now,
    });

    await expect(cache.get(config)).rejects.toThrow("PVE ausgefallen");
    await expect(cache.get(config)).rejects.toThrow("Homelab nicht erreichbar");
    expect(fetcher).toHaveBeenCalledTimes(1);

    now += 5_000;
    await expect(cache.get(config)).rejects.toThrow("PVE ausgefallen");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
