import { describe, expect, it } from "vitest";

// Token-Werte aus PLAN.md Abschnitt 5 — der Test prüft, dass sie WCAG AA erfüllen.
// Schlägt er an, wurde ein Token verändert und muss zurückgenommen werden.

const DARK = {
  bg: "#21262E", "bg-alt": "#191D24", "bg-sel": "#2B323C",
  border: "#2F3846", "border-strong": "#5E708C",
  fg: "#CBD3DE", dim: "#929CA9", accent: "#7FA7C4",
  ok: "#8FB58A", warn: "#D9B36C", crit: "#CC8985",
};
const LIGHT = {
  bg: "#E9EAE4", "bg-alt": "#DCDDD5", "bg-sel": "#CFD1C8",
  border: "#C4C6BC", "border-strong": "#848874",
  fg: "#23262B", dim: "#535860", accent: "#2B5C7E",
  ok: "#396034", warn: "#70510D", crit: "#96322C",
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const TEXT_COLORS = ["fg", "dim", "accent", "ok", "warn", "crit"] as const;

describe("Kontraste (WCAG AA)", () => {
  for (const [name, theme] of [["dark", DARK], ["light", LIGHT]] as const) {
    describe(name, () => {
      for (const color of TEXT_COLORS) {
        it(`${color} auf bg >= 4.5:1`, () => {
          expect(contrast(theme[color], theme.bg)).toBeGreaterThanOrEqual(4.5);
        });
        it(`${color} auf bg-sel >= 4.5:1`, () => {
          expect(contrast(theme[color], theme["bg-sel"])).toBeGreaterThanOrEqual(4.5);
        });
      }
      it("border-strong auf bg >= 3:1", () => {
        expect(contrast(theme["border-strong"], theme.bg)).toBeGreaterThanOrEqual(3);
      });
    });
  }
});
