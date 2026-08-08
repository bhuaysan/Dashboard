import { sparkline } from "../lib/sparkline";
import { weatherText } from "../lib/weatherCodes";
import { moonPhase } from "../lib/moon";
import { z } from "zod";

export type WeatherData = {
  temp: number;
  feels: number;
  code: number;
  hours: number[];
  rainPct: number;
  sunrise: string;
  sunset: string;
  daylight: number;        // Sekunden Tageslicht heute
  daylightTrend: number;   // Sekunden, die morgen länger (+) oder kürzer (−) hell ist
  days: { label: string; hi: number; lo: number; code: number }[];
};

const finiteNumber = z.number().finite();
function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const openMeteoSchema = z.object({
  timezone: z.string().refine(isTimezone),
  current: z.object({
    temperature_2m: finiteNumber,
    apparent_temperature: finiteNumber,
    weather_code: finiteNumber,
  }),
  hourly: z.object({
    time: z.array(finiteNumber).min(1).max(1000),
    temperature_2m: z.array(finiteNumber).min(1).max(1000),
    precipitation_probability: z.array(finiteNumber).min(1).max(1000),
  }),
  daily: z.object({
    time: z.array(finiteNumber).min(1).max(100),
    temperature_2m_min: z.array(finiteNumber).min(1).max(100),
    temperature_2m_max: z.array(finiteNumber).min(1).max(100),
    weather_code: z.array(finiteNumber).min(1).max(100),
    sunrise: z.array(finiteNumber).min(1).max(100),
    sunset: z.array(finiteNumber).min(1).max(100),
    daylight_duration: z.array(finiteNumber).min(1).max(100),
  }),
});

const weatherDataSchema = z.object({
  temp: finiteNumber,
  feels: finiteNumber,
  code: finiteNumber,
  hours: z.array(finiteNumber).max(1000),
  rainPct: finiteNumber,
  sunrise: z.string(),
  sunset: z.string(),
  daylight: finiteNumber,
  daylightTrend: finiteNumber,
  days: z.array(z.object({
    label: z.string(), hi: finiteNumber, lo: finiteNumber, code: finiteNumber,
  })).max(100),
});

export function decodeWeather(value: unknown): WeatherData | undefined {
  const parsed = weatherDataSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export async function fetchWeather(loc: { lat: number; lon: number }): Promise<WeatherData> {
  // timeformat=unixtime, weil die sonst gelieferten Zeitangaben ohne Zeitzone stehen und
  // der Browser sie als seine eigene deutet. timezone=auto richtet sich nach dem Ort,
  // die Antwort nennt die verwendete Zone.
  const target =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code` +
    `&hourly=temperature_2m,precipitation_probability` +
    `&daily=temperature_2m_min,temperature_2m_max,weather_code,sunrise,sunset,daylight_duration` +
    `&timezone=auto&timeformat=unixtime&forecast_days=5`;
  const res = await fetch(`/api/proxy?url=${encodeURIComponent(target)}`);
  if (!res.ok) throw new Error(`Wetter nicht ladbar (${res.status})`);
  const raw: unknown = await res.json();
  const parsed = openMeteoSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Wetterantwort ungültig");
  const j = parsed.data;

  const timeZone = j.timezone;
  const times = j.hourly?.time ?? [];
  const temps = j.hourly?.temperature_2m ?? [];
  const now = Date.now();
  let idx = times.findIndex((t) => t * 1000 > now) - 1;
  if (idx < 0) idx = 0;
  const hours = temps.slice(idx, idx + 12);
  const rainPct = j.hourly?.precipitation_probability?.[idx] ?? 0;

  const fmtTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone });
  const fmtDay = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone });
  const dayTimes = j.daily?.time ?? [];
  const days = dayTimes.map((t, i) => ({
    label: fmtDay.format(new Date(t * 1000)),
    hi: Math.round(j.daily?.temperature_2m_max?.[i] ?? 0),
    lo: Math.round(j.daily?.temperature_2m_min?.[i] ?? 0),
    code: j.daily?.weather_code?.[i] ?? -1,
  }));

  const sunrise = j.daily?.sunrise?.[0];
  const sunset = j.daily?.sunset?.[0];
  // Die tägliche Änderung aus heute und morgen statt aus gestern: das spart den Abruf
  // eines vergangenen Tages, der alle Indizes der Vorschau um eins verschieben würde.
  const daylight = j.daily?.daylight_duration?.[0] ?? 0;
  const daylightNext = j.daily?.daylight_duration?.[1] ?? daylight;
  return {
    temp: Math.round(j.current?.temperature_2m ?? 0),
    feels: Math.round(j.current?.apparent_temperature ?? 0),
    code: j.current?.weather_code ?? -1,
    hours,
    rainPct,
    sunrise: sunrise === undefined ? "—" : fmtTime.format(new Date(sunrise * 1000)),
    sunset: sunset === undefined ? "—" : fmtTime.format(new Date(sunset * 1000)),
    daylight: Math.round(daylight),
    daylightTrend: Math.round(daylightNext - daylight),
    days,
  };
}

function hoursMinutes(seconds: number): string {
  const total = Math.round(seconds / 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Der Unterschied liegt bei wenigen Minuten am Tag — Sekunden gehören dazu, sonst stünde
// um die Sonnenwende herum tagelang „0 min".
function trendText(seconds: number): string {
  const sign = seconds < 0 ? "−" : "+";
  const abs = Math.abs(Math.round(seconds));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")} min/Tag`;
}

export function Weather({ data, selIndex, now }: { data?: WeatherData; selIndex: number; now: Date }) {
  void selIndex;
  if (!data) return <div className="dim">noch keine Wetterdaten</div>;
  const moon = moonPhase(now);
  // Ein Raster für alles: Kennwort, zwei Zahlenspalten, Text. Vorher hatte jede der drei
  // oberen Zeilen eigene Spaltenpositionen und die Tagestabelle wieder andere — zwölf
  // linke Textkanten in einer Pane. Die Haarlinien trennen die drei Gruppen, damit
  // „jetzt" nicht als sechster Wochentag gelesen wird.
  return (
    <div className="wx">
      <div className="wx-row">
        <span className="wx-key">jetzt</span>
        <span className="wx-temp">{data.temp}°</span>
        <span className="wx-note">{weatherText(data.code)}, gefühlt {data.feels}°</span>
      </div>
      <div className="wx-row">
        <span className="wx-key">12 h</span>
        <span
          className="wx-wide spark"
          aria-label={`Temperatur der nächsten 12 Stunden: ${data.hours.map((h) => Math.round(h)).join(", ")} Grad`}
        >
          {sparkline(data.hours)}
        </span>
        <span className="wx-note">Regen {data.rainPct} %</span>
      </div>

      <div className="wx-sep" />

      {data.days.map((d, i) => (
        <div className="wx-row" key={i}>
          {/* Der erste Tag der Vorhersage ist derselbe wie die „jetzt"-Zeile darüber.
              Ausgeschrieben als „heute" liest sich das als Bezug statt als Dopplung. */}
          <span className="wx-key">{i === 0 ? "heute" : d.label}</span>
          <span className="wx-val">{d.hi}°</span>
          <span className="wx-val wx-val--lo">{d.lo}°</span>
          <span className="wx-note">{weatherText(d.code)}</span>
        </div>
      ))}

      <div className="wx-sep" />

      <div className="wx-row">
        <span className="wx-key">Sonne</span>
        <span className="wx-val">↑ {data.sunrise}</span>
        <span className="wx-val">↓ {data.sunset}</span>
        {/* Aus einem älteren Zwischenspeicher kommt noch kein daylight_duration —
            dann bleibt die Spalte eben leer, bis der nächste Abruf durch ist. */}
        <span className="wx-note">
          {data.daylight > 0 ? `${hoursMinutes(data.daylight)} h hell, ${trendText(data.daylightTrend)}` : ""}
        </span>
      </div>
      <div className="wx-row">
        <span className="wx-key">Mond</span>
        <span className="wx-wide">{moon.glyph} {moon.illum} %</span>
        <span className="wx-note">{moon.name}</span>
      </div>
    </div>
  );
}
