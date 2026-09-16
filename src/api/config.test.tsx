import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ConfigConflictError, useConfig, useSaveConfig } from "./config";
import { defaultConfig } from "../config/defaults";
import { DEFAULT_PROFILE_ID, type ProfileId } from "../config/schema";

const WORK_PROFILE_ID = "123e4567-e89b-42d3-a456-426614174000" as ProfileId;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("useConfig", () => {
  it("markiert den Default-Platzhalter ohne lokalen Snapshot erst nach echter Config als bereit", async () => {
    const response = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async () => response.promise));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const testWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useConfig(WORK_PROFILE_ID), { wrapper: testWrapper });

    expect(result.current.data).toEqual(defaultConfig);
    expect(result.current.configReady).toBe(false);

    response.resolve(new Response(JSON.stringify({ ...defaultConfig, theme: "dark" }), { status: 200 }));
    await waitFor(() => expect(result.current.configReady).toBe(true));
    expect(result.current.data?.theme).toBe("dark");
  });

  it("revalidiert eine lokale Config sofort beim Mount", async () => {
    localStorage.setItem("dashboard:config:default", JSON.stringify(defaultConfig));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...defaultConfig, theme: "dark" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useConfig(DEFAULT_PROFILE_ID), { wrapper });
    expect(result.current.data?.theme).toBe("system");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/config?profile=default",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    await waitFor(() => expect(result.current.data?.theme).toBe("dark"));
  });

  it("behält den lokalen Stand, wenn die sofortige Revalidierung scheitert", async () => {
    localStorage.setItem("dashboard:config:default", JSON.stringify(defaultConfig));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const { result } = renderHook(() => useConfig(DEFAULT_PROFILE_ID), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    expect(result.current.data).toEqual(defaultConfig);
    expect(result.current.configReady).toBe(true);
  });

  it("schreibt keine Config, deren JSON erst nach dem Abbruch fertig wird", async () => {
    const local = { ...defaultConfig, theme: "light" as const };
    localStorage.setItem("dashboard:config:default", JSON.stringify(local));
    const pendingJson = deferred<unknown>();
    const jsonStarted = deferred<void>();
    const response = new Response(null, { status: 200 });
    Object.defineProperty(response, "json", {
      configurable: true,
      value: () => {
        jsonStarted.resolve(undefined);
        return pendingJson.promise;
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const testWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useConfig(DEFAULT_PROFILE_ID), { wrapper: testWrapper });

    await jsonStarted.promise;
    const cancellation = client.cancelQueries({ queryKey: ["config", DEFAULT_PROFILE_ID] });
    pendingJson.resolve({ ...defaultConfig, theme: "dark" });
    await cancellation;
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(JSON.parse(localStorage.getItem("dashboard:config:default") ?? "null")).toEqual(local);
  });
});

describe("useSaveConfig", () => {
  it("speichert die Zielprofil-Config mit URL-Parameter und If-Match", async () => {
    const saved = { ...defaultConfig, theme: "dark" as const };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(saved), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient();
    const otherConfig = { ...defaultConfig, theme: "light" as const };
    client.setQueryData(["config", DEFAULT_PROFILE_ID], defaultConfig);
    client.setQueryData(["config", WORK_PROFILE_ID], otherConfig);
    const testWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSaveConfig(WORK_PROFILE_ID), { wrapper: testWrapper });

    act(() => result.current.mutate(defaultConfig));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/config?profile=${WORK_PROFILE_ID}`,
      expect.objectContaining({
        method: "PUT",
        headers: { "content-type": "application/json", "If-Match": defaultConfig.updatedAt },
        body: JSON.stringify(defaultConfig),
      }),
    );
    expect(client.getQueryData(["config", WORK_PROFILE_ID])).toEqual(saved);
    expect(client.getQueryData(["config", DEFAULT_PROFILE_ID])).toEqual(defaultConfig);
    expect(JSON.parse(localStorage.getItem(`dashboard:config:${WORK_PROFILE_ID}`) ?? "null")).toEqual(saved);
  });

  it("invalidiert nach einem erfolgreichen Save alle config-abhängigen Quellen", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const cancel = vi.spyOn(client, "cancelQueries");
    const testWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(defaultConfig), { status: 200 })));
    const { result } = renderHook(() => useSaveConfig(DEFAULT_PROFILE_ID), { wrapper: testWrapper });

    result.current.mutate(defaultConfig);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(cancel).toHaveBeenCalledWith({ queryKey: ["config", DEFAULT_PROFILE_ID] });
    expect(invalidate).toHaveBeenCalledWith({ predicate: expect.any(Function) });
  });

  it("überspringt bei deaktiviertem Monitoring nur die PVE-Invalidierung", async () => {
    const client = new QueryClient();
    const testWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    for (const key of ["profile:default:pve", "profile:default:wx:test", "profile:default:cal:test", "profile:default:news:test", "profile:other:wx:test"]) {
      client.setQueryData([key], { cached: true });
    }
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(defaultConfig), { status: 200 })));
    const { result } = renderHook(() => useSaveConfig(DEFAULT_PROFILE_ID), { wrapper: testWrapper });

    act(() => result.current.mutate(defaultConfig));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(client.getQueryState(["profile:default:wx:test"])?.isInvalidated).toBe(true));

    expect(client.getQueryState(["profile:default:pve"])?.isInvalidated).not.toBe(true);
    expect(client.getQueryState(["profile:default:cal:test"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["profile:default:news:test"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["profile:other:wx:test"])?.isInvalidated).not.toBe(true);
  });

  it("lässt einen älteren Config-Poll einen erfolgreichen Save nicht zurückrollen", async () => {
    const client = new QueryClient();
    let resolveGet: (response: Response) => void = () => undefined;
    let getSignal: AbortSignal | undefined;
    const getResponse = new Promise<Response>((resolve) => { resolveGet = resolve; });
    const saved = { ...defaultConfig, theme: "dark" as const, updatedAt: "2026-08-25T12:00:00.000Z" };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/config?profile=default" && init?.method === "PUT") {
        return Promise.resolve(new Response(JSON.stringify(saved), { status: 200 }));
      }
      getSignal = init?.signal ?? undefined;
      return getResponse;
    }));
    const testWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => ({ config: useConfig(DEFAULT_PROFILE_ID), save: useSaveConfig(DEFAULT_PROFILE_ID) }), {
      wrapper: testWrapper,
    });

    await waitFor(() => expect(getSignal).toBeDefined());
    act(() => result.current.save.mutate(defaultConfig));
    await waitFor(() => expect(result.current.save.isSuccess).toBe(true));
    expect(getSignal?.aborted).toBe(true);

    resolveGet(new Response(JSON.stringify({ ...defaultConfig, theme: "light" }), { status: 200 }));
    await Promise.resolve();
    expect(client.getQueryData(["config", DEFAULT_PROFILE_ID])).toEqual(saved);
    expect(JSON.parse(localStorage.getItem("dashboard:config:default") ?? "null")).toEqual(saved);
  });

  it("überschreibt einen bereits neueren Config-Snapshot nicht mit älterer PUT-Antwort", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const put = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") return put.promise;
      return Promise.resolve(new Response("", { status: 502 }));
    }));
    const testWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSaveConfig(DEFAULT_PROFILE_ID), { wrapper: testWrapper });
    const saved = { ...defaultConfig, theme: "dark" as const, updatedAt: "2026-08-25T12:00:00.000Z" };
    const newer = { ...defaultConfig, theme: "light" as const, updatedAt: "2026-08-25T12:00:01.000Z" };

    act(() => result.current.mutate(defaultConfig));
    client.setQueryData(["config", DEFAULT_PROFILE_ID], newer);
    localStorage.setItem("dashboard:config:default", JSON.stringify(newer));
    put.resolve(new Response(JSON.stringify(saved), { status: 200 }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(["config", DEFAULT_PROFILE_ID])).toEqual(newer);
    expect(JSON.parse(localStorage.getItem("dashboard:config:default") ?? "null")).toEqual(newer);
  });

  it("trägt bei 409 den frischen Stand des Servers im Fehler", async () => {
    const fresh = "2026-08-06T12:00:00.000Z";
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "conflict", current: fresh }), { status: 409 })));
    const { result } = renderHook(() => useSaveConfig(DEFAULT_PROFILE_ID), { wrapper });
    result.current.mutate(defaultConfig);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ConfigConflictError);
    expect((result.current.error as ConfigConflictError).current).toBe(fresh);
  });

  it("bleibt ohne lesbaren Konflikt-Body funktionsfähig, statt zu werfen", async () => {
    // Ein 409 ohne (oder mit kaputtem) JSON-Body darf den Fehlerpfad selbst nicht sprengen.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("kaputt{", { status: 409 })));
    const { result } = renderHook(() => useSaveConfig(DEFAULT_PROFILE_ID), { wrapper });
    result.current.mutate(defaultConfig);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ConfigConflictError);
    expect((result.current.error as ConfigConflictError).current).toBeUndefined();
  });
});
