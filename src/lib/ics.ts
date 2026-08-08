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

function componentUid(component: ICAL.Component): string | undefined {
  const value = component.getFirstPropertyValue("uid");
  return typeof value === "string" && value !== "" ? value : undefined;
}

function isCancelled(event: ICAL.Event): boolean {
  const value = event.component.getFirstPropertyValue("status");
  return typeof value === "string" && value.toUpperCase() === "CANCELLED";
}

function overlaps(start: Date, end: Date, from: Date, to: Date): boolean {
  return end >= from && start <= to;
}

type EventGroup = { master?: ICAL.Component; exceptions: ICAL.Component[] };

const MAX_OCCURRENCES = 100_000;

function expansionEnd(to: Date, exceptions: ICAL.Component[]): Date {
  let end = to;
  for (const component of exceptions) {
    const recurrenceId = new ICAL.Event(component).recurrenceId.toJSDate();
    if (recurrenceId > end) end = recurrenceId;
  }
  return end;
}

export function parseIcs(text: string, from: Date, to: Date): CalEvent[] {
  const comp = new ICAL.Component(ICAL.parse(text));
  const out: CalEvent[] = [];
  const groups = new Map<string, EventGroup>();
  const components = comp.getAllSubcomponents("vevent");

  components.forEach((vevent, index) => {
    const uid = componentUid(vevent) ?? `anonymous-${index}`;
    const group = groups.get(uid) ?? { exceptions: [] };
    if (vevent.hasProperty("recurrence-id")) group.exceptions.push(vevent);
    else if (group.master === undefined) group.master = vevent;
    groups.set(uid, group);
  });

  for (const group of groups.values()) {
    const master = group.master;
    // Eine verwaiste RECURRENCE-ID ist kein eigenständiger Termin. Sie wird
    // bewusst ignoriert, statt einer anderen Serie zugeordnet zu werden.
    if (master === undefined) continue;

    const event = new ICAL.Event(master, {
      strictExceptions: true,
      exceptions: group.exceptions,
    });
    if (isCancelled(event)) continue;

    if (event.isRecurring()) {
      const it = event.iterator();
      const expansionTo = expansionEnd(to, group.exceptions);
      let count = 0;
      for (let next = it.next(); next && count < MAX_OCCURRENCES; next = it.next()) {
        count += 1;
        const occurrenceStart = next.toJSDate();
        // Eine Exception darf die tatsächliche Zeit verschieben. Deshalb wird bis
        // zum letzten RECURRENCE-ID-Eintrag expandiert, nicht nur bis zur normalen
        // Serienzeit im sichtbaren Fenster.
        if (occurrenceStart > expansionTo) break;

        const details = event.getOccurrenceDetails(next);
        const item = details.item;
        if (isCancelled(item)) continue;
        const start = details.startDate.toJSDate();
        const occurrenceEnd = details.endDate.toJSDate();
        if (overlaps(start, occurrenceEnd, from, to)) out.push(toCalEvent(item, start, occurrenceEnd));
      }
    } else {
      const start = event.startDate.toJSDate();
      const end = event.endDate.toJSDate();
      if (overlaps(start, end, from, to)) out.push(toCalEvent(event, start, end));
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
