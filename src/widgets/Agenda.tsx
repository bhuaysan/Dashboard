import { isSafeLocalCalendarPath, type Config } from "../config/schema";
import { overlapsRange, parseIcs, type CalEvent } from "../lib/ics";
import { z } from "zod";

export type { CalEvent };
export type EventFetchResult = { items: CalEvent[]; failures: string[] };

const cachedEventSchema = z.object({
  title: z.string(),
  start: z.string().refine((value) => !Number.isNaN(new Date(value).getTime())).transform((value) => new Date(value)),
  end: z.string().refine((value) => !Number.isNaN(new Date(value).getTime())).transform((value) => new Date(value)),
  allDay: z.boolean(),
}).superRefine((event, ctx) => {
  if (event.end < event.start) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Terminende liegt vor dem Beginn" });
});
const eventFetchResultSchema = z.object({
  items: z.array(cachedEventSchema),
  failures: z.array(z.string()),
});

export function decodeEvents(value: unknown): EventFetchResult | undefined {
  const parsed = eventFetchResultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

type CalendarSourceResult = { items: CalEvent[]; failure?: string };

// `from` und `to` kommen von außen, weil zwei Panes dieselben Termine brauchen: die
// Agenda die nächsten Tage, das Monatsraster den ganzen sichtbaren Monat. Der optionale
// Rückwärts-kompatible Aufruf mit nur `to` bleibt für direkte Verbraucher erhalten.
export async function fetchEvents(
  cals: Config["calendars"],
  fromOrTo: Date,
  maybeTo?: Date,
): Promise<EventFetchResult> {
  const from = maybeTo === undefined ? (() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start;
  })() : fromOrTo;
  const to = maybeTo ?? fromOrTo;

  const results = await Promise.all(cals.map(async (cal): Promise<CalendarSourceResult> => {
    try {
      const url = isSafeLocalCalendarPath(cal.url)
        ? cal.url
        : `/api/proxy?url=${encodeURIComponent(cal.url)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { items: parseIcs(await res.text(), from, to) };
    } catch {
      return { items: [], failure: cal.label };   // ein kaputter Kalender blockiert die anderen nicht
    }
  }));
  const failures = results.flatMap((result) => result.failure === undefined ? [] : [result.failure]);
  // Fällt jeder Kalender aus, ist das ein Fehler und kein leerer Terminplan.
  if (cals.length > 0 && failures.length === cals.length) throw new Error("Kein Kalender erreichbar");
  return {
    items: results.flatMap((result) => result.items)
      .sort((a, b) => a.start.getTime() - b.start.getTime()),
    failures,
  };
}

export function filterAgendaEvents(events: CalEvent[], now: Date, days = 4): CalEvent[] {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + days);
  to.setMilliseconds(-1);
  return events.filter((event) => overlapsRange(event.start, event.end, from, to));
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

export function Agenda({ events, failures = [], selIndex, calendarCount }: {
  events?: CalEvent[];
  failures?: string[];
  selIndex: number;
  calendarCount: number;
}) {
  const warning = failures.length > 0
    ? <div className="dim source-warning">Kalender nicht erreichbar: {failures.join(", ")}</div>
    : null;
  if (!events) return <div className="dim">noch keine Termine</div>;
  if (events.length === 0) {
    return (
      <>{warning}<div className="dim">
        {calendarCount === 0 ? "keine Kalender eingetragen" : "keine Termine in den nächsten Tagen"}
      </div></>
    );
  }
  const now = new Date();
  const fmtTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
  return (
    <>
      {warning}
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
