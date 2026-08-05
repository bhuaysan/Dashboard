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

  it("speichert eine gültige Config", () => {
    const onSave = vi.fn();
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined} onSave={onSave} />);
    fireEvent.click(screen.getByText("Speichern"));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[0].location.label).toBe("Heilbronn");
  });
});
