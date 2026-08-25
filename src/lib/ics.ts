import ICAL from "ical.js";

export type CalEvent = { title: string; start: Date; end: Date; allDay: boolean };

export const MAX_RECURRENCE_OPERATIONS = 10_000;
export const MAX_RECURRENCE_MILLISECONDS = 1_000;

export type IcsParseOptions = {
  maxRecurrenceOperations?: number;
  maxRecurrenceMilliseconds?: number;
};

export class RecurrenceExpansionError extends Error {
  constructor() {
    super("Serientermin überschreitet das Expansionsbudget");
    this.name = "RecurrenceExpansionError";
  }
}

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

function recurrenceIdKey(event: ICAL.Event): number {
  return event.recurrenceId.toUnixTime();
}

export function overlapsRange(start: Date, end: Date, from: Date, to: Date): boolean {
  // DTEND ist exklusiv. Ein echter Null-Dauer-Termin ist dagegen ein Zeitpunkt und
  // bleibt innerhalb des Fensters sichtbar.
  if (end.getTime() === start.getTime()) return start >= from && start <= to;
  return end > from && start <= to;
}

type EventGroup = { master?: ICAL.Component; exceptions: ICAL.Component[] };

function expansionEnd(to: Date, exceptions: ICAL.Component[]): Date {
  let end = to;
  for (const component of exceptions) {
    const recurrenceId = new ICAL.Event(component).recurrenceId.toJSDate();
    if (recurrenceId > end) end = recurrenceId;
  }
  return end;
}

export function parseIcs(text: string, from: Date, to: Date, options: IcsParseOptions = {}): CalEvent[] {
  const comp = new ICAL.Component(ICAL.parse(text));
  const out: CalEvent[] = [];
  const groups = new Map<string, EventGroup>();
  const components = comp.getAllSubcomponents("vevent");
  const maxRecurrenceOperations = options.maxRecurrenceOperations ?? MAX_RECURRENCE_OPERATIONS;
  const maxRecurrenceMilliseconds = options.maxRecurrenceMilliseconds ?? MAX_RECURRENCE_MILLISECONDS;

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

    const activeExceptions: ICAL.Component[] = [];
    const cancelledRecurrenceIds = new Set<number>();
    for (const exceptionComponent of group.exceptions) {
      const exception = new ICAL.Event(exceptionComponent);
      if (isCancelled(exception)) {
        cancelledRecurrenceIds.add(recurrenceIdKey(exception));
      } else {
        activeExceptions.push(exceptionComponent);
      }
    }

    const event = new ICAL.Event(master, {
      strictExceptions: true,
      exceptions: activeExceptions,
    });
    if (isCancelled(event)) continue;

    if (event.isRecurring()) {
      const it = event.iterator();
      const expansionTo = expansionEnd(to, group.exceptions);
      const expansionStartedAt = performance.now();
      let operations = 0;
      for (let next = it.next(); next; next = it.next()) {
        const occurrenceStart = next.toJSDate();
        if (occurrenceStart > expansionTo) break;
        if (operations >= maxRecurrenceOperations ||
            performance.now() - expansionStartedAt >= maxRecurrenceMilliseconds) {
          throw new RecurrenceExpansionError();
        }
        operations += 1;
        // Eine Exception darf die tatsächliche Zeit verschieben. Deshalb wird bis
        // zum letzten RECURRENCE-ID-Eintrag expandiert, nicht nur bis zur normalen
        // Serienzeit im sichtbaren Fenster.
        if (cancelledRecurrenceIds.has(next.toUnixTime())) continue;

        const details = event.getOccurrenceDetails(next);
        const item = details.item;
        if (isCancelled(item)) continue;
        const start = details.startDate.toJSDate();
        const occurrenceEnd = details.endDate.toJSDate();
        if (overlapsRange(start, occurrenceEnd, from, to)) out.push(toCalEvent(item, start, occurrenceEnd));
      }
    } else {
      const start = event.startDate.toJSDate();
      const end = event.endDate.toJSDate();
      if (overlapsRange(start, end, from, to)) out.push(toCalEvent(event, start, end));
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
