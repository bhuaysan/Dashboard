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

  it("weist 200-Antworten mit nicht passenden Feldlängen ab", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      timezone: "Europe/Berlin",
      current: { temperature_2m: 20, apparent_temperature: 20, weather_code: 1 },
      hourly: { time: [0, 1], temperature_2m: [20], precipitation_probability: [0, 0] },
      daily: {
        time: [0], temperature_2m_min: [10], temperature_2m_max: [20], weather_code: [1],
        sunrise: [0], sunset: [1], daylight_duration: [2],
      },
    }), { status: 200 })));
    await expect(fetchWeather({ lat: 49, lon: 9 })).rejects.toThrow("Wetterantwort ungültig");
  });

  it("weist nicht darstellbare Unix-Zeitstempel ab", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      timezone: "Europe/Berlin",
      current: { temperature_2m: 20, apparent_temperature: 20, weather_code: 1 },
      hourly: { time: [1e300], temperature_2m: [20], precipitation_probability: [0] },
      daily: {
        time: [0], temperature_2m_min: [10], temperature_2m_max: [20], weather_code: [1],
        sunrise: [0], sunset: [1], daylight_duration: [2],
      },
    }), { status: 200 })));
    await expect(fetchWeather({ lat: 49, lon: 9 })).rejects.toThrow("Wetterantwort ungültig");
  });
});
