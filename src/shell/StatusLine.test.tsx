import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusLine } from "./StatusLine";

const panes = [{ n: 1, label: "clock", active: true }];

describe("StatusLine", () => {
  it("zeigt das Alter jeder Quelle", () => {
    render(
      <StatusLine
        mode="NORMAL"
        profileName="Arbeit"
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
    expect(screen.getByLabelText(/wx: in Ordnung, geladen vor 4 Minuten/)).toBeTruthy();
  });

  it("nennt eine Quelle ohne Daten ausdrücklich", () => {
    render(
      <StatusLine mode="NORMAL" profileName="Arbeit" panes={panes} sources={[{ label: "cal", state: "ok" }]} clock="23:42" />,
    );
    expect(screen.getByLabelText("cal: in Ordnung, noch nicht geladen")).toBeTruthy();
  });

  it("zeigt die Alarmzahl der Quelle, auch wenn das Pane ausgeblendet ist", () => {
    render(
      <StatusLine
        mode="NORMAL"
        profileName="Arbeit"
        panes={[{ n: 1, label: "clock", active: true }]}
        sources={[{ label: "pve", state: "ok", updatedAt: Date.now(), alerts: { count: 2, level: "crit" } }]}
        clock="23:42"
      />,
    );
    // Zwei Ausrufezeichen heißen krit, eines warn — der Schweregrad darf nicht nur
    // in der Farbe stehen.
    const marker = screen.getByText("!!2");
    expect(marker.className).toBe("crit");
    expect(screen.getByLabelText(/pve: in Ordnung.*, 2 Alarme/)).toBeTruthy();
  });

  it("nennt einen einzelnen Alarm im Singular", () => {
    render(
      <StatusLine
        mode="NORMAL"
        profileName="Arbeit"
        panes={panes}
        sources={[{ label: "pve", state: "ok", updatedAt: Date.now(), alerts: { count: 1, level: "warn" } }]}
        clock="23:42"
      />,
    );
    expect(screen.getByText("!1").className).toBe("warn");
    expect(screen.getByLabelText(/, 1 Alarm$/)).toBeTruthy();
  });

  it("zeigt ohne Alarme kein Ausrufezeichen", () => {
    render(
      <StatusLine mode="NORMAL" profileName="Arbeit" panes={panes} sources={[{ label: "pve", state: "ok" }]} clock="23:42" />,
    );
    expect(screen.queryByText(/^!\d/)).toBeNull();
  });

  it("schreibt den Grund aus, statt nur rot zu leuchten", () => {
    render(
      <StatusLine
        mode="NORMAL"
        profileName="Arbeit"
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
      <StatusLine mode="NORMAL" profileName="Arbeit" panes={panes} sources={[{ label: "news", state: "ok" }]} clock="23:42" />,
    );
    expect(screen.getByText("? keys")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sagt bei fehlender PVE-Konfiguration nicht veraltet", () => {
    render(<StatusLine mode="NORMAL" profileName="Arbeit" panes={panes}
      sources={[{ label: "pve", state: "unconfigured" }]} clock="23:42" />);
    expect(screen.getByLabelText("pve: nicht konfiguriert, noch nicht geladen")).toBeTruthy();
  });

  it("zeigt den aktiven Profilnamen als kompaktes Statussegment", () => {
    render(
      <StatusLine mode="NORMAL" profileName="Arbeit" panes={panes}
        sources={[{ label: "wx", state: "ok" }]} clock="23:42" />,
    );
    expect(screen.getByText("profile:arbeit")).toBeTruthy();
    expect(screen.getByLabelText("Profil: Arbeit")).toBeTruthy();
    expect(screen.getByTitle("Arbeit")).toBeTruthy();
  });

  it("kürzt nur die sichtbare Profilanzeige und bewahrt den vollständigen zugänglichen Namen", () => {
    const profileName = "Ein sehr langer Profilname für das Büro";
    render(
      <StatusLine mode="NORMAL" profileName={profileName} panes={panes}
        sources={[{ label: "wx", state: "ok" }]} clock="23:42" />,
    );
    const profile = screen.getByLabelText(`Profil: ${profileName}`);
    expect(profile.textContent).toContain("profile:");
    expect(profile.textContent).toContain("…");
    expect(profile.textContent).not.toContain(profileName.toLocaleLowerCase("de-DE"));
    expect(profile.getAttribute("title")).toBe(profileName);
  });
});
