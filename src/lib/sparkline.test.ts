import { describe, expect, it } from "vitest";
import { bar, sparkline } from "./sparkline";

describe("sparkline", () => {
  it("gleiche Werte ergeben die Mittelstufe", () => {
    expect(sparkline([5, 5, 5])).toBe("▄▄▄");
  });

  it("ein einzelner Wert ergibt eine Mittelstufe", () => {
    expect(sparkline([42])).toBe("▄");
  });

  it("leeres Array ergibt leere Zeichenkette", () => {
    expect(sparkline([])).toBe("");
  });

  it("negative Werte werden relativ skaliert", () => {
    expect(sparkline([-10, 0, 10])).toBe("▁▄▇");
  });
});

describe("bar", () => {
  it("0 Prozent ist leer", () => {
    expect(bar(0)).toBe("░".repeat(13));
  });

  it("50 Prozent ist halb voll", () => {
    expect(bar(50)).toBe("█".repeat(7) + "░".repeat(6));
  });

  it("100 Prozent ist voll", () => {
    expect(bar(100)).toBe("█".repeat(13));
  });
});
