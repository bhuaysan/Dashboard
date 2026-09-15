import { useEffect, useRef, useState } from "react";
import { configSchema, type Config, type ProfileId } from "../config/schema";
import { describeIssue, issueRootKey } from "../config/describeIssue";
import { ConfigConflictError } from "../api/config";
import {
  ProfileConflictError,
  type CatalogMutationData,
  type CreateProfileInput,
  type DeleteProfileInput,
  type RenameProfileInput,
} from "../api/profiles";
import type { ProfileCatalog } from "../config/local";
import { profileApiUrl } from "../api/profileUrl";

type Guest = { vmid: number; name: string };
type SaveOptions = {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
};

export type SaveConfig = {
  mutate: (config: Config, options?: SaveOptions) => void;
  isPending: boolean;
};

export type ProfileMutationOptions = {
  onSuccess?: (data: CatalogMutationData) => void;
  onError?: (error: unknown) => void;
};

export type CreateProfile = (input: CreateProfileInput, options?: ProfileMutationOptions) => void;
export type RenameProfile = (input: RenameProfileInput, options?: ProfileMutationOptions) => void;
export type DeleteProfile = (input: DeleteProfileInput, options?: ProfileMutationOptions) => void;

type Props = {
  open: boolean;
  config: Config;
  profileId: ProfileId;
  profiles: ProfileCatalog | undefined;
  activeProfileId: ProfileId | undefined;
  guests: Guest[];
  onClose: () => void;
  save: SaveConfig;
  onReload?: () => Promise<Config | undefined>;
  onReloadProfiles?: () => Promise<ProfileCatalog | undefined>;
  onSwitchProfile: (profileId: ProfileId) => void;
  onCreateProfile: CreateProfile;
  onRenameProfile: RenameProfile;
  onDeleteProfile: DeleteProfile;
  initialSection?: Sec;
  /** Ausschließlich die Erfolgsmeldung außerhalb des Dialogs — Schließen und Fehlerfall
      übernimmt der Dialog selbst, weil nur er weiß, ob der Entwurf erhalten bleiben muss. */
  onSaved: () => void;
};

const SECTIONS = [
  ["profile", "PROFILE"],
  ["links", "Links"],
  ["feeds", "Feeds"],
  ["cal", "Kalender"],
  ["place", "Ort & Zeit"],
  ["layout", "Layout"],
  ["lab", "Homelab"],
  ["search", "Suche"],
  ["proxy", "Proxy"],
] as const;
type Sec = (typeof SECTIONS)[number][0];

// Ordnet einen Zod-Pfad seinem Abschnitt zu, damit ein Fehler tief in der Konfiguration
// den Nutzer auch zu dem Reiter bringt, der das Feld tatsächlich zeigt.
const SECTION_BY_ROOT: Record<string, Sec> = {
  theme: "layout", layout: "layout",
  clock: "place", location: "place", holidayRegion: "place",
  linkGroups: "links",
  feeds: "feeds",
  calendars: "cal",
  search: "search",
  proxyAllowlist: "proxy",
  homelab: "lab",
};

function RowActs({ label, first, last, onMove, onDel }: {
  label: string; first: boolean; last: boolean; onMove: (delta: number) => void; onDel: () => void;
}) {
  return (
    <span className="rowacts">
      <button type="button" className="rowact" disabled={first} onClick={() => onMove(-1)} aria-label={`${label} nach oben`}>↑</button>
      <button type="button" className="rowact" disabled={last} onClick={() => onMove(1)} aria-label={`${label} nach unten`}>↓</button>
      <button type="button" className="rowact rowact--del" onClick={onDel} aria-label={`${label} löschen`}>✕</button>
    </span>
  );
}

/**
 * Zahlenfeld, das den Tippzustand aushält. Vorher machte `Number("") || 0` aus einem
 * geleerten Schwellwert sofort eine 0 — und eine 0 als Storage-Schwelle heißt: jedes
 * Storage schlägt Alarm. Der Text bleibt hier stehen, nach außen geht nur eine gültige
 * Zahl; beim Verlassen springt das Feld auf den letzten gültigen Wert zurück.
 */
function NumInput({ value, min, onCommit, className, ...rest }: {
  value: number;
  min: number;
  onCommit: (n: number) => void;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  return (
    <input
      {...rest}
      className={className}
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= min) onCommit(n);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

function move<T>(arr: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= arr.length) return arr;
  const current = arr[i];
  const target = arr[j];
  if (current === undefined || target === undefined) return arr;
  const next = [...arr];
  next[i] = target;
  next[j] = current;
  return next;
}

type BangRow = { key: string; tpl: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGeocodingHit(value: unknown): value is { name: string; latitude: number; longitude: number } {
  if (!isRecord(value)) return false;
  return typeof value.name === "string" && value.name.trim() !== "" &&
    typeof value.latitude === "number" && Number.isFinite(value.latitude) &&
    value.latitude >= -90 && value.latitude <= 90 &&
    typeof value.longitude === "number" && Number.isFinite(value.longitude) &&
    value.longitude >= -180 && value.longitude <= 180;
}

function isVisibleFocusable(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true" ||
      element.closest("[hidden], [aria-hidden=\"true\"]") !== null) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function serializeConfig(config: Config): string {
  const parsed = configSchema.safeParse(config);
  const value: unknown = parsed.success ? parsed.data : config;
  return JSON.stringify(value) ?? "";
}

function normalizedProfileName(name: string): string {
  return name.trim().toLocaleLowerCase("de-DE");
}

function profileNameError(name: string, profiles: ProfileCatalog, excludedId?: ProfileId): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Profilname darf nicht leer sein.";
  if (trimmed.length > 64) return "Profilname darf höchstens 64 Zeichen lang sein.";
  if (profiles.profiles.some((profile) => profile.id !== excludedId && normalizedProfileName(profile.name) === normalizedProfileName(trimmed))) {
    return "Profilname ist bereits vergeben.";
  }
  return undefined;
}

type DiscardAction =
  | { kind: "switch"; profileId: ProfileId }
  | { kind: "delete"; profileId: ProfileId };

export function SettingsPane({
  open,
  config,
  profileId,
  profiles,
  activeProfileId,
  guests,
  onClose,
  save,
  onSaved,
  onReload,
  onReloadProfiles,
  onSwitchProfile,
  onCreateProfile,
  onRenameProfile,
  onDeleteProfile,
  initialSection,
}: Props) {
  const [draft, setDraft] = useState<Config>(config);
  const [sec, setSec] = useState<Sec>(initialSection ?? "links");
  const [error, setError] = useState<string | undefined>(undefined);
  const [placeQuery, setPlaceQuery] = useState(config.location.label);
  const [searching, setSearching] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [catalogConflict, setCatalogConflict] = useState(false);
  const [reloadingProfiles, setReloadingProfiles] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [createName, setCreateName] = useState("");
  const [renameNames, setRenameNames] = useState<Record<string, string>>({});
  const [confirmDelProfile, setConfirmDelProfile] = useState<ProfileId | null>(null);
  const [discardAction, setDiscardAction] = useState<DiscardAction | undefined>(undefined);
  // Index der Gruppe, deren ✕ schon einmal geklickt wurde. Nur eine gleichzeitig — ein
  // zweiter Klick woanders meint eine neue Absicht, keine Bestätigung der ersten.
  const [confirmDelGroup, setConfirmDelGroup] = useState<number | null>(null);
  // Bangs sind in der Config ein Objekt. Beim Umbenennen im Objekt frisst ein bereits
  // vergebener Schlüssel den anderen Eintrag stillschweigend auf — also wird hier eine
  // Liste bearbeitet und erst beim Speichern wieder zum Objekt gefaltet.
  const [bangs, setBangs] = useState<BangRow[]>(() =>
    Object.entries(config.search.bangs).map(([key, tpl]) => ({ key, tpl })),
  );
  const boxRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const placeRequest = useRef(0);
  const configSnapshot = useRef(serializeConfig(config));
  const activeProfileSnapshot = useRef<ProfileId | undefined>(activeProfileId);

  const selectedProfile = profiles?.profiles.find((profile) => profile.id === activeProfileId);
  const profileReady = profiles !== undefined && activeProfileId !== undefined && selectedProfile !== undefined;
  const draftForComparison: Config = {
    ...draft,
    search: {
      ...draft.search,
      bangs: Object.fromEntries(bangs.map((bang) => [bang.key.trim(), bang.tpl])),
    },
  };
  const draftDirty = serializeConfig(draftForComparison) !== configSnapshot.current;
  const draftDirtyRef = useRef(draftDirty);
  draftDirtyRef.current = draftDirty;

  // Nur beim Öffnen selbst aus config neu befüllen — config pollt alle 15 s vom Server
  // nach, und ein Effekt auf [open, config] würde bei jeder echten Änderung während
  // einer laufenden Bearbeitung den halb fertigen Entwurf stillschweigend überschreiben.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(config);
      configSnapshot.current = serializeConfig(config);
      activeProfileSnapshot.current = activeProfileId;
      setPlaceQuery(config.location.label);
      setBangs(Object.entries(config.search.bangs).map(([key, tpl]) => ({ key, tpl })));
      setSec(initialSection ?? "links");
      setCreateName("");
      setRenameNames(Object.fromEntries((profiles?.profiles ?? []).map((profile) => [profile.id, profile.name])));
      setError(undefined);
      setConfirmDelGroup(null);
      setConfirmDelProfile(null);
      setDiscardAction(undefined);
      setConflict(false);
      setCatalogConflict(false);
    }
    wasOpen.current = open;
  }, [open, config, initialSection, profiles, activeProfileId]);

  // Ein bestätigter Profilwechsel lässt das Overlay offen. Sobald die neue lokale
  // Config als Prop ankommt, wird deshalb ein neuer Entwurfssnapshot begonnen —
  // spätere Polls desselben Profils dürfen eine laufende Bearbeitung weiterhin nicht
  // überschreiben.
  useEffect(() => {
    if (!open || !profileReady || activeProfileSnapshot.current === activeProfileId) return;
    activeProfileSnapshot.current = activeProfileId;
    setDraft(config);
    configSnapshot.current = serializeConfig(config);
    setPlaceQuery(config.location.label);
    setBangs(Object.entries(config.search.bangs).map(([key, tpl]) => ({ key, tpl })));
    setConfirmDelGroup(null);
    setConfirmDelProfile(null);
    setDiscardAction(undefined);
    setError(undefined);
    setConflict(false);
  }, [activeProfileId, config, open, profileReady]);

  // Fokus in den Dialog und beim Schließen zurück auf die Stelle, von der er kam.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    boxRef.current?.focus();
    return () => restoreRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Tab darf den Dialog nicht verlassen: dahinter liegt die ganze Seite, und wer
  // hinausfällt, tippt unsichtbar weiter, während der Dialog noch offen ist.
  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const box = boxRef.current;
    if (!box) return;
    const focusable = [...box.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((el) => el.tabIndex >= 0 && isVisibleFocusable(el));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (!box.contains(document.activeElement) || (e.shiftKey && (document.activeElement === first || document.activeElement === box))) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  }

  const upd = (fn: (d: Config) => Config) => setDraft((d) => fn(d));

  async function searchPlace() {
    const request = placeRequest.current + 1;
    placeRequest.current = request;
    setSearching(true);
    setError(undefined);
    try {
      const target = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(placeQuery)}&count=1&language=de`;
      const res = await fetch(profileApiUrl("/api/proxy", profileId, new URLSearchParams({ url: target })));
      if (request !== placeRequest.current) {
        try { await res.body?.cancel(); } catch { /* veraltete Antwort wird verworfen */ }
        return;
      }
      if (!res.ok) {
        setError("Ortssuche fehlgeschlagen.");
        return;
      }
      const raw: unknown = await res.json();
      if (request !== placeRequest.current) return;
      if (!isRecord(raw) || !Array.isArray(raw.results)) {
        setError("Ortssuche fehlgeschlagen.");
        return;
      }
      const hit = raw.results[0];
      if (hit === undefined) {
        setError(`Ort „${placeQuery}" nicht gefunden.`);
      } else if (!isGeocodingHit(hit)) {
        setError("Ortssuche fehlgeschlagen.");
      } else {
        upd((d) => ({ ...d, location: { label: hit.name, lat: hit.latitude, lon: hit.longitude } }));
      }
    } catch {
      if (request === placeRequest.current) setError("Ortssuche fehlgeschlagen.");
    } finally {
      if (request === placeRequest.current) setSearching(false);
    }
  }

  function handleProfileError(err: unknown) {
    setProfileBusy(false);
    if (err instanceof ProfileConflictError) {
      setCatalogConflict(true);
      setError("Ein anderes Gerät hat den Profilkatalog geändert. Bitte Serverstand neu laden.");
    } else {
      setError("Profiländerung fehlgeschlagen.");
    }
  }

  function handleSwitchProfile(nextProfileId: ProfileId) {
    if (!profileReady || catalogConflict || nextProfileId === activeProfileId) return;
    if (draftDirty) {
      setDiscardAction({ kind: "switch", profileId: nextProfileId });
      return;
    }
    onSwitchProfile(nextProfileId);
  }

  function submitCreateProfile() {
    if (!profileReady || profiles === undefined || activeProfileId === undefined || catalogConflict) return;
    const name = createName.trim();
    const nameError = profileNameError(name, profiles);
    if (nameError !== undefined) {
      setError(nameError);
      return;
    }
    setError(undefined);
    setProfileBusy(true);
    onCreateProfile(
      { name, sourceProfileId: activeProfileId, profilesUpdatedAt: profiles.profilesUpdatedAt },
      {
        onSuccess: (data) => {
          setProfileBusy(false);
          const createdId = data.createdId;
          if (createdId === undefined) {
            setError("Profil konnte nicht angelegt werden.");
            return;
          }
          setCreateName("");
          if (draftDirtyRef.current) {
            setDiscardAction({ kind: "switch", profileId: createdId });
          } else {
            onSwitchProfile(createdId);
          }
        },
        onError: handleProfileError,
      },
    );
  }

  function submitRenameProfile(profileIdToRename: ProfileId) {
    if (!profileReady || profiles === undefined || catalogConflict) return;
    const current = profiles.profiles.find((profile) => profile.id === profileIdToRename);
    if (current === undefined) return;
    const name = (renameNames[profileIdToRename] ?? current.name).trim();
    const nameError = profileNameError(name, profiles, profileIdToRename);
    if (nameError !== undefined) {
      setError(nameError);
      return;
    }
    setError(undefined);
    setProfileBusy(true);
    onRenameProfile(
      { profileId: profileIdToRename, name, profilesUpdatedAt: profiles.profilesUpdatedAt },
      {
        onSuccess: (data) => {
          setProfileBusy(false);
          const renamed = data.catalog.profiles.find((profile) => profile.id === profileIdToRename);
          if (renamed !== undefined) {
            setRenameNames((names) => ({ ...names, [profileIdToRename]: renamed.name }));
          } else {
            setRenameNames((names) => ({ ...names, [profileIdToRename]: name }));
          }
        },
        onError: handleProfileError,
      },
    );
  }

  function performDeleteProfile(profileIdToDelete: ProfileId) {
    if (!profileReady || profiles === undefined || catalogConflict || profiles.profiles.length <= 1) return;
    setError(undefined);
    setProfileBusy(true);
    onDeleteProfile(
      { profileId: profileIdToDelete, profilesUpdatedAt: profiles.profilesUpdatedAt },
      {
        onSuccess: (data) => {
          setProfileBusy(false);
          setConfirmDelProfile(null);
          if (profileIdToDelete === activeProfileId) {
            const firstRemaining = data.catalog.profiles[0];
            if (firstRemaining !== undefined) onSwitchProfile(firstRemaining.id);
          }
        },
        onError: handleProfileError,
      },
    );
  }

  function requestDeleteProfile(profileIdToDelete: ProfileId) {
    if (profileIdToDelete === activeProfileId && draftDirty) {
      setDiscardAction({ kind: "delete", profileId: profileIdToDelete });
      return;
    }
    performDeleteProfile(profileIdToDelete);
  }

  function confirmDiscard() {
    const action = discardAction;
    setDiscardAction(undefined);
    if (action === undefined) return;
    if (action.kind === "switch") {
      onSwitchProfile(action.profileId);
    } else {
      setConfirmDelProfile(null);
      performDeleteProfile(action.profileId);
    }
  }

  function cancelDiscard() {
    const action = discardAction;
    setDiscardAction(undefined);
    if (action?.kind === "delete") setConfirmDelProfile(null);
  }

  const guestChoices = [...guests];
  for (const vmid of draft.homelab.expectRunning) {
    if (!guestChoices.some((guest) => guest.vmid === vmid)) {
      guestChoices.push({ vmid, name: "nicht mehr vorhanden" });
    }
  }
  guestChoices.sort((a, b) => a.vmid - b.vmid);

  function handleSave() {
    if (conflict) return;
    const hints = draft.linkGroups.flatMap((g) => g.links.map((l) => l.hint)).filter((h): h is string => !!h);
    if (new Set(hints).size !== hints.length) {
      setError("Doppelte Link-Kürzel — jedes Kürzel darf nur einmal vorkommen.");
      return;
    }
    // Getippt wird g und dann ein Zeichen; das Kürzel enthält das g, sonst wird es nie erkannt.
    const badHint = hints.find((h) => !/^g.$/u.test(h));
    if (badHint !== undefined) {
      setError(`Kürzel „${badHint}" ist ungültig — es muss mit g beginnen und genau zwei Zeichen haben.`);
      return;
    }
    const badUrl = draft.linkGroups
      .flatMap((g) => g.links)
      .find((l) => !/^https?:\/\//i.test(l.url));
    if (badUrl) {
      setError(`Adresse von „${badUrl.label}" muss mit http:// oder https:// beginnen.`);
      return;
    }
    const emptyBang = bangs.find((b) => b.key.trim() === "");
    if (emptyBang !== undefined) {
      setError("Ein Bang ohne Kürzel lässt sich nicht tippen — Kürzel eintragen oder Zeile löschen.");
      return;
    }
    const bangKeys = bangs.map((b) => b.key.trim());
    const dupBang = bangKeys.find((k, i) => bangKeys.indexOf(k) !== i);
    if (dupBang !== undefined) {
      setError(`Bang „!${dupBang}" ist doppelt vergeben — jedes Kürzel darf nur einmal vorkommen.`);
      return;
    }
    for (const [label, tpl] of [
      ["Standardsuche", draft.search.default] as const,
      ...bangs.map((b) => [`Bang !${b.key.trim()}`, b.tpl] as const),
    ]) {
      if (!/^https?:\/\//i.test(tpl)) {
        setError(`${label} muss mit http:// oder https:// beginnen.`);
        return;
      }
    }
    for (const z of draft.clock.secondary) {
      try {
        new Intl.DateTimeFormat("de-DE", { timeZone: z.tz });
      } catch {
        setError(`Unbekannte Zeitzone: ${z.tz}`);
        return;
      }
    }
    const candidate: Config = {
      ...draft,
      search: {
        ...draft.search,
        bangs: Object.fromEntries(bangs.map((b) => [b.key.trim(), b.tpl])),
      },
    };
    const parsed = configSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue === undefined) {
        setError("Ungültige Konfiguration.");
        return;
      }
      // Statt des rohen Zod-Pfads eine lesbare Beschreibung — und gleich zu dem
      // Abschnitt springen, der das betroffene Feld tatsächlich zeigt.
      setError(describeIssue(issue));
      const target = SECTION_BY_ROOT[issueRootKey(issue) ?? ""];
      if (target) setSec(target);
      return;
    }
    setError(undefined);
    save.mutate(parsed.data, {
      onSuccess: () => {
        onSaved();
        onClose();
      },
      onError: (err) => {
        if (err instanceof ConfigConflictError) {
          setConflict(true);
          setError("Ein anderes Gerät hat die Einstellungen geändert. Bitte Serverstand neu laden.");
        } else {
          setError("Server nicht erreichbar — Speichern ist gesperrt. Der Entwurf bleibt in diesem Fenster erhalten.");
        }
      },
    });
  }

  async function reloadServerConfig() {
    if (!onReload) {
      setError("Serverstand kann hier nicht neu geladen werden.");
      return;
    }
    setReloading(true);
    try {
      const current = await onReload();
      if (!current) {
        setError("Serverstand konnte nicht geladen werden.");
        return;
      }
      setDraft(current);
      configSnapshot.current = serializeConfig(current);
      setPlaceQuery(current.location.label);
      setBangs(Object.entries(current.search.bangs).map(([key, tpl]) => ({ key, tpl })));
      setConflict(false);
      setError(undefined);
    } catch {
      setError("Serverstand konnte nicht geladen werden.");
    } finally {
      setReloading(false);
    }
  }

  async function reloadProfileCatalog() {
    if (!onReloadProfiles) {
      setError("Profilkatalog kann hier nicht neu geladen werden.");
      return;
    }
    setReloadingProfiles(true);
    try {
      const current = await onReloadProfiles();
      if (current === undefined) {
        setError("Profilkatalog konnte nicht geladen werden.");
        return;
      }
      setCatalogConflict(false);
      setError(undefined);
    } catch {
      setError("Profilkatalog konnte nicht geladen werden.");
    } finally {
      setReloadingProfiles(false);
    }
  }

  if (!open) return null;

  if (!profileReady) {
    return (
      <div className="overlay">
        <div className="overlay-box set-box" role="dialog" aria-modal="true" aria-labelledby="set-title">
          <div className="set-head">
            <h2 id="set-title">Einstellungen</h2>
          </div>
          <p className="set-hint">Profile werden geladen — Einstellungen sind gleich verfügbar.</p>
          <div className="set-foot">
            <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay">
      <div
        className="overlay-box set-box"
        ref={boxRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-title"
        onKeyDown={trapTab}
      >
        <div className="set-head">
          <h2 id="set-title">Einstellungen</h2>
          <span className="path">config.json auf dem Server — gilt nach dem Speichern auf allen Geräten</span>
        </div>

        <div className="set-layout">
          <div className="set-nav" role="tablist" aria-orientation="vertical" aria-label="Abschnitte">
            {SECTIONS.map(([id, label], i) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`set-tab-${id}`}
                aria-selected={sec === id}
                aria-controls="set-panel"
                // Rovender Tabindex: die Liste ist ein Tabstopp, innerhalb wird mit
                // den Pfeiltasten gewechselt — so wie Tabs es überall tun.
                tabIndex={sec === id ? 0 : -1}
                className={sec === id ? "is-active" : undefined}
                onClick={() => setSec(id)}
                onKeyDown={(e) => {
                  const delta = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
                  if (delta === 0) return;
                  const next = SECTIONS[(i + delta + SECTIONS.length) % SECTIONS.length];
                  if (!next) return;
                  setSec(next[0]);
                  document.getElementById(`set-tab-${next[0]}`)?.focus();
                  e.preventDefault();
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="set-body" id="set-panel" role="tabpanel" aria-labelledby={`set-tab-${sec}`}>
            {sec === "profile" && (
              <section aria-labelledby="profile-section-title">
                <h3 id="profile-section-title" className="sr-only">Profile</h3>
                <p className="set-hint">Das aktive Profil gilt nur auf diesem Gerät. Ein neues Profil ist eine Kopie des aktuell aktiven Profils.</p>
                <div className="profile-list" role="table" aria-label="Profile">
                  <div className="tbl-head profile-row" role="row">
                    <span role="columnheader">Profil</span>
                    <span role="columnheader">Aktionen</span>
                  </div>
                  {profiles.profiles.map((profile) => {
                    const active = profile.id === activeProfileId;
                    const displayName = renameNames[profile.id] ?? profile.name;
                    const armed = confirmDelProfile === profile.id;
                    const canDelete = profiles.profiles.length > 1;
                    return (
                      <div
                        className={`profile-row${active ? " is-active" : ""}`}
                        key={profile.id}
                        role="row"
                        aria-current={active ? "true" : undefined}
                        aria-label={`${displayName}${active ? ", aktiv" : ""}`}
                      >
                        <div className="profile-name" role="cell">
                          <input
                            className="inp"
                            value={displayName}
                            aria-label={`Profilname „${profile.name}"`}
                            maxLength={64}
                            onChange={(e) => setRenameNames((names) => ({ ...names, [profile.id]: e.target.value }))}
                          />
                          {active && <span className="profile-active">aktiv</span>}
                        </div>
                        <span className="rowacts" role="cell">
                          <button
                            type="button"
                            className="rowact"
                            disabled={active || profileBusy || catalogConflict}
                            onClick={() => handleSwitchProfile(profile.id)}
                            aria-label={active ? `Profil „${profile.name}" aktiv` : `Profil „${profile.name}" wechseln`}
                          >
                            {active ? "aktiv" : "wechseln"}
                          </button>
                          <button
                            type="button"
                            className="rowact"
                            disabled={profileBusy || catalogConflict}
                            onClick={() => submitRenameProfile(profile.id)}
                            aria-label={`Profil „${profile.name}" umbenennen`}
                          >
                            umbenennen
                          </button>
                          <button
                            type="button"
                            className={`rowact rowact--del${armed ? " is-confirm" : ""}`}
                            disabled={!canDelete || profileBusy || catalogConflict}
                            onClick={armed ? () => requestDeleteProfile(profile.id) : () => setConfirmDelProfile(profile.id)}
                            onBlur={() => setConfirmDelProfile((current) => current === profile.id ? null : current)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape" && armed) {
                                setConfirmDelProfile(null);
                                e.stopPropagation();
                              }
                            }}
                            aria-label={
                              armed
                                ? `Profil „${profile.name}" endgültig löschen — noch einmal klicken zum Bestätigen`
                                : `Profil „${profile.name}" löschen`
                            }
                          >
                            {armed ? "löschen?" : "löschen"}
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="profile-create">
                  <label htmlFor="s-profile-name">Neuer Profilname</label>
                  <span className="profile-create-controls">
                    <input
                      className="inp"
                      id="s-profile-name"
                      value={createName}
                      maxLength={64}
                      onChange={(e) => setCreateName(e.target.value)}
                    />
                    <button type="button" className="btn" disabled={profileBusy || catalogConflict} onClick={submitCreateProfile}>
                      Profil duplizieren
                    </button>
                  </span>
                </div>

                {catalogConflict && (
                  <button type="button" className="btn" onClick={() => void reloadProfileCatalog()} disabled={reloadingProfiles}>
                    {reloadingProfiles ? "lädt…" : "Profilkatalog neu laden"}
                  </button>
                )}
              </section>
            )}

            {sec === "links" && (
              <section>
                <p className="set-hint">Kürzel beginnen mit <b>g</b> und sind genau zwei Zeichen lang — <b>gd</b> heißt: erst g, dann d. Doppelte Kürzel werden beim Speichern abgelehnt.</p>
                {draft.linkGroups.map((g, gi) => (
                  <div key={gi}>
                    <div className="grouprow">
                      <input
                        className="inp"
                        style={{ maxWidth: "24ch" }}
                        value={g.title}
                        aria-label={`Gruppenname von „${g.title}"`}
                        onChange={(e) => upd((d) => ({
                          ...d,
                          linkGroups: d.linkGroups.map((x, i) => i === gi ? { ...x, title: e.target.value } : x),
                        }))}
                      />
                      <span className="rowacts">
                        <button type="button" className="rowact" disabled={gi === 0}
                          onClick={() => upd((d) => ({ ...d, linkGroups: move(d.linkGroups, gi, -1) }))}
                          aria-label={`Gruppe „${g.title}" nach oben`}>↑</button>
                        <button type="button" className="rowact" disabled={gi === draft.linkGroups.length - 1}
                          onClick={() => upd((d) => ({ ...d, linkGroups: move(d.linkGroups, gi, 1) }))}
                          aria-label={`Gruppe „${g.title}" nach unten`}>↓</button>
                        {(() => {
                          const armed = confirmDelGroup === gi;
                          const n = g.links.length;
                          const del = () => {
                            upd((d) => ({ ...d, linkGroups: d.linkGroups.filter((_, i) => i !== gi) }));
                            setConfirmDelGroup(null);
                          };
                          return (
                            <button
                              type="button"
                              className={`rowact rowact--del${armed ? " is-confirm" : ""}`}
                              aria-label={
                                armed
                                  ? `„${g.title}" mit ${n} ${n === 1 ? "Link" : "Links"} endgültig löschen — noch einmal klicken zum Bestätigen`
                                  : `Gruppe „${g.title}" löschen`
                              }
                              // Nichts zu verlieren: eine leere Gruppe löscht sofort, ohne den
                              // Zwischenschritt, der nur für echten Inhalt lohnt.
                              onClick={n === 0 ? del : armed ? del : () => setConfirmDelGroup(gi)}
                              onBlur={() => setConfirmDelGroup((cur) => (cur === gi ? null : cur))}
                              onKeyDown={(e) => {
                                if (e.key === "Escape" && armed) {
                                  setConfirmDelGroup(null);
                                  e.stopPropagation();
                                }
                              }}
                            >
                              {armed ? "löschen?" : "✕"}
                            </button>
                          );
                        })()}
                      </span>
                    </div>
                    <div className="tbl tbl--links">
                      <div className="tbl-head"><span>Kürzel</span><span>Name</span><span>URL</span><span /></div>
                      {g.links.map((l, li) => (
                        <div className="tbl-row" key={li}>
                          <input className="inp inp--hint" value={l.hint ?? ""} maxLength={2} aria-label={`Kürzel von Link „${l.label}" Zeile ${li + 1}`}
                            onChange={(e) => upd((d) => ({
                              ...d,
                              linkGroups: d.linkGroups.map((x, i) => i !== gi ? x : {
                                ...x,
                                links: x.links.map((y, j) => j === li
                                  ? { ...y, hint: e.target.value === "" ? undefined : e.target.value.toLowerCase() }
                                  : y),
                              }),
                            }))}
                          />
                          <input className="inp" value={l.label} aria-label={`Name von Link „${l.label}" Zeile ${li + 1}`}
                            onChange={(e) => upd((d) => ({
                              ...d,
                              linkGroups: d.linkGroups.map((x, i) => i !== gi ? x : {
                                ...x,
                                links: x.links.map((y, j) => j === li ? { ...y, label: e.target.value } : y),
                              }),
                            }))}
                          />
                          <input className="inp" value={l.url} aria-label={`URL von Link „${l.label}" Zeile ${li + 1}`}
                            onChange={(e) => upd((d) => ({
                              ...d,
                              linkGroups: d.linkGroups.map((x, i) => i !== gi ? x : {
                                ...x,
                                links: x.links.map((y, j) => j === li ? { ...y, url: e.target.value } : y),
                              }),
                            }))}
                          />
                          <RowActs label={`Link „${l.label}"`} first={li === 0} last={li === g.links.length - 1}
                            onMove={(delta) => upd((d) => ({
                              ...d,
                              linkGroups: d.linkGroups.map((x, i) => i === gi ? { ...x, links: move(x.links, li, delta) } : x),
                            }))}
                            onDel={() => upd((d) => ({
                              ...d,
                              linkGroups: d.linkGroups.map((x, i) => i === gi ? { ...x, links: x.links.filter((_, j) => j !== li) } : x),
                            }))}
                          />
                        </div>
                      ))}
                    </div>
                    <p className="addline">
                      <button type="button" className="btn" onClick={() => upd((d) => ({
                        ...d,
                        linkGroups: d.linkGroups.map((x, i) => i === gi
                          ? { ...x, links: [...x.links, { label: "Neuer Link", url: "https://" }] }
                          : x),
                      }))}>+ Link</button>
                    </p>
                  </div>
                ))}
                <p className="addline">
                  <button type="button" className="btn" onClick={() => upd((d) => ({
                    ...d,
                    linkGroups: [...d.linkGroups, { title: "Neue Gruppe", links: [] }],
                  }))}>+ Gruppe</button>
                </p>
              </section>
            )}

            {sec === "feeds" && (
              <section>
                <p className="set-hint">Feeds werden über den eigenen Server geladen. Ihr Host wird automatisch für den Proxy freigegeben.</p>
                <div className="tbl tbl--feeds">
                  <div className="tbl-head"><span>Name</span><span>URL</span><span>Anzahl</span><span /></div>
                  {draft.feeds.map((f, i) => (
                    <div className="tbl-row" key={i}>
                      <input className="inp" value={f.label} aria-label={`Name von Feed „${f.label}" Zeile ${i + 1}`}
                        onChange={(e) => upd((d) => ({ ...d, feeds: d.feeds.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
                      <input className="inp" value={f.url} aria-label={`URL von Feed „${f.label}" Zeile ${i + 1}`}
                        onChange={(e) => upd((d) => ({ ...d, feeds: d.feeds.map((x, j) => j === i ? { ...x, url: e.target.value } : x) }))} />
                      <NumInput className="inp inp--num" value={f.limit} min={1} aria-label={`Anzahl von Feed „${f.label}" Zeile ${i + 1}`}
                        onCommit={(n) => upd((d) => ({ ...d, feeds: d.feeds.map((x, j) => j === i ? { ...x, limit: n } : x) }))} />
                      <RowActs label={`Feed „${f.label}"`} first={i === 0} last={i === draft.feeds.length - 1}
                        onMove={(delta) => upd((d) => ({ ...d, feeds: move(d.feeds, i, delta) }))}
                        onDel={() => upd((d) => ({ ...d, feeds: d.feeds.filter((_, j) => j !== i) }))} />
                    </div>
                  ))}
                </div>
                <p className="addline">
                  <button type="button" className="btn" onClick={() => upd((d) => ({
                    ...d, feeds: [...d.feeds, { label: "neu", url: "https://", limit: 5 }],
                  }))}>+ Feed</button>
                </p>
              </section>
            )}

            {sec === "cal" && (
              <section>
                <p className="set-hint">ICS-Adresse eines veröffentlichten Kalenders. Liegt die Datei auf dem Dashboard-Server selbst, genügt ein Pfad wie <b>/static/arbeit.ics</b>.</p>
                <div className="tbl tbl--feeds">
                  <div className="tbl-head"><span>Name</span><span>ICS-URL</span><span /><span /></div>
                  {draft.calendars.map((c, i) => (
                    <div className="tbl-row" key={i}>
                      <input className="inp" value={c.label} aria-label={`Name von Kalender „${c.label}" Zeile ${i + 1}`}
                        onChange={(e) => upd((d) => ({ ...d, calendars: d.calendars.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
                      <input className="inp" value={c.url} aria-label={`ICS-URL von Kalender „${c.label}" Zeile ${i + 1}`}
                        onChange={(e) => upd((d) => ({ ...d, calendars: d.calendars.map((x, j) => j === i ? { ...x, url: e.target.value } : x) }))} />
                      <span />
                      <RowActs label={`Kalender „${c.label}"`} first={i === 0} last={i === draft.calendars.length - 1}
                        onMove={(delta) => upd((d) => ({ ...d, calendars: move(d.calendars, i, delta) }))}
                        onDel={() => upd((d) => ({ ...d, calendars: d.calendars.filter((_, j) => j !== i) }))} />
                    </div>
                  ))}
                </div>
                <p className="addline">
                  <button type="button" className="btn" onClick={() => upd((d) => ({
                    ...d, calendars: [...d.calendars, { label: "neu", url: "" }],
                  }))}>+ Kalender</button>
                </p>
              </section>
            )}

            {sec === "place" && (
              <section>
                <div className="field">
                  <label htmlFor="s-city">Ort suchen</label>
                  <span style={{ display: "flex", gap: ".5rem" }}>
                    <input className="inp" id="s-city" value={placeQuery}
                      onChange={(e) => setPlaceQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void searchPlace(); }} />
                    <button type="button" className="btn" disabled={searching} onClick={() => void searchPlace()}>
                      {searching ? "sucht…" : "suchen"}
                    </button>
                  </span>
                </div>
                <div className="field">
                  <label>Koordinaten</label>
                  <span className="dim">{draft.location.label} · {draft.location.lat} · {draft.location.lon}</span>
                </div>
                <div className="field">
                  <label htmlFor="s-holiday-region">Feiertagsregion</label>
                  <select className="inp" id="s-holiday-region" value={draft.holidayRegion}
                    onChange={(e) => {
                      const region = e.target.value;
                      if (region === "BW" || region === "NRW") {
                        upd((d) => ({ ...d, holidayRegion: region }));
                      }
                    }}
                  >
                    <option value="BW">Baden-Württemberg</option>
                    <option value="NRW">Nordrhein-Westfalen</option>
                  </select>
                </div>
                <p className="set-hint" style={{ marginTop: "1rem" }}>Zweite Zeitzonen, erscheinen unter der Uhr.</p>
                <div className="tbl tbl--zones">
                  <div className="tbl-head"><span>Label</span><span>Zeitzone</span><span /></div>
                  {draft.clock.secondary.map((z, i) => (
                    <div className="tbl-row" key={i}>
                      <input className="inp" value={z.label} aria-label={`Label von Zeitzone Zeile ${i + 1}`}
                        onChange={(e) => upd((d) => ({ ...d, clock: { secondary: d.clock.secondary.map((x, j) => j === i ? { ...x, label: e.target.value } : x) } }))} />
                      <input className="inp" value={z.tz} aria-label={`Zeitzone von Zeile ${i + 1}`}
                        onChange={(e) => upd((d) => ({ ...d, clock: { secondary: d.clock.secondary.map((x, j) => j === i ? { ...x, tz: e.target.value } : x) } }))} />
                      <RowActs label={`Zeitzone „${z.label}"`} first={i === 0} last={i === draft.clock.secondary.length - 1}
                        onMove={(delta) => upd((d) => ({ ...d, clock: { secondary: move(d.clock.secondary, i, delta) } }))}
                        onDel={() => upd((d) => ({ ...d, clock: { secondary: d.clock.secondary.filter((_, j) => j !== i) } }))} />
                    </div>
                  ))}
                </div>
                <p className="addline">
                  <button type="button" className="btn" onClick={() => upd((d) => ({
                    ...d, clock: { secondary: [...d.clock.secondary, { label: "UTC", tz: "Etc/UTC" }] },
                  }))}>+ Zeitzone</button>
                </p>
              </section>
            )}

            {sec === "layout" && (
              <section>
                <div className="field">
                  <label htmlFor="s-theme">Theme</label>
                  <span>
                    <select className="inp" id="s-theme" style={{ maxWidth: "16ch" }} value={draft.theme}
                      onChange={(e) => {
                        const theme = e.target.value;
                        if (theme === "system" || theme === "dark" || theme === "light") {
                          upd((d) => ({ ...d, theme }));
                        }
                      }}>
                      <option value="system">system</option>
                      <option value="dark">dark</option>
                      <option value="light">light</option>
                    </select>
                  </span>
                </div>
                <p className="set-hint" style={{ marginTop: "1rem" }}>Breite in Spalten.</p>
                <p className="set-hint">Sichtbarkeit blendet nur die Pane aus; bei aktivem Monitoring bleiben Status und Alarme erhalten.</p>
                <div className="tbl tbl--panes">
                  <div className="tbl-head"><span>Pane</span><span>Sichtbar</span><span>Breite</span></div>
                  {draft.layout.map((l, i) => (
                    <div className="tbl-row" key={l.id}>
                      <span>{l.id}</span>
                      <label className="check">
                          <input type="checkbox" aria-label={`${l.id.toUpperCase()} sichtbar`} checked={l.visible}
                            disabled={l.id === "homelab" && !draft.homelab.enabled}
                            onChange={(e) => upd((d) => ({ ...d, layout: d.layout.map((x, j) => j === i ? { ...x, visible: e.target.checked } : x) }))} />
                          <span className="check-state">{l.visible ? "an" : "aus"}</span>
                      </label>
                      {l.id === "homelab" ? (
                        <span className="dim">volle Breite</span>
                      ) : (
                        <span>
                          <select className="inp" aria-label={`Breite von ${l.id.toUpperCase()}`} style={{ maxWidth: "7ch" }} value={l.span}
                            onChange={(e) => {
                              const span = Number(e.target.value);
                              if (span === 1 || span === 2) {
                                upd((d) => ({
                                  ...d,
                                  layout: d.layout.map((x, j) => j === i && x.id !== "homelab"
                                    ? { ...x, span }
                                    : x),
                                }));
                              }
                            }}>
                            <option value={1}>1</option>
                            <option value={2}>2</option>
                          </select>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {sec === "lab" && (
              <section>
                <div className="checks">
                  <label className="check">
                    <input type="checkbox" aria-label="Proxmox-Monitoring aktiv" checked={draft.homelab.enabled}
                      onChange={(e) => upd((d) => ({ ...d, homelab: { ...d.homelab, enabled: e.target.checked } }))} />
                    Proxmox-Monitoring aktiv <span className="check-state">{draft.homelab.enabled ? "an" : "aus"}</span>
                  </label>
                </div>
                <div className="field">
                  <label htmlFor="s-node">Node-Name</label>
                  <input className="inp" id="s-node" style={{ maxWidth: "16ch" }} value={draft.homelab.node}
                    onChange={(e) => upd((d) => ({ ...d, homelab: { ...d.homelab, node: e.target.value } }))} />
                </div>
                <div className="field">
                  <label htmlFor="s-uiurl">Proxmox-Oberfläche</label>
                  <input className="inp" id="s-uiurl" value={draft.homelab.uiUrl}
                    onChange={(e) => upd((d) => ({ ...d, homelab: { ...d.homelab, uiUrl: e.target.value } }))} />
                </div>
                <p className="set-hint">Ziel der Konsolen-Links in der Gästetabelle. Die Daten selbst holt der Server, nicht der Browser.</p>
                <p className="set-hint" style={{ marginTop: "1rem" }}>Gäste, die laufen sollen. Ist einer davon gestoppt, erscheint eine Alarmzeile. Alle anderen werden nur angezeigt.</p>
                <div className="checks">
                  {guestChoices.map((g) => (
                    <label className="check" key={g.vmid}>
                      <input type="checkbox" aria-label={`${g.vmid} ${g.name} soll laufen`} checked={draft.homelab.expectRunning.includes(g.vmid)}
                        onChange={(e) => upd((d) => ({
                          ...d,
                          homelab: {
                            ...d.homelab,
                            expectRunning: e.target.checked
                              ? [...d.homelab.expectRunning, g.vmid]
                              : d.homelab.expectRunning.filter((v) => v !== g.vmid),
                          },
                        }))} />
                      {g.vmid} {g.name} <span className="check-state">{draft.homelab.expectRunning.includes(g.vmid) ? "an" : "aus"}</span>
                    </label>
                  ))}
                </div>
                <p className="set-hint" style={{ marginTop: "1.1rem" }}>Schwellwerte in Prozent, Backup-Alter in Stunden.</p>
                {(["cpu", "mem", "storage", "backupAgeHours"] as const).map((key) => (
                  <div className="field" key={key}>
                    <label htmlFor={`s-${key}`}>
                      {key === "cpu" ? "CPU" : key === "mem" ? "Speicher" : key === "storage" ? "Storage" : "Backup-Alter"}
                    </label>
                    <NumInput className="inp inp--num" id={`s-${key}`} min={1}
                      value={draft.homelab.thresholds[key]}
                      onCommit={(n) => upd((d) => ({
                        ...d,
                        homelab: {
                          ...d.homelab,
                          thresholds: { ...d.homelab.thresholds, [key]: n },
                        },
                      }))} />
                  </div>
                ))}
                <p className="set-hint" style={{ marginTop: "1.1rem" }}>Erreichbarkeit: leer lassen, wenn Uptime Kuma das schon übernimmt.</p>
                <div className="tbl tbl--reach">
                  <div className="tbl-head"><span>Label</span><span>Host</span><span>Port</span><span /></div>
                  {draft.homelab.reachability.map((r, i) => (
                    <div className="tbl-row" key={i}>
                      <input className="inp" value={r.label} aria-label={`Label von Ziel „${r.label}" Zeile ${i + 1}`}
                        onChange={(e) => upd((d) => ({ ...d, homelab: { ...d.homelab, reachability: d.homelab.reachability.map((x, j) => j === i ? { ...x, label: e.target.value } : x) } }))} />
                      <input className="inp" value={r.host} aria-label={`Host von Ziel „${r.label}" Zeile ${i + 1}`}
                        onChange={(e) => upd((d) => ({ ...d, homelab: { ...d.homelab, reachability: d.homelab.reachability.map((x, j) => j === i ? { ...x, host: e.target.value } : x) } }))} />
                      <NumInput className="inp inp--num" value={r.port} min={1} aria-label={`Port von Ziel „${r.label}" Zeile ${i + 1}`}
                        onCommit={(n) => upd((d) => ({ ...d, homelab: { ...d.homelab, reachability: d.homelab.reachability.map((x, j) => j === i ? { ...x, port: n } : x) } }))} />
                      <RowActs label={`Ziel „${r.label}"`} first={i === 0} last={i === draft.homelab.reachability.length - 1}
                        onMove={(delta) => upd((d) => ({ ...d, homelab: { ...d.homelab, reachability: move(d.homelab.reachability, i, delta) } }))}
                        onDel={() => upd((d) => ({ ...d, homelab: { ...d.homelab, reachability: d.homelab.reachability.filter((_, j) => j !== i) } }))} />
                    </div>
                  ))}
                </div>
                <p className="addline">
                  <button type="button" className="btn" onClick={() => upd((d) => ({
                    ...d, homelab: { ...d.homelab, reachability: [...d.homelab.reachability, { label: "neu", host: "", port: 80 }] },
                  }))}>+ Ziel</button>
                </p>
              </section>
            )}

            {sec === "search" && (
              <section>
                <div className="field">
                  <label htmlFor="s-def">Standardsuche</label>
                  <input className="inp" id="s-def" value={draft.search.default}
                    onChange={(e) => upd((d) => ({ ...d, search: { ...d.search, default: e.target.value } }))} />
                </div>
                <p className="set-hint" style={{ marginTop: "1rem" }}><b>%s</b> wird durch die Eingabe ersetzt. Bang wird als <b>!kürzel suchbegriff</b> getippt.</p>
                <div className="tbl tbl--bangs">
                  <div className="tbl-head"><span>Bang</span><span>URL-Vorlage</span><span /></div>
                  {bangs.map((b, i) => (
                    <div className="tbl-row" key={i}>
                      <input className="inp inp--hint" value={b.key} aria-label={`Bang-Kürzel Zeile ${i + 1}`}
                        onChange={(e) => setBangs((rows) => rows.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} />
                      <input className="inp" value={b.tpl} aria-label={`URL-Vorlage von Bang Zeile ${i + 1}`}
                        onChange={(e) => setBangs((rows) => rows.map((x, j) => j === i ? { ...x, tpl: e.target.value } : x))} />
                      <RowActs label={`Bang „!${b.key}"`} first={i === 0} last={i === bangs.length - 1}
                        onMove={(delta) => setBangs((rows) => move(rows, i, delta))}
                        onDel={() => setBangs((rows) => rows.filter((_, j) => j !== i))} />
                    </div>
                  ))}
                </div>
                <p className="addline">
                  <button type="button" className="btn"
                    onClick={() => setBangs((rows) => [...rows, { key: "", tpl: "https://" }])}>+ Bang</button>
                </p>
              </section>
            )}

            {sec === "proxy" && (
              <section>
                <p className="set-hint">Nur diese Hosts darf der Server abrufen. Private Adressen sind grundsätzlich gesperrt und lassen sich hier nicht freigeben. Die Hosts eingetragener Feeds und Kalender kommen beim Speichern von selbst dazu — gelöscht bleiben sie deshalb nur, wenn auch die Quelle geht.</p>
                <div className="tbl tbl--hosts">
                  {draft.proxyAllowlist.map((h, i) => (
                    <div className="tbl-row" key={i}>
                      <input className="inp" value={h} aria-label={`Proxy-Host Zeile ${i + 1}`}
                        onChange={(e) => upd((d) => ({ ...d, proxyAllowlist: d.proxyAllowlist.map((x, j) => j === i ? e.target.value : x) }))} />
                      <RowActs label={`Proxy-Host „${h}"`} first={i === 0} last={i === draft.proxyAllowlist.length - 1}
                        onMove={(delta) => upd((d) => ({ ...d, proxyAllowlist: move(d.proxyAllowlist, i, delta) }))}
                        onDel={() => upd((d) => ({ ...d, proxyAllowlist: d.proxyAllowlist.filter((_, j) => j !== i) }))} />
                    </div>
                  ))}
                </div>
                <p className="addline">
                  <button type="button" className="btn" onClick={() => upd((d) => ({
                    ...d, proxyAllowlist: [...d.proxyAllowlist, ""],
                  }))}>+ Host</button>
                </p>
              </section>
            )}
          </div>
        </div>

        <div className="set-foot">
          <button type="button" className="btn btn--primary" onClick={handleSave} disabled={save.isPending || conflict}>
            {save.isPending ? "speichert…" : "Speichern"}
          </button>
          {conflict && (
            <button type="button" className="btn" onClick={() => void reloadServerConfig()} disabled={reloading}>
              {reloading ? "lädt…" : "Serverstand neu laden"}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <span className="note">Esc verlässt das Feld, noch einmal Esc verwirft</span>
          {error && <span className="set-error" role="alert">{error}</span>}
          <span className="spacer note">:export sichert als Datei · :import liest sie zurück</span>
        </div>

        {discardAction && (
          <div className="profile-discard" aria-live="assertive">
            <p role="alert">
              Ungespeicherter Entwurf würde beim {discardAction.kind === "switch" ? "Profilwechsel" : "Löschen des Profils"} verworfen.
            </p>
            <div className="profile-discard-actions">
              <button type="button" className="btn btn--primary" onClick={confirmDiscard}>
                Entwurf verwerfen und Profil {discardAction.kind === "switch" ? "wechseln" : "löschen"}
              </button>
              <button type="button" className="btn" onClick={cancelDiscard}>Entwurf behalten</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
