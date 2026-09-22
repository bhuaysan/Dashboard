import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useCreateProfile,
  useDeleteProfile,
  useProfiles,
  useRenameProfile,
  LastProfileError,
  type ProfileCatalog,
} from "./profiles";
import { profileApiUrl } from "./profileUrl";
import { DEFAULT_PROFILE_ID, type ProfileId } from "../config/schema";
import { writeLocalCatalog } from "../config/local";

const WORK_PROFILE_ID = "123e4567-e89b-42d3-a456-426614174000" as ProfileId;
const catalog: ProfileCatalog = {
  profilesUpdatedAt: "2026-09-15T00:00:00.000Z",
  profiles: [
    { id: DEFAULT_PROFILE_ID, name: "Standard" },
    { id: WORK_PROFILE_ID, name: "Arbeit" },
  ],
};

function createClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("profileApiUrl", () => {
  it("encodes profile IDs and remote targets with URLSearchParams", () => {
    const target = "https://example.test/path?a=1&b=two words";
    const url = profileApiUrl("/api/proxy", WORK_PROFILE_ID, new URLSearchParams({ url: target }));
    const parsed = new URL(url, "http://dashboard.test");
    expect(parsed.pathname).toBe("/api/proxy");
    expect(parsed.searchParams.get("profile")).toBe(WORK_PROFILE_ID);
    expect(parsed.searchParams.get("url")).toBe(target);
    expect(url).not.toContain("two words");
  });
});

describe("useProfiles", () => {
  it("renders a local catalog immediately and revalidates it", async () => {
    writeLocalCatalog(catalog);
    const fetched = { ...catalog, profilesUpdatedAt: "2026-09-16T00:00:00.000Z" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fetched), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient();
    const { result } = renderHook(() => useProfiles(), { wrapper: wrapperFor(client) });

    expect(result.current.data).toEqual(catalog);
    await waitFor(() => expect(result.current.data).toEqual(fetched));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/profiles",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(client.getQueryData(["profiles"])).toEqual(fetched);
  });

  it("polls the profile catalog every 15 seconds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(catalog), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useProfiles(), { wrapper: wrapperFor(createClient()) });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const before = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current.isSuccess).toBe(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });

  it("does not persist a catalog whose JSON finishes after cancellation", async () => {
    writeLocalCatalog(catalog);
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
    const client = createClient();
    renderHook(() => useProfiles(), { wrapper: wrapperFor(client) });

    await jsonStarted.promise;
    const cancellation = client.cancelQueries({ queryKey: ["profiles"] });
    pendingJson.resolve({ ...catalog, profilesUpdatedAt: "2026-09-16T00:00:00.000Z" });
    await cancellation;
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(JSON.parse(localStorage.getItem("dashboard:profiles") ?? "null")).toEqual(catalog);
  });
});

describe("profile catalog mutations", () => {
  it("sends create, rename, and delete with the catalog revision", async () => {
    const finalCatalog: ProfileCatalog = { ...catalog, profiles: [{ id: DEFAULT_PROFILE_ID, name: "Standard" }] };
    const responses = [
      { catalog: { ...catalog, profiles: [...catalog.profiles, { id: "223e4567-e89b-42d3-a456-426614174000", name: "Privat" }] }, createdId: "223e4567-e89b-42d3-a456-426614174000" },
      { catalog },
      { catalog: finalCatalog },
    ];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(responses.shift()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient();
    const { result } = renderHook(() => ({
      create: useCreateProfile(),
      rename: useRenameProfile(),
      remove: useDeleteProfile(),
    }), { wrapper: wrapperFor(client) });

    await act(async () => {
      result.current.create.mutate({ name: "Privat", sourceProfileId: DEFAULT_PROFILE_ID, profilesUpdatedAt: catalog.profilesUpdatedAt });
    });
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
    await act(async () => {
      result.current.rename.mutate({ profileId: WORK_PROFILE_ID, name: "Office", profilesUpdatedAt: catalog.profilesUpdatedAt });
    });
    await waitFor(() => expect(result.current.rename.isSuccess).toBe(true));
    await act(async () => {
      result.current.remove.mutate({ profileId: WORK_PROFILE_ID, profilesUpdatedAt: catalog.profilesUpdatedAt });
    });
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/profiles");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json", "If-Match": catalog.profilesUpdatedAt },
      body: JSON.stringify({ name: "Privat", sourceProfileId: DEFAULT_PROFILE_ID }),
    }));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/profiles/${WORK_PROFILE_ID}`);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "PATCH",
      headers: { "content-type": "application/json", "If-Match": catalog.profilesUpdatedAt },
      body: JSON.stringify({ name: "Office" }),
    }));
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`/api/profiles/${WORK_PROFILE_ID}`);
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      method: "DELETE",
      headers: { "If-Match": catalog.profilesUpdatedAt },
    }));
    expect(client.getQueryData(["profiles"])).toEqual(finalCatalog);
  });

  it("keeps the server revision in a catalog conflict error", async () => {
    const current = "2026-09-16T12:00:00.000Z";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "conflict", current }), { status: 409 })));
    const { result } = renderHook(() => useRenameProfile(), { wrapper: wrapperFor(createClient()) });
    act(() => result.current.mutate({ profileId: WORK_PROFILE_ID, name: "Office", profilesUpdatedAt: catalog.profilesUpdatedAt }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ current });
  });

  it("erkennt die fachliche Antwort beim Löschen des letzten Profils", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "last-profile" }), { status: 409 })));
    const { result } = renderHook(() => useDeleteProfile(), { wrapper: wrapperFor(createClient()) });

    act(() => result.current.mutate({ profileId: WORK_PROFILE_ID, profilesUpdatedAt: catalog.profilesUpdatedAt }));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(LastProfileError);
  });

  it("überschreibt einen neueren Katalog-Poll nicht mit älterer Mutationsantwort", async () => {
    const put = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return put.promise;
      return Promise.resolve(new Response("", { status: 502 }));
    }));
    const client = createClient();
    const { result } = renderHook(() => useCreateProfile(), { wrapper: wrapperFor(client) });
    const newer: ProfileCatalog = {
      ...catalog,
      profilesUpdatedAt: "2026-09-16T00:00:00.000Z",
      profiles: [...catalog.profiles, { id: "223e4567-e89b-42d3-a456-426614174000" as ProfileId, name: "Privat" }],
    };

    act(() => result.current.mutate({ name: "Privat", sourceProfileId: DEFAULT_PROFILE_ID, profilesUpdatedAt: catalog.profilesUpdatedAt }));
    client.setQueryData(["profiles"], newer);
    writeLocalCatalog(newer);
    put.resolve(new Response(JSON.stringify({ catalog, createdId: "223e4567-e89b-42d3-a456-426614174000" }), { status: 200 }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(["profiles"])).toEqual(newer);
    expect(JSON.parse(localStorage.getItem("dashboard:profiles") ?? "null")).toEqual(newer);
  });
});
