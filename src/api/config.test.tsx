import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ConfigConflictError, useSaveConfig } from "./config";
import { defaultConfig } from "../config/defaults";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSaveConfig", () => {
  it("trägt bei 409 den frischen Stand des Servers im Fehler", async () => {
    const fresh = "2026-08-06T12:00:00.000Z";
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "conflict", current: fresh }), { status: 409 })));
    const { result } = renderHook(() => useSaveConfig(), { wrapper });
    result.current.mutate(defaultConfig);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ConfigConflictError);
    expect((result.current.error as ConfigConflictError).current).toBe(fresh);
  });

  it("bleibt ohne lesbaren Konflikt-Body funktionsfähig, statt zu werfen", async () => {
    // Ein 409 ohne (oder mit kaputtem) JSON-Body darf den Fehlerpfad selbst nicht sprengen.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("kaputt{", { status: 409 })));
    const { result } = renderHook(() => useSaveConfig(), { wrapper });
    result.current.mutate(defaultConfig);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ConfigConflictError);
    expect((result.current.error as ConfigConflictError).current).toBeUndefined();
  });
});
