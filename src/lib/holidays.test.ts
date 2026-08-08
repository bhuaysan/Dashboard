import { describe, expect, it } from "vitest";
import { dayKey } from "./date";
import { easterSunday, holidayNames, holidaysBW, holidaysNRW } from "./holidays";

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

  it("unterscheidet die Feiertagssets von BW und NRW", () => {
    const bw = new Map(holidaysBW(2026).map((h) => [h.name, dayKey(h.date)]));
    const nrw = new Map(holidaysNRW(2026).map((h) => [h.name, dayKey(h.date)]));
    expect(bw.get("Heilige Drei Könige")).toBe("2026-01-06");
    expect(nrw.has("Heilige Drei Könige")).toBe(false);
    expect(holidayNames([2026], "BW").get("2026-01-06")).toBe("Heilige Drei Könige");
    expect(holidayNames([2026], "NRW").get("2026-01-06")).toBeUndefined();
  });
});
