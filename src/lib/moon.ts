export type MoonPhase = {
  fraction: number;   // 0 = Neumond, 0,5 = Vollmond, 1 = wieder Neumond
  illum: number;      // beleuchteter Anteil der Scheibe in Prozent
  waxing: boolean;
  name: string;
  glyph: string;
};

const SYNODIC_DAYS = 29.530588853;
// Neumond vom 6. Januar 2000, 18:14 UTC — der übliche Bezugspunkt. Die Rechnung
// ignoriert die Bahnstörungen und geht damit über Jahre um wenige Stunden falsch.
// Für „zunehmend, 62 %" auf einer Startseite reicht das; alles Genauere wäre eine Library.
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

export function moonPhase(now: Date): MoonPhase {
  const days = (now.getTime() - NEW_MOON) / 86_400_000;
  const fraction = (((days / SYNODIC_DAYS) % 1) + 1) % 1;
  const illum = Math.round(((1 - Math.cos(2 * Math.PI * fraction)) / 2) * 100);
  const waxing = fraction < 0.5;

  // Nur vier Namen: die Prozentangabe daneben trägt die Feinheit, und „zunehmender
  // Dreiviertelmond" wäre in einer Zeile mit Sonnenauf- und -untergang zu viel.
  // Rund ein Tag um den exakten Termin herum heißt Neumond bzw. Vollmond. Enger geht
  // nicht: die Näherung oben liegt um bis zu einen halben Tag daneben, ein Fenster von
  // wenigen Stunden würde den Vollmond schlicht verpassen.
  let name = waxing ? "zunehmend" : "abnehmend";
  let glyph = "◐";
  if (fraction < 0.035 || fraction >= 0.965) {
    name = "Neumond";
    glyph = "○";
  } else if (fraction >= 0.465 && fraction < 0.535) {
    name = "Vollmond";
    glyph = "●";
  }
  return { fraction, illum, waxing, name, glyph };
}
