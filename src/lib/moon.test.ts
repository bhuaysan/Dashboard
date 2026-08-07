import { describe, expect, it } from "vitest";
import { moonPhase } from "./moon";

describe("moonPhase", () => {
  // Termine aus dem Almanach. Die Näherung darf um Stunden danebenliegen, aber nicht um
  // eine halbe Phase — deshalb wird der Name geprüft und nicht die dritte Nachkommastelle.
  it("erkennt Neumond und Vollmond", () => {
    expect(moonPhase(new Date("2026-08-12T17:39:00Z")).name).toBe("Neumond");
    expect(moonPhase(new Date("2026-08-28T04:20:00Z")).name).toBe("Vollmond");
    expect(moonPhase(new Date("2026-04-17T11:54:00Z")).name).toBe("Neumond");
    expect(moonPhase(new Date("2026-11-24T14:54:00Z")).name).toBe("Vollmond");
  });

  it("unterscheidet zunehmend und abnehmend", () => {
    const waxing = moonPhase(new Date("2026-08-20T12:00:00Z"));
    expect(waxing.name).toBe("zunehmend");
    expect(waxing.waxing).toBe(true);

    const waning = moonPhase(new Date("2026-09-04T12:00:00Z"));
    expect(waning.name).toBe("abnehmend");
    expect(waning.waxing).toBe(false);
  });

  it("gibt die Beleuchtung als Prozent zwischen 0 und 100", () => {
    for (let d = 0; d < 30; d += 1) {
      const { illum } = moonPhase(new Date(2026, 7, 1 + d));
      expect(illum).toBeGreaterThanOrEqual(0);
      expect(illum).toBeLessThanOrEqual(100);
    }
    expect(moonPhase(new Date("2026-08-12T17:39:00Z")).illum).toBeLessThan(3);
    expect(moonPhase(new Date("2026-08-28T04:20:00Z")).illum).toBeGreaterThan(97);
  });
});
