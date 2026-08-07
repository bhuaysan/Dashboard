import { sparkline } from "../lib/sparkline";
import { weatherText } from "../lib/weatherCodes";
import { moonPhase } from "../lib/moon";

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

type OpenMeteo = {
  timezone?: string;
  current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number };
  hourly?: { time?: number[]; temperature_2m?: number[]; precipitation_probability?: number[] };
  daily?: {
    time?: number[];
    temperature_2m_min?: number[];
    temperature_2m_max?: number[];
    weather_code?: number[];
    sunrise?: number[];
    sunset?: number[];
    daylight_duration?: number[];
  };
};

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
  const j = (await res.json()) as OpenMeteo;

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
  // Bei Neu- und Vollmond sagt der Name schon alles; „Vollmond, 100 %" wäre doppelt.
  const moonText = moon.name === "Neumond" || moon.name === "Vollmond"
    ? moon.name
    : `${moon.name}, ${moon.illum} %`;
  return (
    <div className="wx">
      <div className="wx-main">
        <div className="wx-now">
          <span className="wx-temp">{data.temp}°</span>
          <span className="dim">gefühlt {data.feels}°</span>
          <span>{weatherText(data.code)}</span>
        </div>
        <div className="wx-line">
          <span
            className="spark"
            aria-label={`Temperatur der nächsten 12 Stunden: ${data.hours.map((h) => Math.round(h)).join(", ")} Grad`}
          >
            {sparkline(data.hours)}
          </span>
          <span className="dim">nächste 12 h</span>
          <span className="dim">Regen {data.rainPct} %</span>
        </div>
        <div className="wx-line dim">
          <span>↑ {data.sunrise}</span>
          <span>↓ {data.sunset}</span>
          {/* Aus einem älteren Zwischenspeicher kommt noch kein daylight_duration —
              dann bleibt die Zeile eben kürzer, bis der nächste Abruf durch ist. */}
          {data.daylight > 0 && <span>{hoursMinutes(data.daylight)} h Tageslicht</span>}
          {data.daylight > 0 && <span>{trendText(data.daylightTrend)}</span>}
          <span>{moon.glyph} {moonText}</span>
        </div>
      </div>
      <div className="wx-days">
        {data.days.map((d, i) => (
          <div className="wx-day" key={i}>
            <span className="dim">{d.label}</span>
            <span className="hi">{d.hi}°</span>
            <span className="lo">{d.lo}°</span>
            <span className="dim">{weatherText(d.code)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
