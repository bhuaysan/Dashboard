import type { Config } from "../config/schema";
import { parseIcs, type CalEvent } from "../lib/ics";

export type { CalEvent };

export function reviveEvents(events: CalEvent[]): CalEvent[] {
  return events.map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) }));
}

export async function fetchEvents(cals: Config["calendars"]): Promise<CalEvent[]> {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 4);
  to.setMilliseconds(-1);

  const all: CalEvent[] = [];
  let failed = 0;
  await Promise.all(cals.map(async (cal) => {
    try {
      const url = cal.url.startsWith("/")
        ? cal.url
        : `/api/proxy?url=${encodeURIComponent(cal.url)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      all.push(...parseIcs(await res.text(), from, to));
    } catch {
      failed += 1;   // ein kaputter Kalender blockiert die anderen nicht
    }
  }));
  // Fällt jeder Kalender aus, ist das ein Fehler und kein leerer Terminplan.
  if (cals.length > 0 && failed === cals.length) throw new Error("Kein Kalender erreichbar");
  return all.sort((a, b) => a.start.getTime() - b.start.getTime());
}

type Group = { label: string; events: { ev: CalEvent; index: number }[] };

function groupEvents(events: CalEvent[]): Group[] {
  const fmtDay = new Intl.DateTimeFormat("de-DE", { weekday: "long" });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const groups = new Map<number, Group>();
  events.forEach((ev, index) => {
    const day = new Date(ev.start);
    day.setHours(0, 0, 0, 0);
    const key = day.getTime();
    const diff = Math.round((key - today.getTime()) / 86400000);
    const label = diff === 0 ? "heute" : diff === 1 ? "morgen" : fmtDay.format(day);
    let g = groups.get(key);
    if (!g) {
      g = { label, events: [] };
      groups.set(key, g);
    }
    g.events.push({ ev, index });
  });
  for (const g of groups.values()) {
    g.events.sort((a, b) => Number(b.ev.allDay) - Number(a.ev.allDay));
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
}

export function Agenda({ events, selIndex, calendarCount }: { events?: CalEvent[]; selIndex: number; calendarCount: number }) {
  if (!events) return <div className="dim">noch keine Termine</div>;
  if (events.length === 0) {
    return (
      <div className="dim">
        {calendarCount === 0 ? "keine Kalender eingetragen" : "keine Termine in den nächsten Tagen"}
      </div>
    );
  }
  const now = new Date();
  const fmtTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
  return (
    <>
      {groupEvents(events).map((g) => (
        <div key={g.label}>
          <div className="group-label">{g.label}</div>
          {g.events.map(({ ev, index }) => {
            const isNow = !ev.allDay && ev.start <= now && now < ev.end;
            const isPast = !isNow && ev.end < now;
            const cls = [
              "ev",
              isPast ? "is-past" : "",
              isNow ? "is-now" : "",
              index === selIndex ? "is-sel" : "",
            ].filter(Boolean).join(" ");
            return (
              <div key={index} className={cls} data-row>
                <span className="ev-time">
                  {ev.allDay ? "ganztägig" : `${fmtTime.format(ev.start)} ${fmtTime.format(ev.end)}`}
                </span>
                <span className="ev-title">{ev.title}</span>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
