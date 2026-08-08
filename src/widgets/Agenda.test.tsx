import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config/schema";
import { fetchEvents, filterAgendaEvents } from "./Agenda";
import type { CalEvent } from "../lib/ics";

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

  it("liefert erreichbare Kalender und benennt einen partiellen Ausfall", async () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:ok",
      "DTSTART:20260806T090000",
      "DTEND:20260806T100000",
      "SUMMARY:Termin",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("ok.example") ? new Response(ics, { status: 200 }) : new Response("", { status: 502 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchEvents(
      [{ label: "ok", url: "https://ok.example/calendar.ics" }, { label: "kaputt", url: "https://bad.example/calendar.ics" }],
      new Date("2026-08-05T00:00:00"),
      new Date("2026-08-08T23:59:59"),
    );
    expect(result.items).toHaveLength(1);
    expect(result.failures).toEqual(["kaputt"]);
  });

  it("meldet eine nicht expandierbare Serie als Quellenfehler", async () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:zu-häufig",
      "DTSTART:20260801T090000",
      "DTEND:20260801T090001",
      "SUMMARY:Zu häufig",
      "RRULE:FREQ=SECONDLY",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const goodIcs = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:gut",
      "DTSTART:20260805T090000",
      "DTEND:20260805T100000",
      "SUMMARY:Termin",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("gut") ? new Response(goodIcs, { status: 200 }) : new Response(ics, { status: 200 }),
    ));

    const result = await fetchEvents(
      [
        { label: "zu häufig", url: "https://calendar.example/zu-haeufig.ics" },
        { label: "gut", url: "https://calendar.example/gut.ics" },
      ],
      new Date("2026-08-05T00:00:00"),
      new Date("2026-08-08T23:59:59"),
    );
    expect(result.items).toHaveLength(1);
    expect(result.failures).toEqual(["zu häufig"]);
  });
});

describe("filterAgendaEvents", () => {
  it("behält einen über Mitternacht laufenden Termin", () => {
    const event: CalEvent = {
      title: "Nacht",
      start: new Date("2026-08-06T23:00:00"),
      end: new Date("2026-08-07T01:00:00"),
      allDay: false,
    };
    expect(filterAgendaEvents([event], new Date("2026-08-07T09:00:00"))).toEqual([event]);
  });
});
