import { describe, expect, it } from "vitest";
import { dayKey, eventFetchRange } from "./date";

describe("eventFetchRange", () => {
  it("beginnt am sichtbaren Monatsraster und reicht mindestens über die Agenda", () => {
    const range = eventFetchRange(new Date(2026, 4, 31), 4);
    expect(dayKey(range.from)).toBe("2026-04-27");
    expect(range.to.getTime()).toBeGreaterThanOrEqual(new Date(2026, 5, 4).getTime());
  });
});
