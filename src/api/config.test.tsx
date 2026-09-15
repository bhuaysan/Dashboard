import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/config",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
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
  it("invalidiert nach einem erfolgreichen Save alle config-abhängigen Quellen", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const cancel = vi.spyOn(client, "cancelQueries");
    const testWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(defaultConfig), { status: 200 })));
    const { result } = renderHook(() => useSaveConfig(), { wrapper: testWrapper });

    result.current.mutate(defaultConfig);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(cancel).toHaveBeenCalledWith({ queryKey: ["config"] });
    expect(invalidate).toHaveBeenCalledWith({ predicate: expect.any(Function) });
  });

  it("überspringt bei deaktiviertem Monitoring nur die PVE-Invalidierung", async () => {
    const client = new QueryClient();
    const testWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    for (const key of ["pve", "wx:test", "cal:test", "news:test"]) {
      client.setQueryData([key], { cached: true });
    }
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(defaultConfig), { status: 200 })));
    const { result } = renderHook(() => useSaveConfig(), { wrapper: testWrapper });

    act(() => result.current.mutate(defaultConfig));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(client.getQueryState(["wx:test"])?.isInvalidated).toBe(true));

    expect(client.getQueryState(["pve"])?.isInvalidated).not.toBe(true);
    expect(client.getQueryState(["cal:test"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["news:test"])?.isInvalidated).toBe(true);
  });

  it("lässt einen älteren Config-Poll einen erfolgreichen Save nicht zurückrollen", async () => {
    const client = new QueryClient();
    let resolveGet: (response: Response) => void = () => undefined;
    let getSignal: AbortSignal | undefined;
    const getResponse = new Promise<Response>((resolve) => { resolveGet = resolve; });
    const saved = { ...defaultConfig, theme: "dark" as const, updatedAt: "2026-08-25T12:00:00.000Z" };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/config" && init?.method === "PUT") {
        return Promise.resolve(new Response(JSON.stringify(saved), { status: 200 }));
      }
      getSignal = init?.signal ?? undefined;
      return getResponse;
    }));
    const testWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => ({ config: useConfig(), save: useSaveConfig() }), {
      wrapper: testWrapper,
    });

    await waitFor(() => expect(getSignal).toBeDefined());
    act(() => result.current.save.mutate(defaultConfig));
    await waitFor(() => expect(result.current.save.isSuccess).toBe(true));
    expect(getSignal?.aborted).toBe(true);

    resolveGet(new Response(JSON.stringify({ ...defaultConfig, theme: "light" }), { status: 200 }));
    await Promise.resolve();
    expect(client.getQueryData(["config"])).toEqual(saved);
    expect(JSON.parse(localStorage.getItem("dashboard:config") ?? "null")).toEqual(saved);
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
