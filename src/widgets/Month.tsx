import { Fragment } from "react";
import type { CalEvent } from "../lib/ics";
import { dayKey, isoWeek, monthGrid, startOfDay } from "../lib/date";
import { holidayNames } from "../lib/holidays";

// Feste Kürzel statt Intl: die Spalten sind zeichenbreit gesetzt, und ob eine Locale
// ihre Kurzform mit Punkt liefert, entschiede sonst über die Ausrichtung des Rasters.
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function monthLabel(d: Date): string {
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(d);
}

export function Month({ now, events }: { now: Date; events?: CalEvent[] }) {
  const { weeks } = monthGrid(now);
  const today = startOfDay(now);
  const todayKey = dayKey(today);
  const month = now.getMonth();

  // Ein Raster kann bis in zwei Nachbarjahre reichen — Dezember zeigt Tage im Januar.
  const holidays = holidayNames(weeks.flat().map((d) => d.getFullYear()));
  const withEvents = new Set((events ?? []).map((e) => dayKey(e.start)));

  const spoken = weeks.flat()
    .filter((d) => d.getMonth() === month)
    .map((d) => ({ d, name: holidays.get(dayKey(d)) }))
    .filter((x): x is { d: Date; name: string } => x.name !== undefined)
    .map((x) => `${x.d.getDate()}. ${x.name}`);

  return (
    <div className="cal">
      <div className="cal-grid">
        <span className="cal-kw">KW</span>
        {WEEKDAYS.map((w) => (
          <span className="cal-head" key={w}>{w}</span>
        ))}
        {weeks.map((week) => (
          <Fragment key={dayKey(week[0] ?? today)}>
            <span className="cal-kw">{isoWeek(week[0] ?? today)}</span>
            {week.map((d) => {
              const key = dayKey(d);
              // Tage aus dem Nachbarmonat bleiben leer — sonst stünde etwa der 1.
              // November als Feiertag im Oktoberraster, ohne dazuzugehören.
              if (d.getMonth() !== month) {
                return <span className="cal-day is-outside" key={key} aria-hidden />;
              }
              const holiday = holidays.get(key);
              const cls = [
                "cal-day",
                d.getDay() === 0 || d.getDay() === 6 ? "is-weekend" : "",
                holiday ? "is-holiday" : "",
                withEvents.has(key) ? "has-event" : "",
                key === todayKey ? "is-today" : "",
              ].filter(Boolean).join(" ");
              // Den Namen trägt nur der Titel: sichtbar bleibt die Pane ein Raster.
              return (
                <span className={cls} key={key} title={holiday}>{d.getDate()}</span>
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* Im Raster stehen für einen Screenreader nur Zahlen. Farbe und Fettung, die einen
          Feiertag ausweisen, hört niemand — deshalb diese Zeile, die nichts anzeigt. */}
      <p className="sr-only">
        {spoken.length > 0 ? `Feiertage in diesem Monat: ${spoken.join(", ")}.` : "Keine Feiertage in diesem Monat."}
      </p>
    </div>
  );
}
