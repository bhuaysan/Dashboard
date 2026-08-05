import { sparkline } from "../lib/sparkline";
import { weatherText } from "../lib/weatherCodes";

export type WeatherData = {
  temp: number;
  feels: number;
  code: number;
  hours: number[];
  rainPct: number;
  sunrise: string;
  sunset: string;
  days: { label: string; hi: number; lo: number; code: number }[];
};

type OpenMeteo = {
  current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number };
  hourly?: { time?: string[]; temperature_2m?: number[]; precipitation_probability?: number[] };
  daily?: {
    time?: string[];
    temperature_2m_min?: number[];
    temperature_2m_max?: number[];
    weather_code?: number[];
    sunrise?: string[];
    sunset?: string[];
  };
};

export async function fetchWeather(loc: { lat: number; lon: number }): Promise<WeatherData> {
  const target =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code` +
    `&hourly=temperature_2m,precipitation_probability` +
    `&daily=temperature_2m_min,temperature_2m_max,weather_code,sunrise,sunset` +
    `&timezone=Europe%2FBerlin&forecast_days=5`;
  const res = await fetch(`/api/proxy?url=${encodeURIComponent(target)}`);
  if (!res.ok) throw new Error(`Wetter nicht ladbar (${res.status})`);
  const j = (await res.json()) as OpenMeteo;

  const times = j.hourly?.time ?? [];
  const temps = j.hourly?.temperature_2m ?? [];
  const now = Date.now();
  let idx = times.findIndex((t) => new Date(t).getTime() > now) - 1;
  if (idx < 0) idx = 0;
  const hours = temps.slice(idx, idx + 12);
  const rainPct = j.hourly?.precipitation_probability?.[idx] ?? 0;

  const fmtTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
  const fmtDay = new Intl.DateTimeFormat("de-DE", { weekday: "short" });
  const dayTimes = j.daily?.time ?? [];
  const days = dayTimes.map((t, i) => ({
    label: fmtDay.format(new Date(`${t}T12:00:00`)),
    hi: Math.round(j.daily?.temperature_2m_max?.[i] ?? 0),
    lo: Math.round(j.daily?.temperature_2m_min?.[i] ?? 0),
    code: j.daily?.weather_code?.[i] ?? -1,
  }));

  return {
    temp: Math.round(j.current?.temperature_2m ?? 0),
    feels: Math.round(j.current?.apparent_temperature ?? 0),
    code: j.current?.weather_code ?? -1,
    hours,
    rainPct,
    sunrise: j.daily?.sunrise?.[0] ? fmtTime.format(new Date(j.daily.sunrise[0])) : "—",
    sunset: j.daily?.sunset?.[0] ? fmtTime.format(new Date(j.daily.sunset[0])) : "—",
    days,
  };
}

export function Weather({ data, selIndex }: { data?: WeatherData; selIndex: number }) {
  void selIndex;
  if (!data) return <div className="dim">noch keine Wetterdaten</div>;
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
