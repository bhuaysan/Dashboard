import ICAL from "ical.js";

export type CalEvent = { title: string; start: Date; end: Date; allDay: boolean };

function toCalEvent(event: ICAL.Event, start: Date, end: Date): CalEvent {
  return {
    title: event.summary || "(ohne Titel)",
    start,
    end,
    allDay: event.startDate.isDate,
  };
}

export function parseIcs(text: string, from: Date, to: Date): CalEvent[] {
  const comp = new ICAL.Component(ICAL.parse(text));
  const out: CalEvent[] = [];
  for (const vevent of comp.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(vevent);
    if (event.isRecurring()) {
      const it = event.iterator();
      for (let next = it.next(); next; next = it.next()) {
        const start = next.toJSDate();
        if (start > to) break;
        if (start >= from) {
          const d = event.getOccurrenceDetails(next);
          out.push(toCalEvent(event, d.startDate.toJSDate(), d.endDate.toJSDate()));
        }
      }
    } else {
      const start = event.startDate.toJSDate();
      if (start >= from && start <= to) {
        out.push(toCalEvent(event, start, event.endDate.toJSDate()));
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
