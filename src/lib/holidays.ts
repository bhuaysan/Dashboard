import { addDays, dayKey, startOfDay } from "./date";

export type Holiday = { date: Date; name: string };

// Meeus/Jones/Butcher: Ostersonntag im gregorianischen Kalender. Sieben der elf
// Feiertage hängen daran, deshalb steht die Rechnung am Anfang und nicht in einer Tabelle
// mit Jahreszahlen, die 2031 abliefe.
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Die elf gesetzlichen Feiertage in Nordrhein-Westfalen. Fest verdrahtet, weil das
// Dashboard in NRW steht — Fronleichnam und Allerheiligen gelten längst nicht überall,
// eine Länderauswahl bräuchte für jedes Land eine eigene Liste und einen Eintrag in der
// Config. Oster- und Pfingstsonntag fehlen mit Absicht: sie sind Sonntage und außerhalb
// Brandenburgs nicht gesetzlich. Heiligabend und Silvester sind keine Feiertage.
export function holidaysNRW(year: number): Holiday[] {
  const easter = easterSunday(year);
  return [
    { date: new Date(year, 0, 1), name: "Neujahr" },
    { date: addDays(easter, -2), name: "Karfreitag" },
    { date: addDays(easter, 1), name: "Ostermontag" },
    { date: new Date(year, 4, 1), name: "Tag der Arbeit" },
    { date: addDays(easter, 39), name: "Christi Himmelfahrt" },
    { date: addDays(easter, 50), name: "Pfingstmontag" },
    { date: addDays(easter, 60), name: "Fronleichnam" },
    { date: new Date(year, 9, 3), name: "Tag der Deutschen Einheit" },
    { date: new Date(year, 10, 1), name: "Allerheiligen" },
    { date: new Date(year, 11, 25), name: "1. Weihnachtstag" },
    { date: new Date(year, 11, 26), name: "2. Weihnachtstag" },
  ].sort((x, y) => x.date.getTime() - y.date.getTime());
}

// Nach Tagesschlüssel, damit das Monatsraster pro Zelle nur nachschlägt statt zu rechnen.
// Ein Raster kann drei Jahre berühren (Dezember 2026 reicht bis Januar 2027).
export function holidayNames(years: number[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const year of new Set(years)) {
    for (const h of holidaysNRW(year)) map.set(dayKey(h.date), h.name);
  }
  return map;
}

// Der heutige Feiertag zählt als der nächste — an Silvester liegt der nächste im Folgejahr.
export function nextHoliday(from: Date): Holiday | undefined {
  const today = startOfDay(from).getTime();
  const year = from.getFullYear();
  return [...holidaysNRW(year), ...holidaysNRW(year + 1)]
    .find((h) => h.date.getTime() >= today);
}
