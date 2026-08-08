import type { CalEvent } from "../lib/ics";
import type { HolidayRegion } from "../config/schema";
import { dayKey, isoWeek, monthGrid, startOfDay } from "../lib/date";
import { holidayNames } from "../lib/holidays";

// Feste Kürzel statt Intl: die Spalten sind zeichenbreit gesetzt, und ob eine Locale
// ihre Kurzform mit Punkt liefert, entschiede sonst über die Ausrichtung des Rasters.
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function monthLabel(d: Date): string {
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(d);
}

export function Month({ now, events, holidayRegion = "BW" }: {
  now: Date;
  events?: CalEvent[];
  holidayRegion?: HolidayRegion;
}) {
  const grid = monthGrid(now);
  const { weeks } = grid;
  const today = startOfDay(now);
  const todayKey = dayKey(today);
  const month = now.getMonth();
  const dateFormatter = new Intl.DateTimeFormat("de-DE", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  // Ein Raster kann bis in zwei Nachbarjahre reichen — Dezember zeigt Tage im Januar.
  const holidays = holidayNames(weeks.flat().map((d) => d.getFullYear()), holidayRegion);
  const eventCounts = new Map<string, number>();
  for (const event of events ?? []) {
    if (event.end < grid.from || event.start > grid.to) continue;
    const cursor = startOfDay(event.start < grid.from ? grid.from : event.start);
    const last = startOfDay(new Date(event.end.getTime() - 1) > grid.to ? grid.to : new Date(event.end.getTime() - 1));
    for (const day = new Date(cursor); day <= last; day.setDate(day.getDate() + 1)) {
      const key = dayKey(day);
      eventCounts.set(key, (eventCounts.get(key) ?? 0) + 1);
    }
  }

  const spoken = weeks.flat()
    .filter((d) => d.getMonth() === month)
    .map((d) => ({ d, name: holidays.get(dayKey(d)) }))
    .filter((x): x is { d: Date; name: string } => x.name !== undefined)
    .map((x) => `${x.d.getDate()}. ${x.name}`);

  return (
    <div className="cal">
      <table className="cal-grid">
        <caption className="sr-only">Kalender {monthLabel(now)}</caption>
        <thead>
          <tr>
            <th className="cal-kw" scope="col">KW</th>
            {WEEKDAYS.map((weekday) => (
              <th className="cal-head" scope="col" key={weekday}>{weekday}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={dayKey(week[0] ?? today)}>
              <th className="cal-kw" scope="row">{isoWeek(week[0] ?? today)}</th>
              {week.map((d) => {
                const key = dayKey(d);
                // Tage aus dem Nachbarmonat bleiben leer — sonst stünde etwa der 1.
                // November als Feiertag im Oktoberraster, ohne dazuzugehören.
                if (d.getMonth() !== month) {
                  return <td className="cal-day is-outside" key={key} aria-hidden="true" />;
                }
                const holiday = holidays.get(key);
                const eventCount = eventCounts.get(key) ?? 0;
                const cls = [
                  "cal-day",
                  d.getDay() === 0 || d.getDay() === 6 ? "is-weekend" : "",
                  holiday ? "is-holiday" : "",
                  eventCount > 0 ? "has-event" : "",
                  key === todayKey ? "is-today" : "",
                ].filter(Boolean).join(" ");
                const details = [
                  dateFormatter.format(d),
                  key === todayKey ? "heute" : undefined,
                  holiday ? `Feiertag: ${holiday}` : undefined,
                  eventCount > 0 ? `${eventCount} ${eventCount === 1 ? "Termin" : "Termine"}` : undefined,
                ].filter((value): value is string => value !== undefined).join(", ");
                return (
                  <td
                    className={cls}
                    key={key}
                    title={holiday}
                    aria-label={details}
                    aria-current={key === todayKey ? "date" : undefined}
                  >
                    {d.getDate()}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="sr-only">
        {spoken.length > 0 ? `Feiertage in diesem Monat: ${spoken.join(", ")}.` : "Keine Feiertage in diesem Monat."}
      </p>
    </div>
  );
}
