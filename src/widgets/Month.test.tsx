import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Month, monthLabel } from "./Month";
import type { CalEvent } from "../lib/ics";

function ev(start: Date): CalEvent {
  return { title: "Termin", start, end: new Date(start.getTime() + 3600_000), allDay: false };
}

// Der 7. August 2026 ist ein Freitag: der Monat beginnt an einem Samstag, das Raster
// braucht also eine führende Lücke und sechs Wochen.
const AUG_7 = new Date(2026, 7, 7, 9, 30);

describe("monthLabel", () => {
  // Der Monatsname steht im Pane-Titel, nicht mehr im Inhalt — sonst stünde eine
  // Überschrift in Größe und Gewicht der Datenzellen darunter.
  it("nennt Monat und Jahr", () => {
    expect(monthLabel(AUG_7)).toBe("August 2026");
  });
});

describe("Month", () => {

  it("zeigt jeden Tag des Monats genau einmal und keinen fremden", () => {
    const { container } = render(<Month now={AUG_7} />);
    const days = [...container.querySelectorAll(".cal-day")]
      .map((el) => el.textContent)
      .filter((t) => t !== "");
    expect(days).toHaveLength(31);
    expect(days[0]).toBe("1");
    expect(days[30]).toBe("31");
  });

  it("beginnt die Wochen montags und führt die Kalenderwoche mit", () => {
    const { container } = render(<Month now={AUG_7} />);
    const heads = [...container.querySelectorAll(".cal-head")].map((el) => el.textContent);
    expect(heads).toEqual(["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]);
    // KW 31 endet am Sonntag, dem 2. August; die erste Zeile des Rasters gehört dazu.
    const kw = [...container.querySelectorAll(".cal-kw")].map((el) => el.textContent);
    expect(kw).toEqual(["KW", "31", "32", "33", "34", "35", "36"]);
  });

  it("hebt heute hervor", () => {
    const { container } = render(<Month now={AUG_7} />);
    const today = container.querySelectorAll(".cal-day.is-today");
    expect(today).toHaveLength(1);
    expect(today[0]?.textContent).toBe("7");
  });

  it("färbt Feiertage und nennt sie im Titel", () => {
    // Oktober 2026: der 3. ist ein Samstag, Feiertag ist er trotzdem.
    const { container } = render(<Month now={new Date(2026, 9, 15)} />);
    const holidays = [...container.querySelectorAll(".cal-day.is-holiday")];
    expect(holidays.map((el) => el.textContent)).toEqual(["3"]);
    expect(holidays[0]?.getAttribute("title")).toBe("Tag der Deutschen Einheit");
  });

  it("markiert Tage mit Terminen", () => {
    const { container } = render(
      <Month now={AUG_7} events={[ev(new Date(2026, 7, 11, 10, 0)), ev(new Date(2026, 7, 11, 14, 0))]} />,
    );
    const marked = [...container.querySelectorAll(".cal-day.has-event")];
    expect(marked.map((el) => el.textContent)).toEqual(["11"]);
  });

  // Die Pane zeigt ausschließlich das Raster: kein Feiertagsname, kein Datum, keine
  // Fußzeile. Sichtbar ist ein Feiertag allein an der hervorgehobenen Zahl.
  it("zeigt außer dem Raster keinen Text", () => {
    const { container } = render(<Month now={new Date(2026, 9, 1)} />);
    const cal = container.querySelector(".cal");
    const visible = [...(cal?.children ?? [])].filter((el) => !el.classList.contains("sr-only"));
    expect(visible.map((el) => el.className)).toEqual(["cal-grid"]);
    // Der Name des Feiertags steht nur im title-Attribut und in der Screenreader-Zeile.
    expect(cal?.querySelector(".cal-grid")?.textContent).not.toContain("Tag der Deutschen Einheit");
    expect(cal?.querySelector(".cal-day.is-holiday")?.getAttribute("title")).toBe("Tag der Deutschen Einheit");
  });

  it("hat in einem Monat ohne Feiertag keine hervorgehobene Zahl", () => {
    const { container } = render(<Month now={AUG_7} />);
    expect(container.querySelector(".cal-day.is-holiday")).toBeNull();
  });
});
