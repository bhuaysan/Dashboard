import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusLine } from "./StatusLine";

const panes = [{ n: 1, label: "clock", active: true }];

describe("StatusLine", () => {
  it("zeigt das Alter jeder Quelle", () => {
    render(
      <StatusLine
        mode="NORMAL"
        panes={panes}
        sources={[
          { label: "wx", state: "ok", updatedAt: Date.now() - 4 * 60_000 },
          { label: "news", state: "warn", updatedAt: Date.now() - 3 * 3600_000 },
        ]}
        clock="23:42"
      />,
    );
    expect(screen.getByText("4m")).toBeTruthy();
    expect(screen.getByText("3h")).toBeTruthy();
    expect(screen.getByLabelText(/wx: in Ordnung, geladen vor 4 min/)).toBeTruthy();
  });

  it("nennt eine Quelle ohne Daten ausdrücklich", () => {
    render(
      <StatusLine mode="NORMAL" panes={panes} sources={[{ label: "cal", state: "ok" }]} clock="23:42" />,
    );
    expect(screen.getByLabelText("cal: in Ordnung, noch nicht geladen")).toBeTruthy();
  });

  it("schreibt den Grund aus, statt nur rot zu leuchten", () => {
    render(
      <StatusLine
        mode="NORMAL"
        panes={panes}
        sources={[{ label: "news", state: "crit", updatedAt: Date.now() }]}
        clock="23:42"
        problem="news: Kein Feed erreichbar"
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("news: Kein Feed erreichbar");
    expect(screen.queryByText("? keys")).toBeNull();
  });

  it("zeigt ohne Fehler den Tastenhinweis", () => {
    render(
      <StatusLine mode="NORMAL" panes={panes} sources={[{ label: "news", state: "ok" }]} clock="23:42" />,
    );
    expect(screen.getByText("? keys")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
