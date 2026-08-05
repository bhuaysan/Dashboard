import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCachedQuery } from "./useCachedQuery";

type Item = { title: string; date: Date };

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe("useCachedQuery", () => {
  it("belebt Datumsfelder aus dem JSON-Cache wieder", async () => {
    localStorage.setItem(
      "dashboard:cache:test",
      JSON.stringify({ t: Date.now() - 120_000, data: [{ title: "Meldung", date: "2026-08-05T12:00:00.000Z" }] }),
    );
    const { result } = renderHook(
      () => useCachedQuery<Item[]>(
        "test",
        async () => [{ title: "neu", date: new Date() }],
        60_000,
        { revive: (items) => items.map((i) => ({ ...i, date: new Date(i.date) })) },
      ),
      { wrapper },
    );
    const first = result.current.data?.[0];
    expect(first?.title).toBe("Meldung");
    expect(first?.date).toBeInstanceOf(Date);
    expect(() => first?.date.getFullYear()).not.toThrow();
    await waitFor(() => expect(result.current.data?.[0]?.title).toBe("neu"));
  });
});
