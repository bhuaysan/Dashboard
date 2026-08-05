import { describe, expect, it } from "vitest";
import { sparkline } from "./sparkline";

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
