import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ConfigConflictError, useConfig, useSaveConfig } from "./config";
import { defaultConfig } from "../config/defaults";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("useConfig", () => {
  it("revalidiert eine lokale Config sofort beim Mount", async () => {
    localStorage.setItem("dashboard:config", JSON.stringify(defaultConfig));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...defaultConfig, theme: "dark" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useConfig(), { wrapper });
    expect(result.current.data?.theme).toBe("system");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/config"));
    await waitFor(() => expect(result.current.data?.theme).toBe("dark"));
  });

  it("behält den lokalen Stand, wenn die sofortige Revalidierung scheitert", async () => {
    localStorage.setItem("dashboard:config", JSON.stringify(defaultConfig));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const { result } = renderHook(() => useConfig(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    expect(result.current.data).toEqual(defaultConfig);
  });
});

describe("useSaveConfig", () => {
  it("invalidiert nach einem erfolgreichen Save den Homelab-Query", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const testWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(defaultConfig), { status: 200 })));
    const { result } = renderHook(() => useSaveConfig(), { wrapper: testWrapper });

    result.current.mutate(defaultConfig);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["pve"] });
  });

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
