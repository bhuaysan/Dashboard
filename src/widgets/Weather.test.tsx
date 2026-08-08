import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeWeather, fetchWeather } from "./Weather";

afterEach(() => vi.unstubAllGlobals());

describe("Weather-Antworten", () => {
  it("verwirft eine strukturell leere Cacheantwort", () => {
    expect(decodeWeather({})).toBeUndefined();
  });

  it("meldet eine malformed 200-Antwort als Quellenfehler", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await expect(fetchWeather({ lat: 49, lon: 9 })).rejects.toThrow("Wetterantwort ungültig");
  });
});
