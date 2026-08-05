import { describe, expect, it } from "vitest";
import { relativeTime, shortAge } from "./relativeTime";

const now = new Date("2026-08-05T12:00:00Z");
const minutesAway = (n: number) => new Date(now.getTime() + n * 60_000);

describe("relativeTime", () => {
  it("beschreibt die Vergangenheit", () => {
    expect(relativeTime(minutesAway(-20), now)).toBe("vor 20 min");
    expect(relativeTime(minutesAway(-3 * 60), now)).toBe("vor 3 h");
    expect(relativeTime(minutesAway(-2 * 24 * 60), now)).toBe("vor 2 d");
  });

  it("beschreibt die Zukunft, statt sie „gerade eben\" zu nennen", () => {
    expect(relativeTime(minutesAway(20), now)).toBe("in 20 min");
    expect(relativeTime(minutesAway(3 * 60), now)).toBe("in 3 h");
    expect(relativeTime(minutesAway(2 * 24 * 60), now)).toBe("in 2 d");
  });

  it("nennt den Augenblick gerade eben", () => {
    expect(relativeTime(now, now)).toBe("gerade eben");
    expect(relativeTime(minutesAway(0.4), now)).toBe("gerade eben");
  });
});

describe("shortAge", () => {
  it("rundet ab, damit die Angabe nicht jünger wirkt als die Daten sind", () => {
    expect(shortAge(minutesAway(-0.5), now)).toBe("30s");
    expect(shortAge(minutesAway(-1.9), now)).toBe("1m");
    expect(shortAge(minutesAway(-119), now)).toBe("1h");
    expect(shortAge(minutesAway(-47 * 60), now)).toBe("1d");
  });

  it("bleibt bei Uhrenversatz in der Zukunft bei 0s", () => {
    expect(shortAge(minutesAway(5), now)).toBe("0s");
  });
});
