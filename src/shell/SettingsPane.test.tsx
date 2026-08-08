import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsPane, type SaveConfig } from "./SettingsPane";
import { ConfigConflictError } from "../api/config";
import { defaultConfig } from "../config/defaults";
import type { Config } from "../config/schema";

const guests = [{ vmid: 100, name: "caddy" }, { vmid: 110, name: "minecraft.local" }];

// Nur mutate und isPending werden von SettingsPane tatsächlich gelesen — der Rest der
// echten UseMutationResult-Form ist für diesen Test nicht das Verhalten, das geprüft wird.
// Die schmalere Signatur hier deckt genau das ab, was handleSave tatsächlich übergibt.
type MutateCall = (cfg: Config, opts?: { onSuccess?: () => void; onError?: (err: unknown) => void }) => void;

function fakeSave(mutate: MutateCall): SaveConfig {
  return { mutate: vi.fn(mutate), isPending: false } as unknown as SaveConfig;
}

function saveSucceeds(): SaveConfig {
  return fakeSave((_cfg, opts) => opts?.onSuccess?.());
}

function saveConflicts(current: string): SaveConfig {
  return fakeSave((_cfg, opts) => opts?.onError?.(new ConfigConflictError(current)));
}

function saveFailsNetwork(): SaveConfig {
  return fakeSave((_cfg, opts) => opts?.onError?.(new Error("boom")));
}

describe("SettingsPane", () => {
  it("zeigt alle acht Abschnitte und die Link-Tabelle", () => {
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} />);
    for (const label of ["Links", "Feeds", "Kalender", "Ort & Zeit", "Layout", "Homelab", "Suche", "Proxy"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByDisplayValue("Datasphere")).toBeTruthy();
  });

  it("benennt Layout-Checkbox, Breite und Zeilenaktionen eindeutig", () => {
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Layout" }));
    expect(screen.getByRole("checkbox", { name: "CLOCK sichtbar" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Breite von CLOCK" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Links" }));
    expect(screen.getByRole("button", { name: 'Link „Datasphere" nach unten' })).toBeTruthy();
    expect(screen.getByRole("button", { name: 'Link „Datasphere" löschen' })).toBeTruthy();
  });

  it("hält den Tastaturfokus im Einstellungsdialog", () => {
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} />);
    const dialog = screen.getByRole("dialog");
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) throw new Error("Dialog hat keine fokussierbaren Schaltflächen");
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("blockt das Speichern bei doppelten Kürzeln", () => {
    const save = saveSucceeds();
    const dup = structuredClone(defaultConfig);
    const first = dup.linkGroups[0]?.links[0];
    const second = dup.linkGroups[0]?.links[1];
    if (first) first.hint = "gd";
    if (second) second.hint = "gd";
    render(<SettingsPane open config={dup} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByText("Speichern"));
    expect(save.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Doppelte Link-Kürzel");
  });

  it("blockt Kürzel, die nicht mit g beginnen", () => {
    const save = saveSucceeds();
    const cfg = structuredClone(defaultConfig);
    const link = cfg.linkGroups[0]?.links[0];
    if (link) link.hint = "d";
    render(<SettingsPane open config={cfg} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByText("Speichern"));
    expect(save.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("muss mit g beginnen");
  });

  it("blockt Adressen ohne http oder https", () => {
    const save = saveSucceeds();
    const cfg = structuredClone(defaultConfig);
    const link = cfg.linkGroups[0]?.links[0];
    if (link) link.url = "javascript:alert(1)";
    render(<SettingsPane open config={cfg} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByText("Speichern"));
    expect(save.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("http:// oder https://");
  });

  it("verschluckt beim Umbenennen eines Bangs keine Zeile", () => {
    const save = saveSucceeds();
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Suche" }));
    // „npm" auf das schon vergebene „gh" umbenennen. Vorher fiel dabei ein Eintrag
    // stillschweigend aus dem Objekt; jetzt lehnt das Speichern ab.
    const keyFields = screen.getAllByLabelText("Bang");
    fireEvent.change(keyFields[2] as HTMLInputElement, { target: { value: "gh" } });
    expect(screen.getAllByLabelText("Bang")).toHaveLength(5);
    fireEvent.click(screen.getByText("Speichern"));
    expect(save.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("doppelt vergeben");
  });

  it("macht aus einem geleerten Schwellwert keine 0", () => {
    const save = saveSucceeds();
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Homelab" }));
    const storage = document.getElementById("s-storage") as HTMLInputElement;
    fireEvent.change(storage, { target: { value: "" } });
    fireEvent.click(screen.getByText("Speichern"));
    // Eine 0 als Storage-Schwelle ließe jedes Storage Alarm schlagen.
    const sent = (save.mutate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Config;
    expect(sent.homelab.thresholds.storage).toBe(80);
  });

  it("speichert eine gültige Config und schließt erst danach", () => {
    const save = saveSucceeds();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={onClose}
      save={save} onSaved={onSaved} />);
    fireEvent.click(screen.getByText("Speichern"));
    expect(save.mutate).toHaveBeenCalledOnce();
    const sent = (save.mutate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Config;
    expect(sent.location.label).toBe("Heilbronn");
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("bei einem 409-Konflikt bleibt der Dialog offen und der Entwurf erhalten", () => {
    const save = saveConflicts("2026-08-06T12:00:00.000Z");
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={onClose}
      save={save} onSaved={onSaved} />);
    const groupTitle = screen.getByDisplayValue("SAP");
    fireEvent.change(groupTitle, { target: { value: "SAP (bearbeitet)" } });
    fireEvent.click(screen.getByText("Speichern"));
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("anderes Gerät");
    // Die eigene Änderung ist noch da — nicht auf den Serverstand zurückgesetzt.
    expect(screen.getByDisplayValue("SAP (bearbeitet)")).toBeTruthy();
    // Nach dem Konflikt wird kein veralteter Entwurf erneut gespeichert.
    fireEvent.click(screen.getByText("Speichern"));
    expect(save.mutate).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Serverstand neu laden" })).toBeTruthy();
  });

  it("lädt nach einem Konflikt den Serverstand und entsperrt den Speichervorgang", async () => {
    const save = saveConflicts("2026-08-06T12:00:00.000Z");
    const server: Config = {
      ...defaultConfig,
      linkGroups: defaultConfig.linkGroups.map((group, i) => i === 0 ? { ...group, title: "Serverstand" } : group),
    };
    const onReload = vi.fn(async () => server);
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} onReload={onReload} />);
    fireEvent.click(screen.getByText("Speichern"));
    fireEvent.click(screen.getByRole("button", { name: "Serverstand neu laden" }));
    await waitFor(() => expect(screen.getByDisplayValue("Serverstand")).toBeTruthy());
    expect(onReload).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("bei einem Netzwerkfehler bleibt der Dialog offen mit einer erklärenden Meldung", () => {
    const save = saveFailsNetwork();
    const onClose = vi.fn();
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={onClose}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByText("Speichern"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("nicht erreichbar");
  });

  it("unterscheidet HTTP-Fehler, leere und ungültige Ortssuchergebnisse", async () => {
    const responses = [
      new Response("fehler", { status: 503 }),
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
      new Response(JSON.stringify({ results: [{ name: "kaputt", latitude: 91, longitude: 0 }] }), { status: 200 }),
    ];
    const fetchMock = vi.fn(async () => responses.shift() ?? new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const renderPane = () => render(<SettingsPane open config={defaultConfig} guests={guests}
        onClose={() => undefined} save={saveSucceeds()} onSaved={() => undefined} />);

      let rendered = renderPane();
      fireEvent.click(screen.getByRole("tab", { name: "Ort & Zeit" }));
      fireEvent.click(screen.getByRole("button", { name: "suchen" }));
      await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Ortssuche fehlgeschlagen."));
      rendered.unmount();

      rendered = renderPane();
      fireEvent.click(screen.getByRole("tab", { name: "Ort & Zeit" }));
      fireEvent.click(screen.getByRole("button", { name: "suchen" }));
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("nicht gefunden"));
      rendered.unmount();

      rendered = renderPane();
      fireEvent.click(screen.getByRole("tab", { name: "Ort & Zeit" }));
      fireEvent.click(screen.getByRole("button", { name: "suchen" }));
      await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Ortssuche fehlgeschlagen."));
      rendered.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("übersetzt einen strukturellen Konfigurationsfehler und springt zum richtigen Abschnitt", () => {
    // Ein Feld, das die UI selbst nie falsch setzen kann (nur 1 oder 2 stehen zur Wahl),
    // aber z. B. aus einem von Hand bearbeiteten Import so ankommen könnte.
    const bad = structuredClone(defaultConfig);
    // @ts-expect-error absichtlich ungültiger Testwert
    bad.layout[3].span = 3;
    const save = saveSucceeds();
    render(<SettingsPane open config={bad} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Suche" }));
    fireEvent.click(screen.getByText("Speichern"));
    expect(save.mutate).not.toHaveBeenCalled();
    const message = screen.getByRole("alert").textContent ?? "";
    expect(message).not.toContain("layout.3.span");
    expect(message).toContain("Layout");
    expect(screen.getByRole("tab", { name: "Layout", selected: true })).toBeTruthy();
  });

  it("löscht eine nicht-leere Linkgruppe erst beim zweiten Klick", () => {
    const save = saveSucceeds();
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    const before = screen.getAllByLabelText(/^Gruppe „.*" löschen$/).length;
    const del = screen.getByLabelText('Gruppe „SAP" löschen');
    fireEvent.click(del);
    expect(screen.getAllByLabelText(/^Gruppe „.*" löschen$/)).toHaveLength(before - 1);
    expect(screen.getByText("löschen?")).toBeTruthy();
    fireEvent.click(screen.getByText("löschen?"));
    expect(screen.queryByDisplayValue("SAP")).toBeNull();
  });

  it("verwirft die Lösch-Bestätigung, wenn der Fokus die Schaltfläche verlässt", () => {
    const save = saveSucceeds();
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    const del = screen.getByLabelText('Gruppe „SAP" löschen');
    fireEvent.click(del);
    expect(screen.getByText("löschen?")).toBeTruthy();
    fireEvent.blur(screen.getByText("löschen?"));
    expect(screen.getByLabelText('Gruppe „SAP" löschen')).toBeTruthy();
    expect(screen.getByDisplayValue("SAP")).toBeTruthy();
  });

  it("löscht eine leere Linkgruppe sofort, ohne Rückfrage", () => {
    const save = saveSucceeds();
    const cfg = structuredClone(defaultConfig);
    cfg.linkGroups.push({ title: "Leer", links: [] });
    render(<SettingsPane open config={cfg} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Gruppe „Leer" löschen'));
    expect(screen.queryByDisplayValue("Leer")).toBeNull();
  });

  it("sortiert Linkgruppen mit eigenen Auf-/Ab-Aktionen", () => {
    const save = saveSucceeds();
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: 'Gruppe „Intern" nach oben' }));
    expect(screen.getAllByLabelText("Gruppenname").map((field) => (field as HTMLInputElement).value))
      .toEqual(["Intern", "SAP", "Homelab", "Dev"]);
    expect((screen.getByRole("button", { name: 'Gruppe „Intern" nach oben' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
