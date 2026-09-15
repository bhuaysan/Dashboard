import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES, cleanupCache, useCachedQuery } from "./useCachedQuery";

type Item = { title: string; date: Date };

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe("useCachedQuery", () => {
  beforeEach(() => localStorage.clear());

  it("sperrt den Fetcher bei deaktivierter Query und startet ihn nach Aktivierung", async () => {
    const fetcher = vi.fn(async () => [{ title: "neu", date: new Date() }]);
    const { result, rerender } = renderHook(
      ({ enabled }) => useCachedQuery<Item[]>("toggle", fetcher, 60_000, {
        enabled,
        decode: () => undefined,
      }),
      { initialProps: { enabled: false }, wrapper },
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(fetcher).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("belebt Datumsfelder aus dem JSON-Cache wieder", async () => {
    localStorage.setItem(
      "dashboard:cache:test",
      JSON.stringify({ version: 1, t: Date.now() - 120_000, data: [{ title: "Meldung", date: "2026-08-05T12:00:00.000Z" }] }),
    );
    const { result } = renderHook(
      () => useCachedQuery<Item[]>(
        "test",
        async () => [{ title: "neu", date: new Date() }],
        60_000,
        { decode: (data) => {
          if (!Array.isArray(data)) return undefined;
          const first = data[0];
          if (typeof first !== "object" || first === null || !("title" in first) || !("date" in first)) return undefined;
          if (typeof first.title !== "string" || typeof first.date !== "string") return undefined;
          return data.map((item) => {
            if (typeof item !== "object" || item === null || !("title" in item) || !("date" in item) ||
                typeof item.title !== "string" || typeof item.date !== "string") return undefined;
            return { title: item.title, date: new Date(item.date) };
          }).filter((item): item is Item => item !== undefined);
        } },
      ),
      { wrapper },
    );
    const first = result.current.data?.[0];
    expect(first?.title).toBe("Meldung");
    expect(first?.date).toBeInstanceOf(Date);
    expect(() => first?.date.getFullYear()).not.toThrow();
    await waitFor(() => expect(result.current.data?.[0]?.title).toBe("neu"));
  });

  it.each([
    ["alte Version", { version: 0, t: Date.now(), data: [] }],
    ["fehlende Daten", { version: 1, t: Date.now(), data: {} }],
    ["ungültiger Zeitstempel", { version: 1, t: "gestern", data: [] }],
    ["negativer Zeitstempel", { version: 1, t: -1, data: [] }],
  ])("verwirft %s aus dem Cache", async (label, entry) => {
    const key = `invalid-${label.replaceAll(" ", "-")}`;
    localStorage.setItem(`dashboard:cache:${key}`, JSON.stringify(entry));
    const { result } = renderHook(
      () => useCachedQuery<Item[]>(key, async () => [{ title: "neu", date: new Date() }], 60_000, {
        decode: () => undefined,
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data?.[0]?.title).toBe("neu"));
    expect(localStorage.getItem(`dashboard:cache:${key}`)).toContain('"version":1');
  });

  it("behandelt einen werfenden Decoder wie einen ungültigen Cache", async () => {
    const key = "decoder-wirft";
    localStorage.setItem(`dashboard:cache:${key}`, JSON.stringify({
      version: 1, t: Date.now(), data: { alt: true },
    }));
    const { result } = renderHook(
      () => useCachedQuery<Item[]>(key, async () => [{ title: "neu", date: new Date() }], 60_000, {
        decode: () => { throw new Error("Decoderfehler"); },
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data?.[0]?.title).toBe("neu"));
    expect(localStorage.getItem(`dashboard:cache:${key}`)).toContain('"version":1');
  });

  it("verwirft einen Zeitstempel weit in der Zukunft", () => {
    const key = "future";
    localStorage.setItem(`dashboard:cache:${key}`, JSON.stringify({
      version: 1, t: Date.now() + 60_000, data: { alt: true },
    }));
    cleanupCache();
    expect(localStorage.getItem(`dashboard:cache:${key}`)).toBeNull();
  });

  it("räumt alte eigene Query-Varianten auf, lässt fremde Schlüssel aber unangetastet", () => {
    const now = Date.now();
    localStorage.setItem("dashboard:cache:alt-1", JSON.stringify({
      version: 1, t: now - CACHE_MAX_AGE_MS - 1, data: [],
    }));
    localStorage.setItem("dashboard:cache:alt-2", JSON.stringify({
      version: 1, t: now - CACHE_MAX_AGE_MS - 2, data: [],
    }));
    localStorage.setItem("other-app:cache:alt", JSON.stringify({ t: now - CACHE_MAX_AGE_MS - 3 }));
    for (let index = 0; index < CACHE_MAX_ENTRIES + 4; index += 1) {
      localStorage.setItem(`dashboard:cache:variant-${index}`, JSON.stringify({
        version: 1, t: now - index, data: [],
      }));
    }

    cleanupCache(now);

    expect(localStorage.getItem("dashboard:cache:alt-1")).toBeNull();
    expect(localStorage.getItem("dashboard:cache:alt-2")).toBeNull();
    expect(localStorage.getItem("other-app:cache:alt")).not.toBeNull();
    const dashboardKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key?.startsWith("dashboard:cache:") === true);
    expect(dashboardKeys).toHaveLength(CACHE_MAX_ENTRIES);
  });
});
