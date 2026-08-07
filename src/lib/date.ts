// Kalenderrechnungen in Ortszeit. Alles hier arbeitet auf lokalen Daten, nicht auf UTC:
// ein Monatsraster, das um Mitternacht in eine andere Zeitzone rutscht, wäre falsch.

export function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// Schlüssel für Nachschlagetabellen: ein Tag, unabhängig von der Uhrzeit.
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

// Ganze Wochen von Montag bis Sonntag, die den Monat von `d` überdecken. Dieselbe
// Rechnung braucht die Monats-Pane für ihr Raster und App.tsx für den Zeitraum, über den
// Termine geholt werden — deshalb steht sie hier und nicht im Widget.
export function monthGrid(d: Date): { weeks: Date[][]; from: Date; to: Date } {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;          // Montag = 0
  const start = addDays(first, -offset);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const weekCount = Math.ceil((offset + daysInMonth) / 7);

  const weeks: Date[][] = [];
  for (let w = 0; w < weekCount; w += 1) {
    const days: Date[] = [];
    for (let i = 0; i < 7; i += 1) days.push(addDays(start, w * 7 + i));
    weeks.push(days);
  }
  const to = addDays(start, weekCount * 7);
  to.setMilliseconds(-1);                           // letzter Moment des letzten Sonntags
  return { weeks, from: start, to };
}
