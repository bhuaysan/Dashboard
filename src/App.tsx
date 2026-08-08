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
  safeHref,
  uiReducer,
  useKeymap,
  type Mode,
  type PaneId,
} from "./lib/useKeymap";
import { exportConfig, importConfig, restoreConfig } from "./config/io";
import type { Config } from "./config/schema";
import { ConfigConflictError, useConfig, useSaveConfig } from "./api/config";
import { useCachedQuery } from "./api/useCachedQuery";
import { decodeWeather, fetchWeather, Weather } from "./widgets/Weather";
import { decodeEvents, fetchEvents, filterAgendaEvents, Agenda } from "./widgets/Agenda";
import { decodeNews, fetchNews, News } from "./widgets/News";
import { Month, monthLabel } from "./widgets/Month";
import { eventFetchRange } from "./lib/date";
import type { Note, SourceState } from "./shell/StatusLine";
import { decodeHomelab, fetchHomelab, Homelab } from "./widgets/Homelab";
import { SettingsPane } from "./shell/SettingsPane";

type RowInfo = { url?: string };

// Die Agenda zeigt heute und die drei folgenden Tage; geholt wird für das Monatsraster
// mehr. Beide Panes teilen sich eine Abfrage, deshalb wird hier zugeschnitten.
const AGENDA_DAYS = 4;

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
  const configQuery = useConfig();
  const saveConfig = useSaveConfig();
  const config = configQuery.data;
  const [ui, dispatch] = useReducer(uiReducer, initialUiState);
  const [seed, setSeed] = useState<string | null>(null);
  const [message, setMessage] = useState<Note | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const modalOpen = settingsOpen || ui.showHelp;
  const now = useNow();
  const calRange = useMemo(() => eventFetchRange(now, AGENDA_DAYS), [now]);
  const paneRefs = useRef<Partial<Record<PaneId, HTMLElement | null>>>({});
  const fileRef = useRef<HTMLInputElement>(null);

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
    `wx:${config.location.lat},${config.location.lon}`,
    () => fetchWeather(config.location),
    600_000,
    { decode: decodeWeather, refetchIntervalMs: 600_000 },
  );
  const calQuery = useCachedQuery(
    `cal:${JSON.stringify(config.calendars)}:${calRange.from.getTime()}:${calRange.to.getTime()}`,
    () => fetchEvents(config.calendars, calRange.from, calRange.to),
    900_000,
    { decode: decodeEvents, refetchIntervalMs: 900_000 },
  );
  const newsQuery = useCachedQuery(
    `news:${JSON.stringify(config.feeds)}`,
    () => fetchNews(config.feeds),
    900_000,
    { decode: decodeNews, refetchIntervalMs: 900_000 },
  );
  const labQuery = useCachedQuery("pve", fetchHomelab, 60_000, {
    decode: decodeHomelab, refetchIntervalMs: 60_000,
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
    () => calQuery.data?.items.filter((event) => event.end >= calRange.from && event.start <= calRange.to),
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
    for (const l of flatLinks) if (l.hint) h[l.hint] = l.url;
    return h;
  }, [flatLinks]);

  const layoutById = useMemo(
    () => Object.fromEntries(config.layout.map((l) => [l.id, l])),
    [config.layout],
  );
  const paneVisible = (id: PaneId) => layoutById[id]?.visible ?? true;
  const paneSpan = (id: PaneId): 1 | 2 => layoutById[id]?.span ?? 1;
  const visiblePanes = useMemo(
    () => new Set(PANE_ORDER.map((p) => p.id).filter((id) => layoutById[id]?.visible ?? true)),
    [layoutById],
  );

  const consoleBase = config.homelab.uiUrl.replace(/\/+$/, "");
  const consoleUrl = useCallback(
    (vmid: number) => `${consoleBase}/?console=kvm&novnc=1&vmid=${vmid}&node=${config.homelab.node}`,
    [consoleBase, config.homelab.node],
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

  const hintMap = hints;

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
    state: ui, dispatch, hints: hintMap, rowCount, selectedUrl, onSeed,
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

  const labAlerts = labQuery.data?.alerts ?? [];
  const labAlertLevel = labAlerts.some((a) => a.level === "crit") ? "crit" : "warn";

  // Der erste Fehler wird ausgeschrieben — ein roter Punkt allein sagt nicht, was fehlt.
  const failed = ([
    ["wx", wxQuery.error],
    ["news", newsQuery.error],
    ["cal", calQuery.error],
    ["pve", labQuery.error],
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
            <Weather data={wxQuery.data} selIndex={selIndex("weather")} now={now} />
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
                            <span>{l.label}</span>
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
              {
                label: "pve",
                state: labQuery.data && !labQuery.data.configured ? "unconfigured" : queryState(labQuery),
                updatedAt: labQuery.dataUpdatedAt,
                ...(labAlerts.length > 0
                  ? { alerts: { count: labAlerts.length, level: labAlertLevel } }
                  : {}),
              },
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
        guests={labQuery.data?.guests ?? []}
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
