import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pane } from "./shell/Pane";
import { PaneGrid } from "./shell/PaneGrid";
import { StatusLine } from "./shell/StatusLine";
import { CommandBar, type FlatLink } from "./shell/CommandBar";
import { KeymapOverlay } from "./shell/KeymapOverlay";
import {
  initialUiState,
  PANE_ORDER,
  uiReducer,
  useKeymap,
  type Mode,
  type PaneId,
} from "./lib/useKeymap";
import { buildConsoleUrl, safeHref } from "./lib/url";
import { exportConfig, importConfig, restoreConfig } from "./config/io";
import { DEFAULT_PROFILE_ID, type Config, type ProfileId } from "./config/schema";
import {
  readActiveProfileId,
  readLocalCatalog,
  writeActiveProfileId,
  type ProfileCatalog,
} from "./config/local";
import { ConfigConflictError, useConfig, useSaveConfig } from "./api/config";
import { useProfiles } from "./api/profiles";
import { useCachedQuery } from "./api/useCachedQuery";
import { decodeWeather, fetchWeather, Weather } from "./widgets/Weather";
import { decodeEvents, fetchEvents, filterAgendaEvents, Agenda } from "./widgets/Agenda";
import { overlapsRange } from "./lib/ics";
import { decodeNews, fetchNews, News } from "./widgets/News";
import { Month, monthLabel } from "./widgets/Month";
import { eventFetchRange } from "./lib/date";
import { linkHost } from "./lib/host";
import type { Note, SourceState } from "./shell/StatusLine";
import { decodeHomelab, fetchHomelab, Homelab } from "./widgets/Homelab";
import { SettingsPane } from "./shell/SettingsPane";

type RowInfo = { url?: string };

// Die Agenda zeigt heute und die drei folgenden Tage; geholt wird für das Monatsraster
// mehr. Beide Panes teilen sich eine Abfrage, deshalb wird hier zugeschnitten.
const AGENDA_DAYS = 4;

function profileInCatalog(catalog: ProfileCatalog | undefined, profileId: ProfileId | undefined): boolean {
  return profileId !== undefined && (catalog?.profiles.some((profile) => profile.id === profileId) ?? false);
}

function resolveProfileId(catalog: ProfileCatalog | undefined, stored: ProfileId | undefined): ProfileId | undefined {
  if (catalog === undefined) return undefined;
  if (stored !== undefined && profileInCatalog(catalog, stored)) return stored;
  const first = catalog.profiles[0];
  return first?.id;
}

function isProfileQuery(queryKey: readonly unknown[], profileId: ProfileId): boolean {
  const first = queryKey[0];
  if (first === "config") return queryKey[1] === profileId;
  return typeof first === "string" && first.startsWith(`profile:${profileId}:`);
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Angezeigt wird nur hh:mm — einmal pro Minute genügt, ausgerichtet auf die volle Minute.
    // Sekündlich würde die ganze Seite samt Gästetabelle neu gerendert.
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      clearTimeout(timeout);
      if (interval !== undefined) clearInterval(interval);
    };
  }, []);
  return now;
}

export default function App() {
  const queryClient = useQueryClient();
  const profilesQuery = useProfiles();
  const [localCatalog] = useState<ProfileCatalog | undefined>(() => readLocalCatalog());
  const [storedProfileId] = useState<ProfileId | undefined>(() => readActiveProfileId());
  const [activeProfileId, setActiveProfileId] = useState<ProfileId | undefined>(() =>
    resolveProfileId(localCatalog, storedProfileId),
  );
  const catalog = profilesQuery.data;
  const resolvedProfileId = resolveProfileId(catalog, activeProfileId);
  // Before a first catalog arrives there is no selected profile. The default ID below is
  // only a hook key placeholder; all profile-dependent queries stay disabled until a local
  // catalog or the server catalog provides a validated first/selected ID.
  const profileId = resolvedProfileId ?? DEFAULT_PROFILE_ID;
  const profileReady = resolvedProfileId !== undefined;
  const configQuery = useConfig(profileId, { enabled: profileReady });
  const saveConfig = useSaveConfig(profileId);
  const config = configQuery.data;
  const [ui, dispatch] = useReducer(uiReducer, initialUiState);
  const [seed, setSeed] = useState<string | null>(null);
  const [message, setMessage] = useState<Note | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const previousCatalog = useRef<ProfileCatalog | undefined>(localCatalog);
  const modalOpen = settingsOpen || ui.showHelp;
  const now = useNow();
  const calRange = useMemo(() => eventFetchRange(now, AGENDA_DAYS), [now]);
  const paneRefs = useRef<Partial<Record<PaneId, HTMLElement | null>>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const switchProfile = useCallback((nextProfileId: ProfileId): void => {
    if (catalog !== undefined && !profileInCatalog(catalog, nextProfileId)) return;
    if (nextProfileId === activeProfileId) {
      writeActiveProfileId(nextProfileId);
      return;
    }
    const previousProfileId = activeProfileId;
    writeActiveProfileId(nextProfileId);
    if (previousProfileId !== undefined) {
      void queryClient.cancelQueries({
        predicate: (query) => isProfileQuery(query.queryKey, previousProfileId),
      });
    }
    dispatch({ type: "resetSelection" });
    setActiveProfileId(nextProfileId);
  }, [activeProfileId, catalog, queryClient]);

  useEffect(() => {
    if (catalog === undefined) return;
    const first = catalog.profiles[0];
    if (first === undefined) return;
    if (!profileInCatalog(catalog, activeProfileId)) {
      const wasKnown = previousCatalog.current?.profiles.some((profile) => profile.id === activeProfileId) ?? false;
      switchProfile(first.id);
      if (wasKnown) setMessage({ text: "Profil wurde entfernt — Standardprofil aktiv.", level: "info" });
    } else {
      if (activeProfileId !== undefined) writeActiveProfileId(activeProfileId);
    }
    previousCatalog.current = catalog;
  }, [activeProfileId, catalog, switchProfile]);

  useEffect(() => {
    const root = document.documentElement;
    if (config.theme === "system") delete root.dataset.theme;
    else root.dataset.theme = config.theme;
  }, [config.theme]);

  useEffect(() => {
    // Eine Fehlermeldung bleibt stehen, bis eine neue Meldung sie ablöst — wer eine
    // Fehlermeldung nach 2,5 s nicht gelesen hat, hat sie nie gesehen.
    if (message === undefined || message.level === "error") return;
    const t = setTimeout(() => setMessage(undefined), 2500);
    return () => clearTimeout(t);
  }, [message]);

  // Die Intervalle halten einen dauerhaft offenen Tab aktuell; ohne sie wird erst beim
  // nächsten Fokus nachgeladen, und eine Anzeige, die niemand fokussiert, friert ein.
  const wxQuery = useCachedQuery(
    `profile:${profileId}:wx:${config.location.lat},${config.location.lon}`,
    () => fetchWeather(profileId, config.location),
    600_000,
    { decode: decodeWeather, refetchIntervalMs: 600_000, enabled: profileReady },
  );
  const calQuery = useCachedQuery(
    `profile:${profileId}:cal:${JSON.stringify(config.calendars)}:${calRange.from.getTime()}:${calRange.to.getTime()}`,
    () => fetchEvents(profileId, config.calendars, calRange.from, calRange.to),
    900_000,
    { decode: decodeEvents, refetchIntervalMs: 900_000, enabled: profileReady },
  );
  const newsQuery = useCachedQuery(
    `profile:${profileId}:news:${JSON.stringify(config.feeds)}`,
    () => fetchNews(profileId, config.feeds),
    900_000,
    { decode: decodeNews, refetchIntervalMs: 900_000, enabled: profileReady },
  );
  const homelabEnabled = config.homelab.enabled;
  const labQuery = useCachedQuery(`profile:${profileId}:pve`, () => fetchHomelab(profileId), 60_000, {
    decode: decodeHomelab, refetchIntervalMs: 60_000, enabled: profileReady && homelabEnabled,
  });

  // undefined bleibt undefined: „noch keine Termine" ist ein anderer Zustand als
  // „keine Termine in den nächsten Tagen", und die Agenda unterscheidet beide.
  const agendaEvents = useMemo(
    () => {
      if (!calQuery.data) return undefined;
      return filterAgendaEvents(calQuery.data.items, now, AGENDA_DAYS);
    },
    [calQuery.data, now],
  );

  const monthEvents = useMemo(
    () => calQuery.data?.items.filter((event) => overlapsRange(event.start, event.end, calRange.from, calRange.to)),
    [calQuery.data, calRange],
  );

  const flatLinks = useMemo<FlatLink[]>(
    () =>
      config.linkGroups.flatMap((g) =>
        g.links.map((l) => ({ label: l.label, url: l.url, hint: l.hint, group: g.title })),
      ),
    [config.linkGroups],
  );

  const hints = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    for (const l of flatLinks) if (l.hint) h[l.hint.toLowerCase()] = l.url;
    return h;
  }, [flatLinks]);

  const layoutById = useMemo(
    () => Object.fromEntries(config.layout.map((l) => [l.id, l])),
    [config.layout],
  );
  const paneVisible = (id: PaneId) => id === "homelab"
    ? homelabEnabled && (layoutById[id]?.visible ?? true)
    : layoutById[id]?.visible ?? true;
  const paneSpan = (id: PaneId): 1 | 2 => {
    const layout = layoutById[id];
    return layout && "span" in layout ? layout.span : 1;
  };
  const visiblePanes = useMemo(
    () => new Set(PANE_ORDER.map((p) => p.id).filter((id) => id !== "homelab" || homelabEnabled)
      .filter((id) => layoutById[id]?.visible ?? true)),
    [layoutById, homelabEnabled],
  );

  const consoleUrl = useCallback(
    (vmid: number) => buildConsoleUrl(config.homelab.uiUrl, config.homelab.node, vmid),
    [config.homelab.uiUrl, config.homelab.node],
  );
  const rowsByPane = useMemo<Record<PaneId, RowInfo[]>>(() => {
    const rows: Record<PaneId, RowInfo[]> = {
      clock: [],
      weather: [],
      month: [],
      links: flatLinks.map((l) => ({ url: l.url })),
      agenda: (agendaEvents ?? []).map(() => ({})),
      news: (newsQuery.data?.items ?? []).map((n) => ({ url: n.url || undefined })),
      // Gestoppte Gäste haben keine Konsole — Enter darf dort kein leeres noVNC öffnen.
      homelab: (labQuery.data?.guests ?? []).map((g) => (
        g.running ? { url: consoleUrl(g.vmid) } : {}
      )),
    };
    // Ausgeblendete Panes haben keine Zeilen — sonst wandert die Auswahl unsichtbar weiter.
    for (const id of PANE_ORDER.map((p) => p.id)) if (!visiblePanes.has(id)) rows[id] = [];
    return rows;
  }, [flatLinks, agendaEvents, newsQuery.data, labQuery.data, consoleUrl, visiblePanes]);

  const rowCounts = useMemo<Record<PaneId, number>>(() => ({
    clock: rowsByPane.clock.length,
    weather: rowsByPane.weather.length,
    month: rowsByPane.month.length,
    links: rowsByPane.links.length,
    news: rowsByPane.news.length,
    agenda: rowsByPane.agenda.length,
    homelab: rowsByPane.homelab.length,
  }), [rowsByPane]);

  useEffect(() => {
    dispatch({ type: "sync", rowCounts, visiblePanes });
  }, [rowCounts, visiblePanes]);

  const rowCount = ui.pane ? (rowsByPane[ui.pane]?.length ?? 0) : 0;
  const selectedUrl = ui.pane && ui.mode === "NORMAL"
    ? rowsByPane[ui.pane]?.[ui.row]?.url
    : undefined;

  const onSeed = useCallback((s: string, mode: Mode) => {
    setSeed(s);
    dispatch({ type: "mode", mode });
  }, []);

  useEffect(() => {
    if (ui.mode === "NORMAL") setSeed(null);
  }, [ui.mode]);

  useKeymap({
    state: ui, dispatch, hints, rowCount, selectedUrl, onSeed,
    overlayOpen: modalOpen,
    onOverlayEscape: () => {
      if (settingsOpen) setSettingsOpen(false);
      else dispatch({ type: "help", show: false });
    },
    visiblePanes,
  });

  useEffect(() => {
    if (ui.mode !== "NORMAL" || !ui.pane) return;
    const el = paneRefs.current[ui.pane];
    el?.focus({ preventScroll: true });
    el?.querySelectorAll("[data-row]")[ui.row]?.scrollIntoView({ block: "nearest" });
  }, [ui.mode, ui.pane, ui.row]);

  function updateConfig(next: Config, onSuccess?: () => void) {
    saveConfig.mutate(next, {
      onSuccess,
      onError: (err) => {
        if (err instanceof ConfigConflictError) {
          setMessage({ text: "Ein anderes Gerät hat zuerst gespeichert. Seite neu laden.", level: "error" });
        } else {
          setMessage({ text: "Server nicht erreichbar — Speichern ist gesperrt.", level: "error" });
        }
      },
    });
  }

  function runCommand(cmd: string) {
    switch (cmd) {
      case "export":
        exportConfig(config);
        setMessage({ text: "Konfiguration als Datei gesichert.", level: "info" });
        break;
      case "import":
        fileRef.current?.click();
        break;
      case "refresh":
        // Nur die Abfragen neu holen — Fokus, Auswahl und Suchzeile bleiben, wie sie sind.
        void queryClient.invalidateQueries();
        setMessage({ text: "Quellen werden neu geladen.", level: "info" });
        break;
      case "reload":
        window.location.reload();
        break;
      case "theme": {
        const effective = document.documentElement.dataset.theme ??
          (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
        updateConfig({ ...config, theme: effective === "dark" ? "light" : "dark" });
        setMessage({ text: `Theme: ${effective === "dark" ? "light" : "dark"}`, level: "info" });
        break;
      }
      case "settings":
        setSettingsOpen(true);
        break;
      default:
        setMessage({ text: `Unbekanntes Kommando: :${cmd}`, level: "error" });
    }
  }

  async function onImportFile(file: File | undefined) {
    if (!file) return;
    const result = await importConfig(file);
    if (result.ok) {
      updateConfig(restoreConfig(result.config, config), () => {
        setMessage({ text: "Konfiguration importiert.", level: "info" });
      });
    } else {
      setMessage({ text: result.message, level: "error" });
    }
  }

  const timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
  const isSel = (pane: PaneId, i: number) => ui.mode === "NORMAL" && ui.pane === pane && ui.row === i;
  const selIndex = (pane: PaneId) => (ui.mode === "NORMAL" && ui.pane === pane ? ui.row : -1);

  const queryState = (q: { isError: boolean; isStale: boolean }, partial = false): SourceState =>
    q.isError ? "crit" : partial || q.isStale ? "warn" : "ok";

  const labAlerts = homelabEnabled ? labQuery.data?.alerts ?? [] : [];
  const labAlertLevel: "warn" | "crit" = labAlerts.some((a) => a.level === "crit") ? "crit" : "warn";

  // Der erste Fehler wird ausgeschrieben — ein roter Punkt allein sagt nicht, was fehlt.
  const failed = ([
    ["wx", wxQuery.error],
    ["news", newsQuery.error],
    ["cal", calQuery.error],
    ["pve", homelabEnabled ? labQuery.error : null],
    ["cfg", configQuery.error],
  ] as const).find(([, err]) => err !== null);
  const partialProblems = [
    ...(newsQuery.data?.failures ?? []).map((label) => `news: Feed „${label}" nicht erreichbar`),
    ...(calQuery.data?.failures ?? []).map((label) => `cal: Kalender „${label}" nicht erreichbar`),
  ];
  const problem = failed && failed[1]
    ? `${failed[0]}: ${failed[1].message}`
    : partialProblems.join(" · ") || undefined;

  let linkRow = -1;

  return (
    <>
      <div className="app" aria-hidden={modalOpen ? "true" : undefined} inert={modalOpen}>
        <h1 className="sr-only">Dashboard</h1>
        <PaneGrid>
          {paneVisible("clock") && (
          <Pane
            title="Clock"
            label="Uhr"
            span={paneSpan("clock")}
            id="pane-1"
            ref={(el: HTMLElement | null) => { paneRefs.current.clock = el; }}
          >
            <div className="clock">
              <div>
                <div className="clock-time">{timeFmt.format(now)}</div>
                <div className="clock-date">
                  {new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(now)}
                </div>
              </div>
              {/* Zwei Spalten statt einer Fließzeile mit Trennpunkten: die Zeiten stehen
                  untereinander und lassen sich vergleichen, was der Zweck der Liste ist.
                  Unten verankert, damit die Pane zwei Anker hat statt oben zu kleben. */}
              {config.clock.secondary.length > 0 && (
                <dl className="clock-zones">
                  {config.clock.secondary.map((z) => (
                    <Fragment key={z.label}>
                      <dt>{z.label}</dt>
                      <dd>
                        {new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: z.tz }).format(now)}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              )}
            </div>
          </Pane>
          )}

          {paneVisible("weather") && (
          <Pane title="Weather" label="Wetter" subtitle={config.location.label} span={paneSpan("weather")} id="pane-2"
            ref={(el: HTMLElement | null) => { paneRefs.current.weather = el; }}
          >
            <Weather data={wxQuery.data} now={now} />
          </Pane>
          )}

          {paneVisible("month") && (
          <Pane title="Month" label="Monat" subtitle={monthLabel(now)} span={paneSpan("month")} id="pane-7"
            ref={(el: HTMLElement | null) => { paneRefs.current.month = el; }}
          >
            <Month now={now} events={monthEvents} holidayRegion={config.holidayRegion} />
          </Pane>
          )}

          {paneVisible("links") && (
          <Pane title="Links" label="Links" span={paneSpan("links")} clip id="pane-3"
            ref={(el: HTMLElement | null) => { paneRefs.current.links = el; }}
          >
            <nav aria-label="Links">
              {config.linkGroups.map((g) => (
                <div className="link-group" key={g.title}>
                  <div className="group-label">{g.title}</div>
                  <ul>
                    {g.links.map((l) => {
                      linkRow += 1;
                      const i = linkRow;
                      const href = safeHref(l.url);
                      return (
                        <li key={l.url}>
                          {/* Die Zeile ist der Link, nicht nur der Text darin: so trifft die
                              Maus die ganze Breite und Mittelklick öffnet einen neuen Tab. */}
                          <a
                            className={`row${isSel("links", i) ? " is-sel" : ""}`}
                            href={href ?? undefined}
                            data-row
                          >
                            <span className="hint">{l.hint ?? ""}</span>
                            <span className="link-label">{l.label}</span>
                            {/* Der Zielhost an der rechten Panekante. Er füllt nicht nur
                                die Breite — bei „Drive" oder „NAS" sagt erst er, wohin
                                die Zeile führt. Aus der Adresse, nicht aus der Config. */}
                            <span className="link-host">{linkHost(l.url)}</span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </Pane>
          )}

          {paneVisible("news") && (
          <Pane title="News" label="Nachrichten" span={paneSpan("news")} clip id="pane-5"
            ref={(el: HTMLElement | null) => { paneRefs.current.news = el; }}
          >
            <News items={newsQuery.data?.items} failures={newsQuery.data?.failures}
              selIndex={selIndex("news")} feedCount={config.feeds.length} />
          </Pane>
          )}

          {paneVisible("agenda") && (
          <Pane title="Agenda" label="Termine" span={paneSpan("agenda")} clip id="pane-4"
            ref={(el: HTMLElement | null) => { paneRefs.current.agenda = el; }}
          >
            <Agenda events={agendaEvents} failures={calQuery.data?.failures}
              selIndex={selIndex("agenda")} calendarCount={config.calendars.length} />
          </Pane>
          )}

          {paneVisible("homelab") && (
          <Pane title="Homelab" label="Homelab" subtitle={config.homelab.node} span="full" id="pane-6"
            ref={(el: HTMLElement | null) => { paneRefs.current.homelab = el; }}
          >
            <Homelab data={labQuery.data} selIndex={selIndex("homelab")} consoleUrl={consoleUrl} />
          </Pane>
          )}
        </PaneGrid>

        {/* Kommandozeile und Statusline bleiben zusammen am unteren Rand stehen — sie sind
            die einzige Anzeige für Modus, Alter der Quellen und Fehler. */}
        <div className="chrome">
          <CommandBar
            mode={ui.mode}
            seed={seed}
            links={flatLinks}
            search={config.search}
            onModeChange={(m) => dispatch({ type: "mode", mode: m })}
            onCommand={runCommand}
          />

          <StatusLine
            mode={ui.mode}
            panes={PANE_ORDER
              .map((p, i) => ({ id: p.id, n: i + 1, label: p.label, active: ui.pane === p.id }))
              .filter((p) => visiblePanes.has(p.id))
              .map(({ n, label, active }) => ({ n, label, active }))}
            sources={[
              { label: "wx", state: queryState(wxQuery), updatedAt: wxQuery.dataUpdatedAt },
              { label: "news", state: queryState(newsQuery, (newsQuery.data?.failures.length ?? 0) > 0), updatedAt: newsQuery.dataUpdatedAt },
              { label: "cal", state: queryState(calQuery, (calQuery.data?.failures.length ?? 0) > 0), updatedAt: calQuery.dataUpdatedAt },
              ...(homelabEnabled ? [{
                label: "pve",
                state: labQuery.data && !labQuery.data.configured ? "unconfigured" : queryState(labQuery),
                updatedAt: labQuery.dataUpdatedAt,
                ...(labAlerts.length > 0
                  ? { alerts: { count: labAlerts.length, level: labAlertLevel } }
                  : {}),
              }] : []),
              { label: "cfg", state: queryState(configQuery), updatedAt: configQuery.dataUpdatedAt },
            ]}
            clock={timeFmt.format(now)}
            note={message}
            problem={problem}
          />
        </div>
      </div>

      <KeymapOverlay open={ui.showHelp} onClose={() => dispatch({ type: "help", show: false })} />
      <SettingsPane
        open={settingsOpen}
        config={config}
        profileId={profileId}
        guests={homelabEnabled ? labQuery.data?.guests ?? [] : []}
        onClose={() => setSettingsOpen(false)}
        save={saveConfig}
        onReload={async () => {
          const result = await configQuery.refetch();
          return result.isSuccess ? result.data : undefined;
        }}
        // Der Dialog schließt sich erst, wenn saveConfig wirklich erfolgreich war —
        // vorher schloss onSave sofort, egal ob die Anfrage nachher scheiterte.
        onSaved={() => setMessage({ text: "Konfiguration gespeichert.", level: "info" })}
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          void onImportFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );
}
