import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  SettingsPane as SettingsPaneComponent,
  type ProfileMutationOptions,
  type SaveConfig,
} from "./SettingsPane";
import { ConfigConflictError } from "../api/config";
import { defaultConfig } from "../config/defaults";
import type { Config, ProfileId } from "../config/schema";
import type { ComponentProps } from "react";
import type { ProfileCatalog } from "../config/local";
import { ProfileConflictError, type CreateProfileInput, type DeleteProfileInput, type RenameProfileInput } from "../api/profiles";

const guests = [{ vmid: 100, name: "caddy" }, { vmid: 110, name: "minecraft.local" }];
const PROFILE_ID = "123e4567-e89b-42d3-a456-426614174000" as ProfileId;
const SECOND_PROFILE_ID = "223e4567-e89b-42d3-a456-426614174000" as ProfileId;
const THIRD_PROFILE_ID = "323e4567-e89b-42d3-a456-426614174000" as ProfileId;
const PROFILE_CATALOG: ProfileCatalog = {
  profilesUpdatedAt: "2026-09-15T00:00:00.000Z",
  profiles: [
    { id: PROFILE_ID, name: "Arbeit" },
    { id: SECOND_PROFILE_ID, name: "Privat" },
  ],
};
const SINGLE_PROFILE_CATALOG: ProfileCatalog = {
  profilesUpdatedAt: PROFILE_CATALOG.profilesUpdatedAt,
  profiles: [PROFILE_CATALOG.profiles[0]!],
};

type TestSettingsProps = Omit<ComponentProps<typeof SettingsPaneComponent>,
  "profileId" | "profiles" | "activeProfileId" | "onSwitchProfile" | "onCreateProfile" | "onRenameProfile" | "onDeleteProfile"
> & {
  profileId?: ProfileId;
  profiles?: ProfileCatalog;
  activeProfileId?: ProfileId;
  onSwitchProfile?: (profileId: ProfileId) => void;
  onCreateProfile?: (input: CreateProfileInput, options?: ProfileMutationOptions) => void;
  onRenameProfile?: (input: RenameProfileInput, options?: ProfileMutationOptions) => void;
  onDeleteProfile?: (input: DeleteProfileInput, options?: ProfileMutationOptions) => void;
};

function SettingsPane(props: TestSettingsProps) {
  const {
    profileId = PROFILE_ID,
    profiles = PROFILE_CATALOG,
    activeProfileId = PROFILE_ID,
    onSwitchProfile = () => undefined,
    onCreateProfile = () => undefined,
    onRenameProfile = () => undefined,
    onDeleteProfile = () => undefined,
    ...rest
  } = props;
  return <SettingsPaneComponent {...rest} profileId={profileId} profiles={profiles} activeProfileId={activeProfileId}
    onSwitchProfile={onSwitchProfile} onCreateProfile={onCreateProfile} onRenameProfile={onRenameProfile} onDeleteProfile={onDeleteProfile} />;
}

function renderProfiles(overrides: Partial<TestSettingsProps> = {}) {
  const props: TestSettingsProps = {
    open: true,
    config: defaultConfig,
    guests,
    onClose: () => undefined,
    save: saveSucceeds(),
    onSaved: () => undefined,
    profiles: PROFILE_CATALOG,
    activeProfileId: PROFILE_ID,
    onSwitchProfile: () => undefined,
    onCreateProfile: () => undefined,
    onRenameProfile: () => undefined,
    onDeleteProfile: () => undefined,
    ...overrides,
  };
  return render(<SettingsPane {...props} />);
}

// Nur mutate und isPending werden von SettingsPane tatsächlich gelesen — der Rest der
// echten UseMutationResult-Form ist für diesen Test nicht das Verhalten, das geprüft wird.
// Die schmalere Signatur hier deckt genau das ab, was handleSave tatsächlich übergibt.
type MutateCall = (cfg: Config, opts?: { onSuccess?: () => void; onError?: (err: unknown) => void }) => void;

function fakeSave(mutate: MutateCall): SaveConfig {
  return { mutate: vi.fn(mutate), isPending: false };
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
  it("zeigt alle neun Konfigurationsabschnitte und die Link-Tabelle", () => {
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} />);
    for (const label of ["Links", "Feeds", "Kalender", "Ort & Zeit", "Layout", "Homelab", "Uptime", "Suche", "Proxy"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByDisplayValue("Datasphere")).toBeTruthy();
  });

  it("bearbeitet und ergänzt HTTP- und TCP-Uptime-Ziele", () => {
    const httpId = "423e4567-e89b-42d3-a456-426614174000";
    const tcpId = "523e4567-e89b-42d3-a456-426614174000";
    const newHttpId = "623e4567-e89b-42d3-a456-426614174000";
    const newTcpId = "723e4567-e89b-42d3-a456-426614174000";
    const cfg: Config = {
      ...structuredClone(defaultConfig),
      uptime: {
        enabled: false,
        targets: [
          { id: httpId, type: "http", label: "Web", url: "https://example.com/" },
          { id: tcpId, type: "tcp", label: "Game", host: "game.example", port: 25565 },
        ],
      },
    };
    const randomUuid = vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(newHttpId)
      .mockReturnValueOnce(newTcpId);
    let sent: Config | undefined;
    const save = fakeSave((config) => { sent = config; });

    render(<SettingsPane open config={cfg} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Uptime" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Uptime-Monitoring aktiv" }));
    fireEvent.change(screen.getByRole("textbox", { name: "URL von Uptime-Ziel Web" }), { target: { value: "https://start.example/health" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Name von Uptime-Ziel Web" }), { target: { value: "Startseite" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Host von Uptime-Ziel Game" }), { target: { value: "minecraft.example" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Port von Uptime-Ziel Game" }), { target: { value: "25567" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Name von Uptime-Ziel Game" }), { target: { value: "Minecraft" } });
    fireEvent.click(screen.getByRole("button", { name: "+ HTTP" }));
    fireEvent.click(screen.getByRole("button", { name: "+ TCP" }));
    fireEvent.click(screen.getByText("Speichern"));

    expect(sent?.uptime).toEqual({
      enabled: true,
      targets: [
        { id: httpId, type: "http", label: "Startseite", url: "https://start.example/health" },
        { id: tcpId, type: "tcp", label: "Minecraft", host: "minecraft.example", port: 25567 },
        { id: newHttpId, type: "http", label: "neu", url: "https://example.com/" },
        { id: newTcpId, type: "tcp", label: "neu", host: "minecraft.example", port: 25565 },
      ],
    });
    randomUuid.mockRestore();
  });

  it("sortiert und löscht Uptime-Ziele anhand stabiler IDs", () => {
    const ids = [
      "423e4567-e89b-42d3-a456-426614174000",
      "523e4567-e89b-42d3-a456-426614174000",
      "623e4567-e89b-42d3-a456-426614174000",
    ];
    const cfg: Config = {
      ...structuredClone(defaultConfig),
      uptime: {
        enabled: true,
        targets: ids.map((id, index) => ({
          id, type: "http" as const, label: ["Alpha", "Beta", "Gamma"][index] ?? "Ziel", url: `https://${index}.example/`,
        })),
      },
    };
    let sent: Config | undefined;
    const save = fakeSave((config) => { sent = config; });
    render(<SettingsPane open config={cfg} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Uptime" }));
    fireEvent.click(screen.getByRole("button", { name: "Uptime-Ziel Beta nach oben" }));
    fireEvent.click(screen.getByRole("button", { name: "Uptime-Ziel Alpha löschen" }));
    fireEvent.click(screen.getByText("Speichern"));
    expect(sent?.uptime.targets.map((target) => target.id)).toEqual([ids[1], ids[2]]);
  });

  it("begrenzt Uptime-Ziele und ordnet Schemafehler dem Uptime-Abschnitt zu", () => {
    const cfg: Config = {
      ...structuredClone(defaultConfig),
      uptime: {
        enabled: true,
        targets: Array.from({ length: 32 }, (_, index) => ({
          id: `${String(index).padStart(8, "0")}-e89b-42d3-a456-426614174000`,
          type: "http" as const,
          label: `Ziel ${index + 1}`,
          url: index === 0 ? "ungültig" : `https://${index}.example/`,
        })),
      },
    };
    const save = saveSucceeds();
    render(<SettingsPane open config={cfg} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Uptime" }));
    const addHttp = screen.getByRole("button", { name: "+ HTTP" });
    const addTcp = screen.getByRole("button", { name: "+ TCP" });
    if (!(addHttp instanceof HTMLButtonElement) || !(addTcp instanceof HTMLButtonElement)) {
      throw new Error("Uptime-Hinzufügen-Aktionen sind keine Schaltflächen");
    }
    expect(addHttp.disabled).toBe(true);
    expect(addTcp.disabled).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Suche" }));
    fireEvent.click(screen.getByText("Speichern"));
    expect(save.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Uptime");
    expect(screen.getByRole("tab", { name: "Uptime", selected: true })).toBeTruthy();
  });

  it("benennt Layout-Checkbox, Breite und Zeilenaktionen eindeutig", () => {
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Layout" }));
    expect(screen.getByRole("checkbox", { name: "CLOCK sichtbar" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Breite von CLOCK" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Breite von UPTIME" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Links" }));
    expect(screen.getByRole("button", { name: 'Link „Datasphere" nach unten' })).toBeTruthy();
    expect(screen.getByRole("button", { name: 'Link „Datasphere" löschen' })).toBeTruthy();
  });

  it("lässt eine aktiv überwachte Uptime-Pane ausblenden", () => {
    const cfg = {
      ...structuredClone(defaultConfig),
      uptime: { enabled: true, targets: [] },
    };
    let sent: Config | undefined;
    render(<SettingsPane open config={cfg} guests={guests} onClose={() => undefined}
      save={fakeSave((config) => { sent = config; })} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Layout" }));
    const visible = screen.getByRole("checkbox", { name: "UPTIME sichtbar" });
    if (!(visible instanceof HTMLInputElement)) throw new Error("Uptime-Sichtbarkeit ist kein Eingabefeld");
    expect(visible.disabled).toBe(false);
    fireEvent.click(visible);
    fireEvent.click(screen.getByText("Speichern"));
    expect(sent?.uptime.enabled).toBe(true);
    expect(sent?.layout.find((entry) => entry.id === "uptime")?.visible).toBe(false);
  });

  it("speichert den aktivierten Proxmox-Monitoring-Schalter ohne andere Homelab-Werte zu verändern", () => {
    let sent: Config | undefined;
    const save = fakeSave((config, opts) => {
      sent = config;
      opts?.onSuccess?.();
    });
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Homelab" }));
    const monitoring = screen.getByRole("checkbox", { name: "Proxmox-Monitoring aktiv" });
    if (!(monitoring instanceof HTMLInputElement)) throw new Error("Monitoring-Schalter ist kein Eingabefeld");
    expect(monitoring.checked).toBe(false);
    fireEvent.click(monitoring);
    fireEvent.click(screen.getByText("Speichern"));
    expect(save.mutate).toHaveBeenCalledOnce();
    if (sent === undefined) throw new Error("Kein Config-Entwurf gespeichert");
    expect(sent.homelab.enabled).toBe(true);
    expect(sent.homelab.node).toBe(defaultConfig.homelab.node);
    expect(sent.homelab.thresholds).toEqual(defaultConfig.homelab.thresholds);
  });

  it("hält den Tastaturfokus im Einstellungsdialog", () => {
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Homelab" }));
    const dialog = screen.getByRole("dialog");
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.tabIndex >= 0);
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

  it("benennt wiederholte Eingaben mit dem Zeilenkontext", () => {
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} />);
    expect(screen.getByLabelText('URL von Link „Datasphere" Zeile 1')).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Feeds" }));
    expect(screen.getByLabelText('URL von Feed „heise" Zeile 1')).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Suche" }));
    expect(screen.getByLabelText("Bang-Kürzel Zeile 1")).toBeTruthy();
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

  it("blockt Kürzel, die Präfix eines anderen Kürzels sind", () => {
    const save = saveSucceeds();
    const cfg = structuredClone(defaultConfig);
    const first = cfg.linkGroups[0]?.links[0];
    const second = cfg.linkGroups[0]?.links[1];
    if (first) first.hint = "gx";
    if (second) second.hint = "gxa";
    render(<SettingsPane open config={cfg} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByText("Speichern"));
    expect(save.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Präfix");
  });

  it("erlaubt bis zu drei Zeichen im Kürzelfeld", () => {
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} />);
    expect(screen.getByLabelText(/Kürzel von Link „Datasphere"/).getAttribute("maxlength")).toBe("3");
  });

  it("normalisiert ein geleertes optionales Link-Kürzel vor dem Speichern", () => {
    const save = saveSucceeds();
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/Kürzel von Link „Datasphere"/), { target: { value: "" } });
    fireEvent.click(screen.getByText("Speichern"));
    expect(save.mutate).toHaveBeenCalledOnce();
    const sent = (save.mutate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Config;
    expect(sent.linkGroups[0]?.links[0]?.hint).toBeUndefined();
  });

  it("legt einen neuen Link ohne ungültigen Leerstring-Hint an", () => {
    const save = saveSucceeds();
    render(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getAllByRole("button", { name: "+ Link" })[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText(/URL von Link „Neuer Link"/), {
      target: { value: "https://example.com/neu" },
    });
    fireEvent.click(screen.getByText("Speichern"));
    expect(save.mutate).toHaveBeenCalledOnce();
    const sent = (save.mutate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Config;
    expect(sent.linkGroups[0]?.links.at(-1)?.hint).toBeUndefined();
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
    const keyFields = screen.getAllByLabelText(/^Bang-Kürzel Zeile/);
    fireEvent.change(keyFields[2] as HTMLInputElement, { target: { value: "gh" } });
    expect(screen.getAllByLabelText(/^Bang-Kürzel Zeile/)).toHaveLength(5);
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

  it("zeigt einen nicht mehr gelieferten erwarteten Gast und lässt ihn entfernen", () => {
    const save = saveSucceeds();
    const cfg = structuredClone(defaultConfig);
    cfg.homelab.expectRunning = [999];
    render(<SettingsPane open config={cfg} guests={guests} onClose={() => undefined}
      save={save} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Homelab" }));
    const orphan = screen.getByRole("checkbox", { name: "999 nicht mehr vorhanden soll laufen" });
    expect((orphan as HTMLInputElement).checked).toBe(true);
    fireEvent.click(orphan);
    fireEvent.click(screen.getByText("Speichern"));
    const sent = (save.mutate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Config;
    expect(sent.homelab.expectRunning).toEqual([]);
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

  it("sendet die aktive Profil-ID bei der Ortssuche an den Proxy", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [{ name: "Heilbronn", latitude: 49, longitude: 9 }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsPane open config={defaultConfig} guests={guests} profileId={PROFILE_ID}
      onClose={() => undefined} save={saveSucceeds()} onSaved={() => undefined} />);

    fireEvent.click(screen.getByRole("tab", { name: "Ort & Zeit" }));
    fireEvent.click(screen.getByRole("button", { name: "suchen" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const target = "https://geocoding-api.open-meteo.com/v1/search?name=Heilbronn&count=1&language=de";
    expect(fetchMock).toHaveBeenCalledWith(`/api/proxy?profile=${PROFILE_ID}&url=${encodeURIComponent(target)}`);
  });

  it("lässt eine ältere Ortssuche kein neueres Ergebnis überschreiben", async () => {
    const pending: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))));
    render(<SettingsPane open config={defaultConfig} guests={guests}
      onClose={() => undefined} save={saveSucceeds()} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Ort & Zeit" }));
    const input = document.getElementById("s-city") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Erste Suche" } });
    fireEvent.click(screen.getByRole("button", { name: "suchen" }));
    fireEvent.change(input, { target: { value: "Zweite Suche" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(pending).toHaveLength(2);

    pending[1]?.(new Response(JSON.stringify({
      results: [{ name: "Neuer Ort", latitude: 49, longitude: 9 }],
    }), { status: 200 }));
    await waitFor(() => expect(screen.getByText(/Neuer Ort/)).toBeTruthy());
    pending[0]?.(new Response(JSON.stringify({
      results: [{ name: "Alter Ort", latitude: 48, longitude: 8 }],
    }), { status: 200 }));
    await Promise.resolve();
    expect(screen.queryByText(/Alter Ort/)).toBeNull();
    expect(screen.getByText(/Neuer Ort/)).toBeTruthy();
  });

  it("verwirft ein Ortssuchergebnis des vorherigen Profils", async () => {
    const pending: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))));
    const { rerender } = renderProfiles({ profileId: PROFILE_ID, activeProfileId: PROFILE_ID, initialSection: "place" });
    const city = document.getElementById("s-city") as HTMLInputElement;
    fireEvent.change(city, { target: { value: "Ort A" } });
    fireEvent.click(screen.getByRole("button", { name: "suchen" }));
    expect(pending).toHaveLength(1);

    const profileBConfig: Config = {
      ...defaultConfig,
      location: { ...defaultConfig.location, label: "Ort B" },
    };
    rerender(<SettingsPane open config={profileBConfig} guests={guests} profileId={SECOND_PROFILE_ID}
      profiles={PROFILE_CATALOG} activeProfileId={SECOND_PROFILE_ID} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} initialSection="place" />);
    await waitFor(() => expect(screen.getByText(/Ort B ·/)).toBeTruthy());

    const cancel = vi.fn(async () => undefined);
    const response = new Response(JSON.stringify({
      results: [{ name: "Ort A", latitude: 48, longitude: 8 }],
    }), { status: 200 });
    Object.defineProperty(response, "body", {
      configurable: true,
      value: { cancel },
    });
    await act(async () => {
      pending[0]?.(response);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(screen.getByText(/Ort B ·/)).toBeTruthy();
    expect(screen.queryByText(/Ort A ·/)).toBeNull();
  });

  it("verwirft eine Antwort nach Schließen und erneutem Öffnen desselben Dialogs", async () => {
    let resolveSearch: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => { resolveSearch = resolve; });
    vi.stubGlobal("fetch", vi.fn(() => pending));
    const rendered = renderProfiles({ initialSection: "place" });
    fireEvent.click(screen.getByRole("button", { name: "suchen" }));

    rendered.rerender(<SettingsPane open={false} config={defaultConfig} guests={guests} profileId={PROFILE_ID}
      profiles={PROFILE_CATALOG} activeProfileId={PROFILE_ID} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} initialSection="place" />);
    rendered.rerender(<SettingsPane open config={defaultConfig} guests={guests} profileId={PROFILE_ID}
      profiles={PROFILE_CATALOG} activeProfileId={PROFILE_ID} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} initialSection="place" />);
    resolveSearch(new Response(JSON.stringify({ results: [{ name: "Alter Ort", latitude: 48, longitude: 8 }] }), { status: 200 }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.queryByText(/Alter Ort/)).toBeNull();
  });

  it("hält Profilaktionen während eines ausstehenden Config-Speicherns gesperrt", () => {
    const onSwitchProfile = vi.fn();
    const onRenameProfile = vi.fn();
    const onDeleteProfile = vi.fn();
    const save: SaveConfig = { mutate: vi.fn(), isPending: true };
    renderProfiles({ save, onSwitchProfile, onRenameProfile, onDeleteProfile, initialSection: "profile" });

    expect((screen.getByRole("button", { name: 'Profil „Privat" wechseln' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: 'Profil „Arbeit" umbenennen' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: 'Profil „Privat" löschen' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Profil duplizieren" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: 'Profil „Privat" wechseln' }));
    expect(onSwitchProfile).not.toHaveBeenCalled();
  });

  it("ignoriert einen verspäteten Save-Erfolg nach einem Profilwechsel", () => {
    let finishSave: { onSuccess?: () => void; onError?: (error: unknown) => void } | undefined;
    const save = fakeSave((_config, options) => { finishSave = options; });
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const onSwitchProfile = vi.fn();
    const { rerender } = renderProfiles({ save, onClose, onSaved, onSwitchProfile, initialSection: "profile" });
    fireEvent.click(screen.getByRole("button", { name: 'Profil „Privat" wechseln' }));
    fireEvent.click(screen.getByRole("tab", { name: "Links" }));
    fireEvent.change(screen.getByDisplayValue("Datasphere"), { target: { value: "Entwurf A" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(finishSave).toBeDefined();

    const profileBConfig: Config = {
      ...defaultConfig,
      location: { ...defaultConfig.location, label: "Ort B" },
    };
    rerender(<SettingsPane open config={profileBConfig} guests={guests} profileId={SECOND_PROFILE_ID}
      profiles={PROFILE_CATALOG} activeProfileId={SECOND_PROFILE_ID} onClose={onClose}
      save={{ ...save, isPending: true }} onSaved={onSaved} />);
    finishSave?.onSuccess?.();

    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Ort & Zeit" }));
    expect(screen.getByText(/Ort B ·/)).toBeTruthy();
  });

  it("ignoriert einen verspäteten Save-Erfolg nach Schließen und erneutem Öffnen", () => {
    let finishSave: { onSuccess?: () => void; onError?: (error: unknown) => void } | undefined;
    const save = fakeSave((_config, options) => { finishSave = options; });
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const rendered = renderProfiles({ save, onClose, onSaved });
    fireEvent.change(screen.getByDisplayValue("Datasphere"), { target: { value: "Entwurf" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    rendered.rerender(<SettingsPane open={false} config={defaultConfig} guests={guests} profileId={PROFILE_ID}
      profiles={PROFILE_CATALOG} activeProfileId={PROFILE_ID} onClose={onClose} save={save} onSaved={onSaved} />);
    rendered.rerender(<SettingsPane open config={defaultConfig} guests={guests} profileId={PROFILE_ID}
      profiles={PROFILE_CATALOG} activeProfileId={PROFILE_ID} onClose={onClose} save={save} onSaved={onSaved} />);
    finishSave?.onSuccess?.();

    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sperrt Profilwechsel beim Config-Reload und verwirft keine alte Antwort im neuen Profil", async () => {
    let resolveReload: (config: Config) => void = () => undefined;
    const reloadPending = new Promise<Config>((resolve) => { resolveReload = resolve; });
    const onReload = vi.fn(() => reloadPending);
    const onSwitchProfile = vi.fn();
    const { rerender } = renderProfiles({
      save: saveConflicts("other-revision"),
      onReload,
      onSwitchProfile,
      initialSection: "profile",
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    fireEvent.click(screen.getByRole("button", { name: "Serverstand neu laden" }));
    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
    expect((screen.getByRole("button", { name: 'Profil „Privat" wechseln' }) as HTMLButtonElement).disabled).toBe(true);

    const profileBConfig: Config = {
      ...defaultConfig,
      location: { ...defaultConfig.location, label: "Ort B" },
    };
    rerender(<SettingsPane open config={profileBConfig} guests={guests} profileId={SECOND_PROFILE_ID}
      profiles={PROFILE_CATALOG} activeProfileId={SECOND_PROFILE_ID} onClose={() => undefined}
      save={saveSucceeds()} onReload={onReload} onSwitchProfile={onSwitchProfile}
      onSaved={() => undefined} initialSection="profile" />);
    expect((screen.getByRole("button", { name: 'Profil „Arbeit" wechseln' }) as HTMLButtonElement).disabled).toBe(false);

    resolveReload({ ...defaultConfig, location: { ...defaultConfig.location, label: "Alter Serverstand" } });
    await Promise.resolve();
    expect(screen.getByRole("tab", { name: "PROFILE", selected: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Ort & Zeit" }));
    await waitFor(() => expect(screen.getByText(/Ort B ·/)).toBeTruthy());
    expect(screen.queryByDisplayValue("Alter Serverstand")).toBeNull();
  });

  it("setzt eine laufende Config-Reload-Sperre beim Profilkontextwechsel zurück", async () => {
    let resolveReload: (config: Config) => void = () => undefined;
    const reloadPending = new Promise<Config>((resolve) => { resolveReload = resolve; });
    const onReload = vi.fn(() => reloadPending);
    const { rerender } = renderProfiles({
      save: saveConflicts("other-revision"),
      onReload,
      initialSection: "profile",
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    fireEvent.click(screen.getByRole("button", { name: "Serverstand neu laden" }));
    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());

    rerender(<SettingsPane open config={defaultConfig} guests={guests} profileId={SECOND_PROFILE_ID}
      profiles={PROFILE_CATALOG} activeProfileId={SECOND_PROFILE_ID} onClose={() => undefined}
      save={saveSucceeds()} onReload={onReload} onSaved={() => undefined} initialSection="profile" />);
    await waitFor(() => expect((screen.getByRole("button", { name: 'Profil „Arbeit" wechseln' }) as HTMLButtonElement).disabled).toBe(false));
    resolveReload(defaultConfig);
  });

  it("setzt eine laufende Sperre beim Schließen und erneuten Öffnen zurück", async () => {
    let resolveReload: (config: Config) => void = () => undefined;
    const reloadPending = new Promise<Config>((resolve) => { resolveReload = resolve; });
    const onReload = vi.fn(() => reloadPending);
    const rendered = renderProfiles({
      save: saveConflicts("other-revision"),
      onReload,
      initialSection: "profile",
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    fireEvent.click(screen.getByRole("button", { name: "Serverstand neu laden" }));
    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());

    rendered.rerender(<SettingsPane open={false} config={defaultConfig} guests={guests}
      onClose={() => undefined} save={saveSucceeds()} onReload={onReload} onSaved={() => undefined} initialSection="profile" />);
    rendered.rerender(<SettingsPane open config={defaultConfig} guests={guests}
      onClose={() => undefined} save={saveSucceeds()} onReload={onReload} onSaved={() => undefined} initialSection="profile" />);
    await waitFor(() => expect((screen.getByRole("button", { name: 'Profil „Privat" wechseln' }) as HTMLButtonElement).disabled).toBe(false));
    resolveReload(defaultConfig);
  });

  it("setzt eine laufende Profilmutations-Sperre beim Profilkontextwechsel zurück", async () => {
    let finishRename: ProfileMutationOptions | undefined;
    const onRenameProfile = vi.fn((_input: RenameProfileInput, options?: ProfileMutationOptions) => { finishRename = options; });
    const { rerender } = renderProfiles({ onRenameProfile, initialSection: "profile" });
    fireEvent.change(screen.getByRole("textbox", { name: 'Profilname „Arbeit"' }), { target: { value: "Büro" } });
    fireEvent.click(screen.getByRole("button", { name: 'Profil „Arbeit" umbenennen' }));
    expect((screen.getByRole("button", { name: 'Profil „Privat" wechseln' }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<SettingsPane open config={defaultConfig} guests={guests} profileId={SECOND_PROFILE_ID}
      profiles={PROFILE_CATALOG} activeProfileId={SECOND_PROFILE_ID} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} onRenameProfile={onRenameProfile} initialSection="profile" />);
    await waitFor(() => expect((screen.getByRole("button", { name: 'Profil „Arbeit" wechseln' }) as HTMLButtonElement).disabled).toBe(false));
    finishRename?.onSuccess?.({ catalog: PROFILE_CATALOG });
  });

  it("fokussiert und begrenzt auch den Readiness-Dialog vor dem Katalog", async () => {
    const { rerender } = render(<SettingsPaneComponent open config={defaultConfig} profileId={PROFILE_ID}
      profiles={undefined} activeProfileId={undefined} guests={guests} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} onSwitchProfile={() => undefined}
      onCreateProfile={() => undefined} onRenameProfile={() => undefined} onDeleteProfile={() => undefined} />);
    const loadingDialog = screen.getByRole("dialog");
    await waitFor(() => expect(document.activeElement).toBe(loadingDialog));
    fireEvent.keyDown(loadingDialog, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Abbrechen" }));

    rerender(<SettingsPaneComponent open config={defaultConfig} profileId={PROFILE_ID}
      profiles={PROFILE_CATALOG} activeProfileId={PROFILE_ID} guests={guests} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} onSwitchProfile={() => undefined}
      onCreateProfile={() => undefined} onRenameProfile={() => undefined} onDeleteProfile={() => undefined} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("dialog")));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).not.toBe(document.body);
  });

  it("übernimmt eine später geladene echte Config im sauberen Dialog-Entwurf", async () => {
    const loaded: Config = {
      ...defaultConfig,
      location: { ...defaultConfig.location, label: "Später geladen" },
    };
    const { rerender } = render(<SettingsPane open config={defaultConfig} configReady={false} profileId={PROFILE_ID}
      profiles={PROFILE_CATALOG} activeProfileId={PROFILE_ID} guests={guests} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} onSwitchProfile={() => undefined}
      onCreateProfile={() => undefined} onRenameProfile={() => undefined} onDeleteProfile={() => undefined} />);
    expect(screen.getByText(/Profile werden geladen/)).toBeTruthy();

    rerender(<SettingsPane open config={loaded} configReady profileId={PROFILE_ID}
      profiles={PROFILE_CATALOG} activeProfileId={PROFILE_ID} guests={guests} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} onSwitchProfile={() => undefined}
      onCreateProfile={() => undefined} onRenameProfile={() => undefined} onDeleteProfile={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Ort & Zeit" }));
    await waitFor(() => expect(screen.getByDisplayValue("Später geladen")).toBeTruthy());
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
    expect(screen.getAllByLabelText(/^Gruppenname von/).map((field) => (field as HTMLInputElement).value))
      .toEqual(["Intern", "SAP", "Homelab", "Dev"]);
    expect((screen.getByRole("button", { name: 'Gruppe „Intern" nach oben' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("zeigt PROFILE zuerst und markiert das aktive Profil", () => {
    renderProfiles({ initialSection: "profile" });

    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]?.textContent).toBe("PROFILE");
    expect(screen.getByRole("row", { name: /Arbeit.*aktiv/ })).toBeTruthy();
    expect(screen.getByRole("row", { name: /Privat/ })).toBeTruthy();
  });

  it("wechselt ein Profil ohne ungespeicherten Entwurf sofort", () => {
    const onSwitchProfile = vi.fn();
    renderProfiles({ onSwitchProfile, initialSection: "profile" });

    fireEvent.click(screen.getByRole("button", { name: 'Profil „Privat" wechseln' }));

    expect(onSwitchProfile).toHaveBeenCalledOnce();
    expect(onSwitchProfile).toHaveBeenCalledWith(SECOND_PROFILE_ID);
  });

  it("beginnt nach einem bestätigten Profilwechsel einen neuen Config-Entwurf", () => {
    const onSwitchProfile = vi.fn();
    const { rerender } = renderProfiles({ onSwitchProfile, initialSection: "profile" });

    fireEvent.click(screen.getByRole("button", { name: 'Profil „Privat" wechseln' }));
    const privateConfig: Config = { ...defaultConfig, location: { ...defaultConfig.location, label: "Privatort" } };
    rerender(<SettingsPane open config={privateConfig} guests={guests} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} profiles={PROFILE_CATALOG}
      activeProfileId={SECOND_PROFILE_ID} onSwitchProfile={onSwitchProfile} initialSection="links" />);

    fireEvent.click(screen.getByRole("tab", { name: "Ort & Zeit" }));
    expect(screen.getByDisplayValue("Privatort")).toBeTruthy();
  });

  it("dupliziert mit getrimmtem Namen und wechselt erst nach Serverbestätigung", () => {
    const onSwitchProfile = vi.fn();
    const onCreateProfile = vi.fn((_input: CreateProfileInput, _options?: ProfileMutationOptions) => undefined);
    renderProfiles({ onSwitchProfile, onCreateProfile, initialSection: "profile" });

    fireEvent.change(screen.getByRole("textbox", { name: "Neuer Profilname" }), { target: { value: "  Zuhause  " } });
    fireEvent.click(screen.getByRole("button", { name: "Profil duplizieren" }));

    expect(onCreateProfile).toHaveBeenCalledOnce();
    expect(onCreateProfile).toHaveBeenCalledWith(
      { name: "Zuhause", sourceProfileId: PROFILE_ID, profilesUpdatedAt: PROFILE_CATALOG.profilesUpdatedAt },
      expect.anything(),
    );
    expect(onSwitchProfile).not.toHaveBeenCalled();

    const options = onCreateProfile.mock.calls[0]?.[1];
    options?.onSuccess?.({
      catalog: {
        ...PROFILE_CATALOG,
        profiles: [...PROFILE_CATALOG.profiles, { id: THIRD_PROFILE_ID, name: "Zuhause" }],
      },
      createdId: THIRD_PROFILE_ID,
    });
    expect(onSwitchProfile).toHaveBeenCalledWith(THIRD_PROFILE_ID);
  });

  it("benennt ein Profil um und behält seine stabile ID", () => {
    const onRenameProfile = vi.fn((_input: RenameProfileInput, _options?: ProfileMutationOptions) => undefined);
    renderProfiles({ onRenameProfile, initialSection: "profile" });

    fireEvent.change(screen.getByRole("textbox", { name: 'Profilname „Arbeit"' }), { target: { value: "  Büro  " } });
    fireEvent.click(screen.getByRole("button", { name: 'Profil „Arbeit" umbenennen' }));

    expect(onRenameProfile).toHaveBeenCalledWith(
      { profileId: PROFILE_ID, name: "Büro", profilesUpdatedAt: PROFILE_CATALOG.profilesUpdatedAt },
      expect.anything(),
    );
  });

  it("löscht ein Profil erst beim zweiten Klick und sperrt das letzte Profil", () => {
    const onDeleteProfile = vi.fn((_input: DeleteProfileInput, _options?: ProfileMutationOptions) => undefined);
    const { rerender } = renderProfiles({ onDeleteProfile, initialSection: "profile" });

    const del = screen.getByRole("button", { name: 'Profil „Privat" löschen' });
    fireEvent.click(del);
    expect(onDeleteProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Profil „Privat" endgültig löschen/ }));
    expect(onDeleteProfile).toHaveBeenCalledOnce();

    rerender(<SettingsPane open config={defaultConfig} guests={guests} onClose={() => undefined}
      save={saveSucceeds()} onSaved={() => undefined} profiles={SINGLE_PROFILE_CATALOG}
      activeProfileId={PROFILE_ID} onDeleteProfile={onDeleteProfile} initialSection="profile" />);
    expect((screen.getByRole("button", { name: 'Profil „Arbeit" löschen' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("zeigt Profilfehler auf Deutsch und bietet Katalog-Neuladen an", () => {
    const onReloadProfiles = vi.fn(async () => PROFILE_CATALOG);
    const onRenameProfile = vi.fn((_input: RenameProfileInput, options?: ProfileMutationOptions) => {
      options?.onError?.(new ProfileConflictError("2026-09-16T00:00:00.000Z"));
    });
    renderProfiles({ onRenameProfile, onReloadProfiles, initialSection: "profile" });

    fireEvent.change(screen.getByRole("textbox", { name: 'Profilname „Arbeit"' }), { target: { value: "Büro" } });
    fireEvent.click(screen.getByRole("button", { name: 'Profil „Arbeit" umbenennen' }));

    expect(screen.getByRole("alert").textContent).toContain("Profilkatalog");
    fireEvent.click(screen.getByRole("button", { name: "Profilkatalog neu laden" }));
    return waitFor(() => expect(onReloadProfiles).toHaveBeenCalledOnce());
  });

  it("schützt Profilwechsel vor dem Verwerfen eines Config-Entwurfs", () => {
    const onSwitchProfile = vi.fn();
    renderProfiles({ onSwitchProfile, initialSection: "profile" });

    fireEvent.click(screen.getByRole("tab", { name: "Links" }));
    fireEvent.change(screen.getByDisplayValue("Datasphere"), { target: { value: "Geänderte Seite" } });
    fireEvent.click(screen.getByRole("tab", { name: "PROFILE" }));
    fireEvent.click(screen.getByRole("button", { name: 'Profil „Privat" wechseln' }));
    expect(onSwitchProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Entwurf");
    fireEvent.click(screen.getByRole("button", { name: "Entwurf verwerfen und Profil wechseln" }));
    expect(onSwitchProfile).toHaveBeenCalledWith(SECOND_PROFILE_ID);
  });

  it("bricht die Verwerfensbestätigung ab und behält den Entwurf", () => {
    const onSwitchProfile = vi.fn();
    renderProfiles({ onSwitchProfile, initialSection: "profile" });

    fireEvent.click(screen.getByRole("tab", { name: "Links" }));
    fireEvent.change(screen.getByDisplayValue("Datasphere"), { target: { value: "Geänderte Seite" } });
    fireEvent.click(screen.getByRole("tab", { name: "PROFILE" }));
    fireEvent.click(screen.getByRole("button", { name: 'Profil „Privat" wechseln' }));
    fireEvent.click(screen.getByRole("button", { name: "Entwurf behalten" }));

    expect(onSwitchProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Links" }));
    expect(screen.getByDisplayValue("Geänderte Seite")).toBeTruthy();
  });

  it("verlangt beim Löschen des aktiven Profils ebenfalls die Entwurfsbestätigung", () => {
    const onDeleteProfile = vi.fn((_input: DeleteProfileInput, _options?: ProfileMutationOptions) => undefined);
    renderProfiles({ onDeleteProfile, initialSection: "profile" });

    fireEvent.click(screen.getByRole("tab", { name: "Links" }));
    fireEvent.change(screen.getByDisplayValue("Datasphere"), { target: { value: "Geänderte Seite" } });
    fireEvent.click(screen.getByRole("tab", { name: "PROFILE" }));
    const del = screen.getByRole("button", { name: 'Profil „Arbeit" löschen' });
    fireEvent.click(del);
    fireEvent.click(screen.getByRole("button", { name: /Profil „Arbeit" endgültig löschen/ }));
    expect(onDeleteProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Entwurf verwerfen und Profil löschen" }));
    expect(onDeleteProfile).toHaveBeenCalledOnce();
  });

  it("löscht inaktive Profile ohne den Config-Entwurf zu verwerfen", () => {
    const onDeleteProfile = vi.fn((_input: DeleteProfileInput, _options?: ProfileMutationOptions) => undefined);
    renderProfiles({ onDeleteProfile, initialSection: "profile" });

    fireEvent.click(screen.getByRole("tab", { name: "Links" }));
    fireEvent.change(screen.getByDisplayValue("Datasphere"), { target: { value: "Geänderte Seite" } });
    fireEvent.click(screen.getByRole("tab", { name: "PROFILE" }));
    const del = screen.getByRole("button", { name: 'Profil „Privat" löschen' });
    fireEvent.click(del);
    fireEvent.click(screen.getByRole("button", { name: /Profil „Privat" endgültig löschen/ }));

    expect(onDeleteProfile).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Entwurf verwerfen und Profil löschen" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Links" }));
    expect(screen.getByDisplayValue("Geänderte Seite")).toBeTruthy();
  });
});
