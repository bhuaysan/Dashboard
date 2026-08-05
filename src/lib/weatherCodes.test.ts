import { describe, expect, it } from "vitest";
import { weatherText } from "./weatherCodes";

describe("weatherText", () => {
  it("kennt bekannte Codes", () => {
    expect(weatherText(2)).toBe("leicht bewölkt");
    expect(weatherText(95)).toBe("Gewitter");
  });

  it("unbekannter Code ergibt einen Platzhalter", () => {
    expect(weatherText(999)).toBe("—");
  });
});
