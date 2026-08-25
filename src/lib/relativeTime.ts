export function relativeTime(d: Date, now = new Date()): string {
  const min = Math.round((now.getTime() - d.getTime()) / 60000);
  const abs = Math.abs(min);
  if (abs < 1) return "gerade eben";
  // Zeitpunkte in der Zukunft gab es als „gerade eben" aus — etwa bei falscher Uhrzeit
  // auf dem Proxmox-Host.
  const span = (n: number, unit: string) => (min < 0 ? `in ${n} ${unit}` : `vor ${n} ${unit}`);
  if (abs < 60) return span(abs, "min");
  const h = Math.round(abs / 60);
  if (h < 24) return span(h, "h");
  return span(Math.round(h / 24), "d");
}

type AgeUnit = "s" | "m" | "h" | "d";

// Abgerundet, damit „12m" heißt: mindestens zwölf Minuten alt.
function agePart(from: Date, now: Date): { value: number; unit: AgeUnit } {
  const s = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (s < 60) return { value: s, unit: "s" };
  const m = Math.floor(s / 60);
  if (m < 60) return { value: m, unit: "m" };
  const h = Math.floor(m / 60);
  if (h < 24) return { value: h, unit: "h" };
  return { value: Math.floor(h / 24), unit: "d" };
}

// Kompakte Altersangabe für die Statusline: 45s, 12m, 3h, 2d.
export function shortAge(from: Date, now = new Date()): string {
  const { value, unit } = agePart(from, now);
  return `${value}${unit}`;
}

const UNIT_WORDS: Record<AgeUnit, [string, string]> = {
  s: ["Sekunde", "Sekunden"],
  m: ["Minute", "Minuten"],
  h: ["Stunde", "Stunden"],
  d: ["Tag", "Tagen"],
};

// Dieselbe Rechnung wie shortAge, nur ausgeschrieben — sonst stünde in der Anzeige „6m"
// und im Vorlesetext „vor 7 min".
export function spokenAge(from: Date, now = new Date()): string {
  const { value, unit } = agePart(from, now);
  if (value === 0) return "gerade eben";
  const words = UNIT_WORDS[unit];
  return `vor ${value} ${value === 1 ? words[0] : words[1]}`;
}
