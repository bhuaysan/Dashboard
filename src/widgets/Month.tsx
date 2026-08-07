import { Fragment } from "react";
import type { CalEvent } from "../lib/ics";
import { dayKey, isoWeek, monthGrid, startOfDay } from "../lib/date";
import { holidayNames, nextHoliday } from "../lib/holidays";

// Feste Kürzel statt Intl: die Spalten sind zeichenbreit gesetzt, und ob eine Locale
// ihre Kurzform mit Punkt liefert, entschiede sonst über die Ausrichtung des Rasters.
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const monthFmt = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const dateFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" });

function inDaysText(days: number): string {
  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  return `in ${days} Tagen`;
}

export function Month({ now, events }: { now: Date; events?: CalEvent[] }) {
  const { weeks } = monthGrid(now);
  const today = startOfDay(now);
  const todayKey = dayKey(today);
  const month = now.getMonth();

  // Ein Raster kann bis in zwei Nachbarjahre reichen — Dezember zeigt Tage im Januar.
  const holidays = holidayNames(weeks.flat().map((d) => d.getFullYear()));
  const withEvents = new Set((events ?? []).map((e) => dayKey(e.start)));

  const next = nextHoliday(today);
  const nextDays = next
    ? Math.round((startOfDay(next.date).getTime() - today.getTime()) / 86400000)
    : 0;

  const inMonth = weeks.flat().filter((d) => d.getMonth() === month);
  const spoken = inMonth
    .map((d) => ({ d, name: holidays.get(dayKey(d)) }))
    .filter((x): x is { d: Date; name: string } => x.name !== undefined)
    .map((x) => `${x.d.getDate()}. ${x.name}`);

  return (
    <div className="cal">
      <div className="cal-month">{monthFmt.format(now)}</div>

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
              return (
                <span className={cls} key={key} title={holiday}>{d.getDate()}</span>
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* Ein zurückliegender Feiertag steht nur noch als Farbe im Raster; sein Name
          erscheint beim Überfahren. Vorgelesen wird der ganze Monat auf einmal. */}
      <p className="sr-only">
        {spoken.length > 0 ? `Feiertage in diesem Monat: ${spoken.join(", ")}.` : "Keine Feiertage in diesem Monat."}
      </p>

      {next && (
        <div className="cal-next dim">
          {next.name}
          {"  ·  "}
          {dateFmt.format(next.date)}
          {"  ·  "}
          {inDaysText(nextDays)}
        </div>
      )}
    </div>
  );
}
