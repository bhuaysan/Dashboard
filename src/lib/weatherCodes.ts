const CODES: Record<number, string> = {
  0: "klar",
  1: "überwiegend klar",
  2: "leicht bewölkt",
  3: "bedeckt",
  45: "Nebel",
  48: "Reifnebel",
  51: "Sprühregen leicht",
  53: "Sprühregen mäßig",
  55: "Sprühregen stark",
  56: "gefrierender Sprühregen",
  57: "gefrierender Sprühregen",
  61: "Regen leicht",
  63: "Regen mäßig",
  65: "Regen stark",
  66: "gefrierender Regen",
  67: "gefrierender Regen",
  71: "Schneefall leicht",
  73: "Schneefall mäßig",
  75: "Schneefall stark",
  77: "Schneegriesel",
  80: "Regenschauer leicht",
  81: "Regenschauer mäßig",
  82: "Regenschauer heftig",
  85: "Schneeschauer",
  86: "Schneeschauer",
  95: "Gewitter",
  96: "Gewitter mit Hagel",
  99: "Gewitter mit Hagel",
};

export function weatherText(code: number): string {
  return CODES[code] ?? "—";
}
