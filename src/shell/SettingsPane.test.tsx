import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsPane } from "./SettingsPane";
import { defaultConfig } from "../config/defaults";

const guests = [{ vmid: 100, name: "caddy" }, { vmid: 110, name: "minecraft.local" }];

describe("SettingsPane", () => {
  it("zeigt alle acht Abschnitte und die Link-Tabelle", () => {
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined} onSave={() => undefined} />);
    for (const label of ["Links", "Feeds", "Kalender", "Ort & Zeit", "Layout", "Homelab", "Suche", "Proxy"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByDisplayValue("Datasphere")).toBeTruthy();
  });

  it("blockt das Speichern bei doppelten Kürzeln", () => {
    const onSave = vi.fn();
    const dup = structuredClone(defaultConfig);
    const first = dup.linkGroups[0]?.links[0];
    const second = dup.linkGroups[0]?.links[1];
    if (first) first.hint = "gd";
    if (second) second.hint = "gd";
    render(<SettingsPane open config={dup} guests={guests} onClose={() => undefined} onSave={onSave} />);
    fireEvent.click(screen.getByText("Speichern"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Doppelte Link-Kürzel");
  });

  it("blockt Kürzel, die nicht mit g beginnen", () => {
    const onSave = vi.fn();
    const cfg = structuredClone(defaultConfig);
    const link = cfg.linkGroups[0]?.links[0];
    if (link) link.hint = "d";
    render(<SettingsPane open config={cfg} guests={guests} onClose={() => undefined} onSave={onSave} />);
    fireEvent.click(screen.getByText("Speichern"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("muss mit g beginnen");
  });

  it("blockt Adressen ohne http oder https", () => {
    const onSave = vi.fn();
    const cfg = structuredClone(defaultConfig);
    const link = cfg.linkGroups[0]?.links[0];
    if (link) link.url = "javascript:alert(1)";
    render(<SettingsPane open config={cfg} guests={guests} onClose={() => undefined} onSave={onSave} />);
    fireEvent.click(screen.getByText("Speichern"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("http:// oder https://");
  });

  it("verschluckt beim Umbenennen eines Bangs keine Zeile", () => {
    const onSave = vi.fn();
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Suche" }));
    // „npm" auf das schon vergebene „gh" umbenennen. Vorher fiel dabei ein Eintrag
    // stillschweigend aus dem Objekt; jetzt lehnt das Speichern ab.
    const keyFields = screen.getAllByLabelText("Bang");
    fireEvent.change(keyFields[2] as HTMLInputElement, { target: { value: "gh" } });
    expect(screen.getAllByLabelText("Bang")).toHaveLength(5);
    fireEvent.click(screen.getByText("Speichern"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("doppelt vergeben");
  });

  it("macht aus einem geleerten Schwellwert keine 0", () => {
    const onSave = vi.fn();
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Homelab" }));
    const storage = document.getElementById("s-storage") as HTMLInputElement;
    fireEvent.change(storage, { target: { value: "" } });
    fireEvent.click(screen.getByText("Speichern"));
    // Eine 0 als Storage-Schwelle ließe jedes Storage Alarm schlagen.
    expect(onSave.mock.calls[0]?.[0].homelab.thresholds.storage).toBe(80);
  });

  it("speichert eine gültige Config", () => {
    const onSave = vi.fn();
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined} onSave={onSave} />);
    fireEvent.click(screen.getByText("Speichern"));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[0].location.label).toBe("Heilbronn");
  });
});
