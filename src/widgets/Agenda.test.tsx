import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config/schema";
import { fetchEvents } from "./Agenda";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchEvents", () => {
  it("schickt einen ungültigen protocol-relativen Kalender nie direkt an eine Fremd-Origin", async () => {
    const url = "//evil.example/arbeit.ics";
    const fetchMock = vi.fn(async () => new Response("", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const calendars: Config["calendars"] = [{ label: "fremd", url }];

    await expect(fetchEvents(calendars, new Date("2026-08-08T23:59:59Z"))).rejects.toThrow("Kein Kalender erreichbar");
    expect(fetchMock).toHaveBeenCalledWith(`/api/proxy?url=${encodeURIComponent(url)}`);
  });
});
