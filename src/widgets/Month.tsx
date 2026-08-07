import { Fragment } from "react";
import type { CalEvent } from "../lib/ics";
import { dayKey, isoWeek, monthGrid, startOfDay } from "../lib/date";
import { holidayNames, nextHolidays } from "../lib/holidays";

// Feste Kürzel statt Intl: die Spalten sind zeichenbreit gesetzt, und ob eine Locale
// ihre Kurzform mit Punkt liefert, entschiede sonst über die Ausrichtung des Rasters.
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const dateFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" });

export function monthLabel(d: Date): string {
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(d);
}

// „in 56 Tagen" passt neben dem Datum nicht in die Spalte. „d" für Tage steht ohnehin
// schon in der Statusline und in der Homelab-Laufzeit — dieselbe Abkürzung, keine neue.
function inDaysText(days: number): string {
  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  return `in ${days} d`;
}

export function Month({ now, events }: { now: Date; events?: CalEvent[] }) {
  const { weeks } = monthGrid(now);
  const today = startOfDay(now);
  const todayKey = dayKey(today);
  const month = now.getMonth();

  // Ein Raster kann bis in zwei Nachbarjahre reichen — Dezember zeigt Tage im Januar.
  const holidays = holidayNames(weeks.flat().map((d) => d.getFullYear()));
  const withEvents = new Set((events ?? []).map((e) => dayKey(e.start)));

  // Vier: so hoch wie das Raster daneben, und weit genug voraus, dass die Liste auch im
  // August etwas zeigt — NRW hat in vier Monaten des Jahres keinen einzigen Feiertag.
  const upcoming = nextHolidays(today, 4);

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
              return (
                <span className={cls} key={key} title={holiday}>{d.getDate()}</span>
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* Das Raster ist rund 250 px breit, die Pane doppelt so breit. Statt die Fläche
          leer zu lassen oder die Spalten auseinanderzuziehen, steht rechts, was das
          Raster nicht zeigen kann: die nächsten freien Tage, auch über den Monat hinaus. */}
      <div className="cal-side">
        <div className="group-label">Feiertage</div>
        <ul className="cal-hol">
          {upcoming.map((h) => (
            <li key={dayKey(h.date)}>
              <div>{h.name}</div>
              <div className="cal-when">
                <span>{dateFmt.format(h.date)}</span>
                <span>
                  {inDaysText(Math.round((startOfDay(h.date).getTime() - today.getTime()) / 86400000))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Im Raster stehen für einen Screenreader nur Zahlen — ohne diese Zeile bliebe
          ein zurückliegender Feiertag des Monats unhörbar. Sichtbar nennt ihn der
          `title` der Zelle, angekündigt werden nur die kommenden rechts daneben. */}
      <p className="sr-only">
        {spoken.length > 0 ? `Feiertage in diesem Monat: ${spoken.join(", ")}.` : "Keine Feiertage in diesem Monat."}
      </p>
    </div>
  );
}
