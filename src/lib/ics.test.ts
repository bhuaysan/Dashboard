import { describe, expect, it } from "vitest";
import { parseIcs, RecurrenceExpansionError } from "./ics";

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

  it("rendert eine verschobene Serieninstanz genau einmal mit ihren Exception-Daten", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:series-moved",
      "DTSTART:20260805T090000",
      "DTEND:20260805T100000",
      "SUMMARY:Daily",
      "RRULE:FREQ=DAILY;COUNT=2",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:series-moved",
      "RECURRENCE-ID:20260806T090000",
      "DTSTART:20260806T110000",
      "DTEND:20260806T123000",
      "SUMMARY:Verschoben",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(ics, FROM, TO);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.title)).toEqual(["Daily", "Verschoben"]);
    expect(events[1]?.start.getHours()).toBe(11);
    expect(events[1]?.end.getHours()).toBe(12);
  });

  it("entfernt eine abgesagte Einzelinstanz aus der Serie", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:series-cancelled",
      "DTSTART:20260805T090000",
      "DTEND:20260805T100000",
      "SUMMARY:Daily",
      "RRULE:FREQ=DAILY;COUNT=2",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:series-cancelled",
      "RECURRENCE-ID:20260806T090000",
      "DTSTART:20260806T090000",
      "DTEND:20260806T100000",
      "STATUS:CANCELLED",
      "SUMMARY:Daily",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(ics, FROM, TO);
    expect(events).toHaveLength(1);
    expect(events[0]?.start.getDate()).toBe(5);
  });

  it("überspringt eine minimale abgesagte Serienexception ohne DTSTART und DTEND", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:series-minimal-cancelled",
      "DTSTART:20260805T090000",
      "DTEND:20260805T100000",
      "SUMMARY:Daily",
      "RRULE:FREQ=DAILY;COUNT=2",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:series-minimal-cancelled",
      "RECURRENCE-ID:20260806T090000",
      "STATUS:CANCELLED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(ics, FROM, TO);
    expect(events).toHaveLength(1);
    expect(events[0]?.start.getDate()).toBe(5);
  });

  it("ordnet Exceptions nur ihrer UID zu und ignoriert verwaiste Exceptions", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:series-a",
      "DTSTART:20260805T090000",
      "DTEND:20260805T100000",
      "SUMMARY:A",
      "RRULE:FREQ=DAILY;COUNT=2",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:series-b",
      "DTSTART:20260805T090000",
      "DTEND:20260805T100000",
      "SUMMARY:B",
      "RRULE:FREQ=DAILY;COUNT=2",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:series-a",
      "RECURRENCE-ID:20260806T090000",
      "DTSTART:20260806T110000",
      "DTEND:20260806T120000",
      "SUMMARY:A verschoben",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:missing-master",
      "RECURRENCE-ID:20260806T090000",
      "DTSTART:20260806T120000",
      "DTEND:20260806T130000",
      "SUMMARY:Verwaist",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(ics, FROM, TO);
    expect(events).toHaveLength(4);
    expect(events.filter((event) => event.title === "A verschoben")).toHaveLength(1);
    expect(events.some((event) => event.title === "Verwaist")).toBe(false);
  });

  it("berücksichtigt einen Termin, der vor dem Fenster beginnt und hineinragt", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:4",
      "DTSTART:20260806T220000",
      "DTEND:20260807T020000",
      "SUMMARY:Nach Mitternacht",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(ics, new Date("2026-08-07T00:00:00"), TO);
    expect(events).toHaveLength(1);
  });

  it("schließt einen Termin aus, dessen exklusives DTEND genau am Fensteranfang liegt", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:end-exclusive",
      "DTSTART:20260806T220000",
      "DTEND:20260807T000000",
      "SUMMARY:Gestern",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(
      ics,
      new Date("2026-08-07T00:00:00"),
      new Date("2026-08-07T23:59:59"),
    );
    expect(events).toEqual([]);
  });

  it("behält einen Null-Dauer-Termin innerhalb des Fensters", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:instant",
      "DTSTART:20260807T120000",
      "DTEND:20260807T120000",
      "SUMMARY:Zeitpunkt",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    expect(parseIcs(
      ics,
      new Date("2026-08-07T00:00:00"),
      new Date("2026-08-07T23:59:59"),
    )).toHaveLength(1);
  });

  it("begrenzt eine sehr alte tägliche Serie auf den angefragten Bereich", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:old-daily",
      "DTSTART:20000101T090000",
      "DTEND:20000101T100000",
      "SUMMARY:Alt",
      "RRULE:FREQ=DAILY",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(ics, FROM, TO);
    expect(events).toHaveLength(4);
    expect(events[0]?.start.toISOString()).toContain("2026-08-05");
  });

  it("meldet eine alte sekundliche Serie statt still unvollständiger Daten", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:old-secondly",
      "DTSTART:20260801T090000",
      "DTEND:20260801T090001",
      "SUMMARY:Zu häufig",
      "RRULE:FREQ=SECONDLY",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    expect(() => parseIcs(ics, FROM, TO, { maxRecurrenceOperations: 4 })).toThrow(RecurrenceExpansionError);
  });
});
