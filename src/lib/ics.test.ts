import { describe, expect, it } from "vitest";
import { parseIcs } from "./ics";

const FROM = new Date("2026-08-05T00:00:00");
const TO = new Date("2026-08-08T23:59:59");

describe("parseIcs", () => {
  it("erkennt Ganztagstermine", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:1",
      "DTSTART;VALUE=DATE:20260806",
      "DTEND;VALUE=DATE:20260807",
      "SUMMARY:Brückentag Kollegin",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(ics, FROM, TO);
    expect(events).toHaveLength(1);
    expect(events[0]?.allDay).toBe(true);
    expect(events[0]?.title).toBe("Brückentag Kollegin");
    expect(events[0]?.start.getDate()).toBe(6);
  });

  it("weitet wöchentliche Serien im Zeitraum aus", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:2",
      "DTSTART:20260805T090000",
      "DTEND:20260805T100000",
      "SUMMARY:Daily",
      "RRULE:FREQ=WEEKLY",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(ics, FROM, TO);
    expect(events).toHaveLength(1);
    expect(events[0]?.start.getDate()).toBe(5);
    expect(events[0]?.title).toBe("Daily");
  });

  it("behandelt Termine über Mitternacht als einen Termin", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:3",
      "DTSTART:20260806T220000",
      "DTEND:20260807T020000",
      "SUMMARY:Nachtschicht",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(ics, FROM, TO);
    expect(events).toHaveLength(1);
    expect(events[0]?.start.getDate()).toBe(6);
    expect(events[0]?.end.getDate()).toBe(7);
    expect(events[0]?.allDay).toBe(false);
  });
});
