import { describe, expect, it } from "vitest";
import { dayKey } from "./date";
import { easterSunday, holidayNames, holidaysNRW, nextHolidays } from "./holidays";

describe("easterSunday", () => {
  // Stützstellen aus dem gregorianischen Kalender: früher und später Termin, dazu ein
  // Schaltjahr — verrutscht die Rechnung, verrutschen sieben Feiertage mit.
  it("trifft bekannte Ostertermine", () => {
    expect(dayKey(easterSunday(2024))).toBe("2024-03-31");
    expect(dayKey(easterSunday(2025))).toBe("2025-04-20");
    expect(dayKey(easterSunday(2026))).toBe("2026-04-05");
    expect(dayKey(easterSunday(2027))).toBe("2027-03-28");
    expect(dayKey(easterSunday(2038))).toBe("2038-04-25");
  });
});

describe("holidaysNRW", () => {
  it("liefert elf Tage, aufsteigend sortiert", () => {
    const list = holidaysNRW(2026);
    expect(list).toHaveLength(11);
    const times = list.map((h) => h.date.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("berechnet die beweglichen Feiertage aus Ostern", () => {
    const by = new Map(holidaysNRW(2026).map((h) => [h.name, dayKey(h.date)]));
    expect(by.get("Karfreitag")).toBe("2026-04-03");
    expect(by.get("Ostermontag")).toBe("2026-04-06");
    expect(by.get("Christi Himmelfahrt")).toBe("2026-05-14");
    expect(by.get("Pfingstmontag")).toBe("2026-05-25");
    expect(by.get("Fronleichnam")).toBe("2026-06-04");
  });

  it("kennt die NRW-eigenen Tage und keine fremden", () => {
    const names = holidaysNRW(2026).map((h) => h.name);
    expect(names).toContain("Fronleichnam");
    expect(names).toContain("Allerheiligen");
    // Weder bundesweit noch in NRW gesetzlich — ein häufiger Irrtum.
    expect(names).not.toContain("Reformationstag");
    expect(names).not.toContain("Heilige Drei Könige");
    expect(names).not.toContain("Ostersonntag");
  });

  it("legt Feiertage auf lokale Mitternacht", () => {
    for (const h of holidaysNRW(2026)) expect(h.date.getHours()).toBe(0);
  });
});

describe("holidayNames", () => {
  it("fasst mehrere Jahre in einer Tabelle zusammen", () => {
    const map = holidayNames([2026, 2027, 2026]);
    expect(map.get("2026-12-26")).toBe("2. Weihnachtstag");
    expect(map.get("2027-01-01")).toBe("Neujahr");
    expect(map.get("2026-12-24")).toBeUndefined();
  });
});

describe("nextHolidays", () => {
  it("zählt den heutigen Feiertag als den nächsten", () => {
    expect(nextHolidays(new Date(2026, 9, 3, 14, 0), 1)[0]?.name).toBe("Tag der Deutschen Einheit");
  });

  it("greift an Silvester ins Folgejahr", () => {
    const next = nextHolidays(new Date(2026, 11, 31), 3);
    expect(next.map((h) => h.name)).toEqual(["Neujahr", "Karfreitag", "Ostermontag"]);
    expect(next[0] && dayKey(next[0].date)).toBe("2027-01-01");
  });

  it("liefert so viele Termine wie verlangt, aufsteigend", () => {
    const list = nextHolidays(new Date(2026, 7, 8), 3);
    expect(list.map((h) => dayKey(h.date)))
      .toEqual(["2026-10-03", "2026-11-01", "2026-12-25"]);
  });
});
