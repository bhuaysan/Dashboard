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
import { fetchEvents, Agenda } from "./widgets/Agenda";
import { fetchNews, News } from "./widgets/News";
import type { SourceState } from "./shell/StatusLine";

type RowInfo = { url?: string };

const GUESTS = [
  { vmid: 100, name: "caddy", run: true, cpu: "0 %", mem: "8 %" },
  { vmid: 101, name: "pihole.local", run: true, cpu: "0 %", mem: "21 %" },
  { vmid: 102, name: "fileshare.local", run: true, cpu: "0 %", mem: "4 %" },
  { vmid: 103, name: "torrent.local", run: true, cpu: "0 %", mem: "94 %", warn: true },
  { vmid: 104, name: "uptime.local", run: true, cpu: "1 %", mem: "25 %" },
  { vmid: 105, name: "home.local", run: true, cpu: "0 %", mem: "31 %" },
  { vmid: 106, name: "jellyfin.local", run: true, cpu: "0 %", mem: "3 %" },
  { vmid: 107, name: "filebrowser.local", run: true, cpu: "0 %", mem: "10 %" },
  { vmid: 108, name: "qbit.local", run: true, cpu: "6 %", mem: "80 %", warn: true },
  { vmid: 109, name: "share.local", run: true, cpu: "0 %", mem: "4 %" },
  { vmid: 110, name: "minecraft.local", run: false, cpu: "–", mem: "–" },
  { vmid: 111, name: "monitor.local", run: true, cpu: "1 %", mem: "14 %" },
  { vmid: 112, name: "postgres.local", run: true, cpu: "1 %", mem: "15 %" },
];

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
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
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

  const wxQuery = useCachedQuery(
    `wx:${config.location.lat},${config.location.lon}`,
    () => fetchWeather(config.location),
    600_000,
  );
  const calQuery = useCachedQuery(
    `cal:${JSON.stringify(config.calendars)}`,
    () => fetchEvents(config.calendars),
    900_000,
  );
  const newsQuery = useCachedQuery(
    `news:${JSON.stringify(config.feeds)}`,
    () => fetchNews(config.feeds),
    900_000,
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

  const rowsByPane = useMemo<Record<PaneId, RowInfo[]>>(() => ({
    clock: [],
    weather: [],
    links: flatLinks.map((l) => ({ url: l.url })),
    agenda: (calQuery.data ?? []).map(() => ({})),
    news: (newsQuery.data ?? []).map((n) => ({ url: n.url || undefined })),
    homelab: GUESTS.map(() => ({})),
  }), [flatLinks, calQuery.data, newsQuery.data]);

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

  useKeymap({ state: ui, dispatch, hints: hintMap, rowCount, selectedUrl, onSeed });

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
        setMessage("Einstellungen sind noch nicht eingebaut.");
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
        <header className="topline">
          <span>dashboard</span>
          <span>
            <strong>{new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(now)}</strong>
            {"  "}KW {isoWeek(now)}
          </span>
        </header>

        <PaneGrid>
          <Pane
            title="Clock"
            id="pane-1"
            ref={(el: HTMLElement | null) => { paneRefs.current.clock = el; }}
          >
            <div className="clock-time">{timeFmt.format(now)}</div>
            <div className="clock-date">
              {new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(now)}
            </div>
            <div className="clock-zones">
              {config.clock.secondary.map((z) => (
                <span key={z.label}>
                  {z.label} {new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: z.tz }).format(now)}
                  {"  ·  "}
                </span>
              ))}
            </div>
          </Pane>

          <Pane title="Weather" subtitle={config.location.label} span={2} id="pane-2"
            ref={(el: HTMLElement | null) => { paneRefs.current.weather = el; }}
          >
            <Weather data={wxQuery.data} selIndex={selIndex("weather")} />
          </Pane>

          <Pane title="Links" tall id="pane-3"
            ref={(el: HTMLElement | null) => { paneRefs.current.links = el; }}
          >
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
          </Pane>

          <Pane title="Agenda" id="pane-4"
            ref={(el: HTMLElement | null) => { paneRefs.current.agenda = el; }}
          >
            <Agenda events={calQuery.data} selIndex={selIndex("agenda")} />
          </Pane>

          <Pane title="News" id="pane-5"
            ref={(el: HTMLElement | null) => { paneRefs.current.news = el; }}
          >
            <News items={newsQuery.data} selIndex={selIndex("news")} />
          </Pane>

          <Pane title="Homelab" subtitle={config.homelab.node} span="full" id="pane-6"
            ref={(el: HTMLElement | null) => { paneRefs.current.homelab = el; }}
          >
            <div className="lab-node">
              <span className="metric"><span className="dim">cpu</span><span>1 %</span>
                <span className="spark">▁▃▁▅▃▁▃▇▃</span></span>
              <span className="metric"><span className="dim">mem</span><span>51 %</span>
                <span className="spark">▁▄▄▇▄▁▄▄▇</span></span>
              <span className="metric"><span className="dim">root</span><span>28 %</span></span>
              <span className="metric"><span className="dim">up</span><span>87 d</span></span>
              <span className="metric"><span className="dim">load</span><span>0.05</span></span>
            </div>
            <div className="lab-store">
              <span>tank <span className="bar"><span className="bar-on">━━</span><span className="bar-off">───────────</span></span> <span className="dim">15 %</span></span>
              <span>local <span className="bar"><span className="bar-on">━━━━</span><span className="bar-off">─────────</span></span> <span className="dim">28 %</span></span>
              <span>local-lvm <span className="bar"><span className="bar-on">━━━━</span><span className="bar-off">─────────</span></span> <span className="dim">34 %</span></span>
            </div>
            <div className="lab-guests">
              {GUESTS.map((g, i) => (
                <div key={g.vmid} className={`guest${isSel("homelab", i) ? " is-sel" : ""}`} data-row>
                  {g.run ? (
                    <>
                      <span className="ok">●</span><span className="num">{g.vmid}</span>
                      <span className="name">{g.name}</span><span className="dim">run</span>
                      <span className="val">{g.cpu}</span>
                      <span className={`val${g.warn ? " warn" : ""}`}>{g.mem}</span>
                    </>
                  ) : (
                    <>
                      <span className="dim">○</span><span className="num">{g.vmid}</span>
                      <span className="name dim">{g.name}</span><span className="dim">stop</span>
                      <span className="val dim">{g.cpu}</span><span className="val dim">{g.mem}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="lab-alerts">
              <div className="alert crit"><span className="mark">!</span><span>keine vzdump-Backups konfiguriert</span></div>
              <div className="alert warn"><span className="mark">!</span><span>pve 31 updates verfügbar</span></div>
            </div>
          </Pane>

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
          panes={PANE_ORDER.map((p, i) => ({ n: i + 1, label: p.label, active: ui.pane === p.id }))}
          sources={[
            { label: "wx", state: queryState(wxQuery) },
            { label: "news", state: queryState(newsQuery) },
            { label: "cal", state: queryState(calQuery) },
            { label: "pve", state: "ok" },
            { label: "cfg", state: queryState(configQuery) },
          ]}
          clock={timeFmt.format(now)}
          note={message}
        />
      </div>

      <KeymapOverlay open={ui.showHelp} />
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
