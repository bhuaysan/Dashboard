import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
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
import { exportConfig, importConfig } from "./config/io";
import type { Config } from "./config/schema";
import { ConfigConflictError, useConfig, useSaveConfig } from "./api/config";
import { useCachedQuery } from "./api/useCachedQuery";
import { fetchWeather, Weather } from "./widgets/Weather";
import { fetchEvents, reviveEvents, Agenda } from "./widgets/Agenda";
import { fetchNews, reviveNews, News } from "./widgets/News";
import type { SourceState } from "./shell/StatusLine";
import { fetchHomelab, Homelab } from "./widgets/Homelab";
import { SettingsPane } from "./shell/SettingsPane";

type RowInfo = { url?: string };

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
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
  const configQuery = useConfig();
  const saveConfig = useSaveConfig();
  const config = configQuery.data;
  const [ui, dispatch] = useReducer(uiReducer, initialUiState);
  const [seed, setSeed] = useState<string | null>(null);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const now = useNow();
  const paneRefs = useRef<Partial<Record<PaneId, HTMLElement | null>>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (config.theme === "system") delete root.dataset.theme;
    else root.dataset.theme = config.theme;
  }, [config.theme]);

  useEffect(() => {
    if (message === undefined) return;
    const t = setTimeout(() => setMessage(undefined), 2500);
    return () => clearTimeout(t);
  }, [message]);

  // Die Intervalle halten einen dauerhaft offenen Tab aktuell; ohne sie wird erst beim
  // nächsten Fokus nachgeladen, und eine Anzeige, die niemand fokussiert, friert ein.
  const wxQuery = useCachedQuery(
    `wx:${config.location.lat},${config.location.lon}`,
    () => fetchWeather(config.location),
    600_000,
    { refetchIntervalMs: 600_000 },
  );
  const calQuery = useCachedQuery(
    `cal:${JSON.stringify(config.calendars)}`,
    () => fetchEvents(config.calendars),
    900_000,
    { revive: reviveEvents, refetchIntervalMs: 900_000 },
  );
  const newsQuery = useCachedQuery(
    `news:${JSON.stringify(config.feeds)}`,
    () => fetchNews(config.feeds),
    900_000,
    { revive: reviveNews, refetchIntervalMs: 900_000 },
  );
  const labQuery = useCachedQuery("pve", fetchHomelab, 60_000, { refetchIntervalMs: 60_000 });

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
  const rowsByPane = useMemo<Record<PaneId, RowInfo[]>>(() => {
    const rows: Record<PaneId, RowInfo[]> = {
      clock: [],
      weather: [],
      links: flatLinks.map((l) => ({ url: l.url })),
      agenda: (calQuery.data ?? []).map(() => ({})),
      news: (newsQuery.data ?? []).map((n) => ({ url: n.url || undefined })),
      homelab: (labQuery.data?.guests ?? []).map((g) => ({
        url: `${consoleBase}/?console=kvm&novnc=1&vmid=${g.vmid}&node=${config.homelab.node}`,
      })),
    };
    // Ausgeblendete Panes haben keine Zeilen — sonst wandert die Auswahl unsichtbar weiter.
    for (const id of PANE_ORDER.map((p) => p.id)) if (!visiblePanes.has(id)) rows[id] = [];
    return rows;
  }, [flatLinks, calQuery.data, newsQuery.data, labQuery.data, config.homelab.node, consoleBase, visiblePanes]);

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
    overlayOpen: settingsOpen, onOverlayEscape: () => setSettingsOpen(false),
    visiblePanes,
  });

  useEffect(() => {
    if (ui.mode !== "NORMAL" || !ui.pane) return;
    const el = paneRefs.current[ui.pane];
    el?.focus({ preventScroll: true });
    el?.querySelectorAll("[data-row]")[ui.row]?.scrollIntoView({ block: "nearest" });
  }, [ui.mode, ui.pane, ui.row]);

  function updateConfig(next: Config) {
    saveConfig.mutate(next, {
      onError: (err) => {
        if (err instanceof ConfigConflictError) {
          setMessage("Ein anderes Gerät hat zuerst gespeichert. Seite neu laden.");
        } else {
          setMessage("Server nicht erreichbar — Speichern ist gesperrt.");
        }
      },
    });
  }

  function runCommand(cmd: string) {
    switch (cmd) {
      case "export":
        exportConfig(config);
        setMessage("Konfiguration als Datei gesichert.");
        break;
      case "import":
        fileRef.current?.click();
        break;
      case "reload":
        window.location.reload();
        break;
      case "theme": {
        const effective = document.documentElement.dataset.theme ??
          (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
        updateConfig({ ...config, theme: effective === "dark" ? "light" : "dark" });
        setMessage(`Theme: ${effective === "dark" ? "light" : "dark"}`);
        break;
      }
      case "settings":
        setSettingsOpen(true);
        break;
      default:
        setMessage(`Unbekanntes Kommando: :${cmd}`);
    }
  }

  async function onImportFile(file: File | undefined) {
    if (!file) return;
    const result = await importConfig(file);
    if (result.ok) {
      updateConfig(result.config);
      setMessage("Konfiguration importiert.");
    } else {
      setMessage(result.message);
    }
  }

  const timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
  const isSel = (pane: PaneId, i: number) => ui.mode === "NORMAL" && ui.pane === pane && ui.row === i;
  const selIndex = (pane: PaneId) => (ui.mode === "NORMAL" && ui.pane === pane ? ui.row : -1);

  const queryState = (q: { isError: boolean; isStale: boolean }): SourceState =>
    q.isError ? "crit" : q.isStale ? "warn" : "ok";

  let linkRow = -1;

  return (
    <>
      <div className="app">
        <PaneGrid>
          {paneVisible("clock") && (
          <Pane
            title="Clock"
            span={paneSpan("clock")}
            id="pane-1"
            ref={(el: HTMLElement | null) => { paneRefs.current.clock = el; }}
          >
            <div className="clock-time">{timeFmt.format(now)}</div>
            <div className="clock-date">
              {new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(now)}
              {"  ·  KW "}{isoWeek(now)}
            </div>
            <div className="clock-zones">
              {config.clock.secondary.map((z, i) => (
                <span key={z.label}>
                  {i > 0 && "  ·  "}
                  {z.label} {new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: z.tz }).format(now)}
                </span>
              ))}
            </div>
          </Pane>
          )}

          {paneVisible("weather") && (
          <Pane title="Weather" subtitle={config.location.label} span={paneSpan("weather")} id="pane-2"
            ref={(el: HTMLElement | null) => { paneRefs.current.weather = el; }}
          >
            <Weather data={wxQuery.data} selIndex={selIndex("weather")} />
          </Pane>
          )}

          {paneVisible("links") && (
          <Pane title="Links" span={paneSpan("links")} tall={paneVisible("agenda") && paneVisible("news")} clip id="pane-3"
            ref={(el: HTMLElement | null) => { paneRefs.current.links = el; }}
          >
            <nav aria-label="Links">
              {config.linkGroups.map((g) => (
                <div key={g.title}>
                  <div className="group-label">{g.title}</div>
                  <ul>
                    {g.links.map((l) => {
                      linkRow += 1;
                      const i = linkRow;
                      return (
                        <li key={l.url} className={`row${isSel("links", i) ? " is-sel" : ""}`} data-row>
                          <span className="hint">{l.hint ?? ""}</span>
                          <span>{l.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </Pane>
          )}

          {paneVisible("agenda") && (
          <Pane title="Agenda" span={paneSpan("agenda")} clip id="pane-4"
            ref={(el: HTMLElement | null) => { paneRefs.current.agenda = el; }}
          >
            <Agenda events={calQuery.data} selIndex={selIndex("agenda")} calendarCount={config.calendars.length} />
          </Pane>
          )}

          {paneVisible("news") && (
          <Pane title="News" span={paneSpan("news")} clip id="pane-5"
            ref={(el: HTMLElement | null) => { paneRefs.current.news = el; }}
          >
            <News items={newsQuery.data} selIndex={selIndex("news")} feedCount={config.feeds.length} />
          </Pane>
          )}

          {paneVisible("homelab") && (
          <Pane title="Homelab" subtitle={config.homelab.node} span="full" id="pane-6"
            ref={(el: HTMLElement | null) => { paneRefs.current.homelab = el; }}
          >
            <Homelab data={labQuery.data} selIndex={selIndex("homelab")} />
          </Pane>
          )}

          <CommandBar
            mode={ui.mode}
            seed={seed}
            links={flatLinks}
            search={config.search}
            onModeChange={(m) => dispatch({ type: "mode", mode: m })}
            onCommand={runCommand}
          />
        </PaneGrid>

        <StatusLine
          mode={ui.mode}
          panes={PANE_ORDER
            .map((p, i) => ({ id: p.id, n: i + 1, label: p.label, active: ui.pane === p.id }))
            .filter((p) => visiblePanes.has(p.id))
            .map(({ n, label, active }) => ({ n, label, active }))}
          sources={[
            { label: "wx", state: queryState(wxQuery) },
            { label: "news", state: queryState(newsQuery) },
            { label: "cal", state: queryState(calQuery) },
            { label: "pve", state: labQuery.data && !labQuery.data.configured ? "warn" : queryState(labQuery) },
            { label: "cfg", state: queryState(configQuery) },
          ]}
          clock={timeFmt.format(now)}
          note={message}
        />
      </div>

      <KeymapOverlay open={ui.showHelp} />
      <SettingsPane
        open={settingsOpen}
        config={config}
        guests={labQuery.data?.guests ?? []}
        onClose={() => setSettingsOpen(false)}
        onSave={(cfg) => {
          updateConfig(cfg);
          setSettingsOpen(false);
          setMessage("Konfiguration gespeichert.");
        }}
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
