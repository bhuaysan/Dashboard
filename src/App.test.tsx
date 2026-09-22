import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { buildConsoleUrl } from "./lib/url";
import { defaultConfig } from "./config/defaults";
import { DEFAULT_PROFILE_ID, type Config, type ProfileId } from "./config/schema";
import { writeActiveProfileId, writeLocalCatalog, writeLocalConfig, type ProfileCatalog } from "./config/local";
import type { HomelabData } from "./widgets/Homelab";
import type { UptimeResponse, UptimeStatus } from "./lib/uptime";
import { decodeUptime } from "./widgets/Uptime";

const EMPTY_HOMELAB: HomelabData = {
  configured: false,
  node: {
    cpu: 0, mem: 0, root: 0, uptimeDays: 0,
    cpuSpark: [], memSpark: [], cpuLevel: "ok", memLevel: "ok", rootLevel: "ok",
  },
  guests: [], storage: [], alerts: [],
};

const FULL_HOMELAB: HomelabData = {
  configured: true,
  node: {
    cpu: 12, mem: 41, root: 23, uptimeDays: 34,
    cpuSpark: [12], memSpark: [41], cpuLevel: "ok", memLevel: "ok", rootLevel: "ok",
  },
  guests: [{
    vmid: 100, name: "test-guest", running: true, cpu: 2, mem: 38,
    cpuLevel: "ok", memLevel: "ok",
  }],
  storage: [{ name: "local-lvm", pct: 58, level: "ok" }],
  alerts: [{ level: "crit", text: "PVE-Alarm" }],
};

const HTTP_TARGET_ID = "423e4567-e89b-42d3-a456-426614174000";
const TCP_TARGET_ID = "523e4567-e89b-42d3-a456-426614174000";

function uptimeConfig(enabled: boolean, visible = true): Config {
  return {
    ...monitoringConfig(false),
    uptime: {
      enabled,
      targets: [
        { id: HTTP_TARGET_ID, type: "http", label: "Startseite", url: "https://start.example/" },
        { id: TCP_TARGET_ID, type: "tcp", label: "Minecraft", host: "minecraft.example", port: 25565 },
      ],
    },
    layout: defaultConfig.layout.map((entry) => entry.id === "uptime" ? { ...entry, visible } : entry),
  };
}

function uptimeResponse(status: UptimeStatus = "up", options: {
  updatedAt?: string | null;
  storageOk?: boolean;
} = {}): UptimeResponse {
  const failed = status === "degraded" || status === "down";
  const result = (id: string) => ({
    id,
    status,
    statusSince: "2026-09-22T12:00:00.000Z",
    checkedAt: "2026-09-22T12:01:00.000Z",
    responseTimeMs: failed || status === "unknown" ? null : 31,
    uptime24h: 99.93,
    measuredMinutes: 1440,
    history: Array.from({ length: 24 }, () => status === "down" ? "down" as const : "ok" as const),
    error: failed ? { code: "timeout" as const } : null,
  });
  return {
    updatedAt: options.updatedAt === undefined ? new Date().toISOString() : options.updatedAt,
    storageOk: options.storageOk ?? true,
    targets: [result(HTTP_TARGET_ID), result(TCP_TARGET_ID)],
  };
}

const PROFILE_CATALOG = {
  profilesUpdatedAt: "2026-09-15T00:00:00.000Z",
  profiles: [{ id: DEFAULT_PROFILE_ID, name: "Standard" }],
};

const WORK_PROFILE_ID = "123e4567-e89b-42d3-a456-426614174000" as ProfileId;
const PRIVATE_PROFILE_ID = "223e4567-e89b-42d3-a456-426614174000" as ProfileId;
const CREATED_PROFILE_ID = "323e4567-e89b-42d3-a456-426614174000" as ProfileId;
const TWO_PROFILE_CATALOG: ProfileCatalog = {
  profilesUpdatedAt: "2026-09-15T00:00:00.000Z",
  profiles: [
    { id: WORK_PROFILE_ID, name: "Arbeit" },
    { id: PRIVATE_PROFILE_ID, name: "Privat" },
  ],
};

function monitoringConfig(enabled: boolean, homelabVisible = true): Config {
  return {
    ...defaultConfig,
    feeds: [],
    calendars: [],
    homelab: { ...defaultConfig.homelab, enabled },
    layout: defaultConfig.layout.map((entry) => entry.id === "homelab"
      ? { ...entry, visible: homelabVisible }
      : entry),
  };
}

function setInitialConfig(config: Config): void {
  localStorage.setItem("dashboard:config:default", JSON.stringify(config));
  writeLocalCatalog(PROFILE_CATALOG);
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

// Die Kommandozeile öffnet sich erst durch das globale ":", vorher setzt CommandBar
// den Eingabewert bei jedem Moduswechsel zurück.
function typeCommand(cmd: string) {
  fireEvent.keyDown(window, { key: ":" });
  const input = screen.getByLabelText("Suche oder Kommando");
  fireEvent.change(input, { target: { value: cmd } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function stubBaseApi(
  config = defaultConfig,
  putResponse?: Response,
  homelabResponse: HomelabData = EMPTY_HOMELAB,
  uptimeData: UptimeResponse = uptimeResponse(),
) {
  writeLocalCatalog(PROFILE_CATALOG);
  writeLocalConfig(DEFAULT_PROFILE_ID, config);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/profiles") return new Response(JSON.stringify(PROFILE_CATALOG), { status: 200 });
    const parsed = new URL(url, "http://dashboard.test");
    if (parsed.pathname === "/api/config" && init?.method === "PUT") {
      return putResponse ?? new Response(JSON.stringify(defaultConfig), { status: 200 });
    }
    if (parsed.pathname === "/api/config") return new Response(JSON.stringify(config), { status: 200 });
    if (parsed.pathname === "/api/homelab") return new Response(JSON.stringify(homelabResponse), { status: 200 });
    if (parsed.pathname === "/api/uptime") return new Response(JSON.stringify(uptimeData), { status: 200 });
    return new Response("", { status: 502 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubProfiledApi(catalog: ProfileCatalog, configs: Record<string, Config>) {
  writeLocalCatalog(catalog);
  for (const profile of catalog.profiles) {
    const config = configs[profile.id];
    if (config !== undefined) writeLocalConfig(profile.id, config);
  }
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const parsed = new URL(String(input), "http://dashboard.test");
    if (parsed.pathname === "/api/profiles") return new Response(JSON.stringify(catalog), { status: 200 });
    if (parsed.pathname === "/api/config") {
      const profileId = parsed.searchParams.get("profile") ?? "";
      return new Response(JSON.stringify(configs[profileId] ?? defaultConfig), { status: 200 });
    }
    if (parsed.pathname === "/api/homelab") return new Response(JSON.stringify(EMPTY_HOMELAB), { status: 200 });
    return new Response("", { status: 502 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function chooseImportFile(file: File) {
  typeCommand(":import");
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Import-Eingabe fehlt");
  fireEvent.change(input, { target: { files: [file] } });
}

function jsonFile(value: unknown): File {
  const file = new File([""], "config.json", { type: "application/json" });
  // jsdoms File-Stub hat in dieser Vitest-Version kein implementiertes Blob.text().
  Object.defineProperty(file, "text", { value: async () => JSON.stringify(value) });
  return file;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function profileConfig(theme: Config["theme"], location: string, hideWeather = false): Config {
  return {
    ...defaultConfig,
    theme,
    location: { ...defaultConfig.location, label: location },
    feeds: [],
    calendars: [],
    homelab: { ...defaultConfig.homelab, enabled: false },
    layout: defaultConfig.layout.map((entry) => entry.id === "weather"
      ? { ...entry, visible: !hideWeather }
      : entry),
  };
}

function rss(title: string): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><item><title>${title}</title><link>https://example.test/${title}</link><pubDate>Sat, 08 Aug 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
}

describe("App", () => {
  it("baut Proxmox-Konsolenparameter als echte URL", () => {
    const url = new URL(buildConsoleUrl("https://pve.example:8006/", "pve/home", 101));
    expect(url.hash).toBe("");
    expect(url.searchParams.get("console")).toBe("kvm");
    expect(url.searchParams.get("vmid")).toBe("101");
    expect(url.searchParams.get("node")).toBe("pve/home");
  });
  it("rendert Panes, Suchzeile und Statusline", () => {
    setInitialConfig(monitoringConfig(true));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Clock" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Homelab/ })).toBeTruthy();
    expect(screen.getByLabelText("Suche oder Kommando")).toBeTruthy();
    expect(screen.getByText("NORMAL")).toBeTruthy();
    expect(screen.getByText("Datasphere")).toBeTruthy();
    expect(document.querySelector(".grid--grouped > .pane--full")).toBeTruthy();
  });

  it("lässt ausgeblendete Standardspalten vollständig entfallen", async () => {
    const config: Config = {
      ...defaultConfig,
      feeds: [],
      calendars: [],
      homelab: { ...defaultConfig.homelab, enabled: false },
      layout: defaultConfig.layout.map((entry) =>
        entry.id === "clock" || entry.id === "links" ? { ...entry, visible: false } : entry,
      ),
    };
    setInitialConfig(config);
    stubBaseApi(config);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: /Weather/ })).toBeTruthy());
    const grid = document.querySelector(".grid");
    expect(grid?.classList.contains("grid--grouped")).toBe(true);
    expect(grid?.querySelector(".column--left")).toBeNull();
    expect(grid?.querySelector(".column--center")).toBeTruthy();
    expect(grid?.querySelector(".column--right")).toBeTruthy();
  });

  it("fällt bei einer sichtbaren Span-2-Pane auf das direkte Legacy-Raster zurück", async () => {
    const config: Config = {
      ...uptimeConfig(true),
      feeds: [],
      calendars: [],
      homelab: { ...defaultConfig.homelab, enabled: false },
      layout: defaultConfig.layout.map((entry) =>
        entry.id === "weather" ? { ...entry, span: 2 } : entry,
      ),
    };
    setInitialConfig(config);
    stubBaseApi(config);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: /Weather/ })).toBeTruthy());
    const grid = document.querySelector(".grid");
    expect(grid?.classList.contains("grid--legacy")).toBe(true);
    expect(grid?.querySelector(".column")).toBeNull();
    expect(grid?.querySelector(".pane--wide")).toBeTruthy();
    const uptimePane = screen.getByRole("region", { name: "Uptime" });
    expect(uptimePane.classList.contains("pane--full")).toBe(true);
    expect(uptimePane.parentElement).toBe(grid);
  });

  it("unterbindet bei deaktiviertem Monitoring Request, Pane, Statusquelle und Alarme", async () => {
    const config = monitoringConfig(false);
    setInitialConfig(config);
    const fetchMock = stubBaseApi(config, undefined, FULL_HOMELAB);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/config?profile=default")).toBe(true));
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/homelab?profile=default")).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: /Homelab/ })).toBeNull();
    expect(document.querySelector(".sl-panes")?.textContent).not.toContain("lab");
    expect(screen.queryByLabelText(/^pve:/)).toBeNull();
    expect(screen.queryByText("PVE-Alarm")).toBeNull();
  });

  it("zeigt deaktiviertes Uptime als unkonfiguriert ohne Request oder Pane", async () => {
    const config = uptimeConfig(false);
    const fetchMock = stubBaseApi(config);
    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/config?profile=default")).toBe(true));
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/uptime?profile=default")).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Uptime" })).toBeNull();
    expect(screen.getByLabelText(/^up: nicht konfiguriert/)).toBeTruthy();
  });

  it("lädt Uptime profilbezogen, rendert beide Zeilentypen und hält die Pane vollbreit", async () => {
    const config = uptimeConfig(true);
    const snapshot = uptimeResponse();
    expect(decodeUptime(snapshot)).toBeDefined();
    const fetchMock = stubBaseApi(config, undefined, EMPTY_HOMELAB, snapshot);
    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/uptime?profile=default")).toBe(true));
    expect(screen.getByRole("heading", { name: "Uptime" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Startseite")).toBeTruthy());
    expect(screen.getByText("Minecraft")).toBeTruthy();
    const pane = screen.getByRole("region", { name: "Uptime" });
    expect(pane.classList.contains("pane--full")).toBe(true);
    expect(pane.parentElement?.classList.contains("grid--grouped")).toBe(true);
    expect(pane.querySelector(".uptime-row--responsive")?.getAttribute("style")).toBeNull();
  });

  it("überwacht ausgeblendetes Uptime weiter und meldet Zielausfälle kritisch", async () => {
    const config = uptimeConfig(true, false);
    const fetchMock = stubBaseApi(config, undefined, EMPTY_HOMELAB, uptimeResponse("down"));
    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/uptime?profile=default")).toBe(true));
    expect(screen.queryByRole("heading", { name: "Uptime" })).toBeNull();
    await waitFor(() => expect(screen.getByLabelText(/up: in Ordnung.*2 Alarme/)).toBeTruthy());
    expect(screen.getByText("!!2")).toBeTruthy();
  });

  it("bewertet degradierte Ziele, Speicherfehler und alte Serverrunden getrennt", async () => {
    const degraded = uptimeResponse("degraded", { storageOk: false, updatedAt: null });
    const config = uptimeConfig(true);
    stubBaseApi(config, undefined, EMPTY_HOMELAB, degraded);
    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText("Uptime-Historie nicht speicherbar")).toBeTruthy());
    expect(screen.getByLabelText(/^up: Fehler/)).toBeTruthy();
    expect(screen.getByText("!2")).toBeTruthy();
  });

  it.each([null, "2020-01-01T00:00:00.000Z"])(
    "markiert eine frisch geladene, aber serverseitig alte oder fehlende Uptime-Runde als veraltet (%s)",
    async (updatedAt) => {
    const config = uptimeConfig(true);
    stubBaseApi(config, undefined, EMPTY_HOMELAB, uptimeResponse("up", { updatedAt }));
    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByLabelText(/^up: veraltet/)).toBeTruthy());
    },
  );

  it("navigiert Uptime-Zeilen und öffnet mit Enter nur HTTP-Ziele", async () => {
    if (!HTMLElement.prototype.scrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    }
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const config = uptimeConfig(true);
    stubBaseApi(config, undefined, EMPTY_HOMELAB, uptimeResponse());
    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText("Startseite")).toBeTruthy());
    fireEvent.keyDown(window, { key: "8" });
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    expect(open).toHaveBeenCalledWith("https://start.example/", "_blank", "noopener");
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });

  it("überwacht bei aktivem Monitoring auch ohne sichtbare Pane weiter", async () => {
    const config = monitoringConfig(true, false);
    setInitialConfig(config);
    const fetchMock = stubBaseApi(config, undefined, FULL_HOMELAB);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/homelab?profile=default")).toBe(true));
    await waitFor(() => expect(screen.getByLabelText(/pve: in Ordnung/)).toBeTruthy());
    expect(screen.queryByRole("heading", { name: /Homelab/ })).toBeNull();
    expect(document.querySelector(".sl-panes")?.textContent).not.toContain("lab");
    expect(screen.getByText("!!1")).toBeTruthy();
  });

  it("verschiebt den Fokus nach dem Abschalten einer fokussierten Homelab-Pane auf eine sichtbare Pane", async () => {
    const enabledConfig = monitoringConfig(true);
    const disabledConfig = monitoringConfig(false);
    setInitialConfig(enabledConfig);
    const fetchMock = stubBaseApi(
      enabledConfig,
      new Response(JSON.stringify(disabledConfig), { status: 200 }),
      FULL_HOMELAB,
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: /Homelab/ })).toBeTruthy());
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/homelab?profile=default")).toBe(true));
    const homelabCallsBeforeSave = fetchMock.mock.calls
      .filter(([input]) => String(input) === "/api/homelab?profile=default").length;
    expect(homelabCallsBeforeSave).toBe(1);
    if (!HTMLElement.prototype.scrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    }
    fireEvent.keyDown(window, { key: "7" });
    typeCommand(":settings");
    fireEvent.click(screen.getByRole("tab", { name: "Homelab" }));
    const toggle = screen.getByRole("checkbox", { name: "Proxmox-Monitoring aktiv" });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: /Homelab/ })).toBeNull());
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/homelab?profile=default"))
      .toHaveLength(homelabCallsBeforeSave);
    expect(document.querySelector(".sl-panes .is-active")?.textContent).toContain("clock");
  });

  it("gibt jeder Linkzeile ein echtes href", () => {
    setInitialConfig(defaultConfig);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );
    const link = screen.getByText("Datasphere").closest("a");
    expect(link?.getAttribute("href")).toMatch(/^https?:\/\//);
    expect(screen.getByRole("region", { name: "Links" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Dashboard");
  });

  it(":refresh lädt die Quellen neu, ohne die Seite neu zu laden", () => {
    setInitialConfig(defaultConfig);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );
    typeCommand(":refresh");
    expect(invalidate).toHaveBeenCalled();
    expect(screen.getByText("Quellen werden neu geladen.")).toBeTruthy();
  });

  it(":refresh holt die Quellen tatsächlich erneut ab", async () => {
    writeLocalCatalog(PROFILE_CATALOG);
    writeLocalConfig(DEFAULT_PROFILE_ID, defaultConfig);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(
        <QueryClientProvider client={new QueryClient()}>
          <App />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
      const vorher = fetchMock.mock.calls.length;
      typeCommand(":refresh");
      await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(vorher));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("nimmt ein Kommando auch mit doppeltem Doppelpunkt an", () => {
    setInitialConfig(defaultConfig);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );
    typeCommand("::refresh");
    expect(invalidate).toHaveBeenCalled();
    expect(screen.getByText("Quellen werden neu geladen.")).toBeTruthy();
  });

  it("meldet ein unbekanntes Kommando, statt es stillschweigend zu schlucken", () => {
    setInitialConfig(defaultConfig);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );
    typeCommand(":gibtsnicht");
    expect(screen.getByText("Unbekanntes Kommando: :gibtsnicht")).toBeTruthy();
  });

  it(":profile öffnet die Einstellungen direkt im Abschnitt PROFILE", async () => {
    setInitialConfig(defaultConfig);
    stubBaseApi(defaultConfig);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("Datasphere")).toBeTruthy());
    typeCommand(":profile");
    expect(await screen.findByRole("tab", { name: "PROFILE", selected: true })).toBeTruthy();
  });

  it(":profile <name> wechselt exakt, ohne den Profilkatalog auf dem Server zu verändern", async () => {
    const work = profileConfig("dark", "Arbeitsort");
    const privateConfig = profileConfig("light", "Privatort");
    writeActiveProfileId(PRIVATE_PROFILE_ID);
    writeLocalConfig(WORK_PROFILE_ID, work);
    writeLocalConfig(PRIVATE_PROFILE_ID, privateConfig);
    const fetchMock = stubProfiledApi(TWO_PROFILE_CATALOG, {
      [WORK_PROFILE_ID]: work,
      [PRIVATE_PROFILE_ID]: privateConfig,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText(/Privatort/)).toBeTruthy());
    typeCommand(":profile   arbeit  ");

    await waitFor(() => expect(localStorage.getItem("dashboard:active-profile")).toBe(WORK_PROFILE_ID));
    expect(await screen.findByText(/Arbeitsort/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method !== undefined)).toBe(false);
  });

  it.each(["Arb", "Unbekannt"])(":profile %s meldet einen deutschen Fehler und bleibt beim alten Profil", async (name) => {
    const work = profileConfig("dark", "Arbeitsort");
    const privateConfig = profileConfig("light", "Privatort");
    writeActiveProfileId(PRIVATE_PROFILE_ID);
    writeLocalConfig(WORK_PROFILE_ID, work);
    writeLocalConfig(PRIVATE_PROFILE_ID, privateConfig);
    stubProfiledApi(TWO_PROFILE_CATALOG, {
      [WORK_PROFILE_ID]: work,
      [PRIVATE_PROFILE_ID]: privateConfig,
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText(/Privatort/)).toBeTruthy());
    typeCommand(`:profile ${name}`);
    expect(screen.getByRole("alert").textContent).toContain(`Profil „${name}" nicht gefunden.`);
    expect(localStorage.getItem("dashboard:active-profile")).toBe(PRIVATE_PROFILE_ID);
  });

  it("führt profilabhängige Kommandos vor Katalogauflösung nicht mit dem default-Platzhalter aus", async () => {
    writeActiveProfileId(DEFAULT_PROFILE_ID);
    let resolveProfiles: (value: Response) => void = () => undefined;
    const profilesPending = new Promise<Response>((resolve) => { resolveProfiles = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") return profilesPending;
      if (parsed.pathname === "/api/config") return new Response(JSON.stringify(defaultConfig), { status: 200 });
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/profiles")).toBe(true));
    fireEvent.keyDown(window, { key: ":" });
    expect(screen.queryByLabelText("Suche oder Kommando")).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/config?profile=default")).toBe(false);
    resolveProfiles(new Response(JSON.stringify(TWO_PROFILE_CATALOG), { status: 200 }));
  });

  it("bleibt ohne echte Config neutral und öffnet keine Default-Ziele per UI oder Keymap", async () => {
    writeLocalCatalog(PROFILE_CATALOG);
    let resolveConfig: (response: Response) => void = () => undefined;
    const configPending = new Promise<Response>((resolve) => { resolveConfig = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") return new Response(JSON.stringify(PROFILE_CATALOG), { status: 200 });
      if (parsed.pathname === "/api/config") return configPending;
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/config?profile=default")).toBe(true));
    expect(screen.getByRole("status").textContent).toContain("Profil-Konfiguration wird geladen");
    expect(screen.queryByText("Datasphere")).toBeNull();
    expect(screen.queryByLabelText("Suche oder Kommando")).toBeNull();

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "d", shiftKey: true });
    fireEvent.keyDown(window, { key: ":" });
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Suche oder Kommando")).toBeNull();

    resolveConfig(new Response(JSON.stringify(defaultConfig), { status: 200 }));
  });

  it("zeigt bei fehlender Config einen deutschen Fehler, Retry und bekannte Profile", async () => {
    const privateConfig = profileConfig("light", "Privatort");
    writeLocalCatalog(TWO_PROFILE_CATALOG);
    writeActiveProfileId(WORK_PROFILE_ID);
    let workConfigRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") return new Response(JSON.stringify(TWO_PROFILE_CATALOG), { status: 200 });
      if (parsed.pathname === "/api/config") {
        if (parsed.searchParams.get("profile") === WORK_PROFILE_ID) {
          workConfigRequests += 1;
          return new Response("nicht erreichbar", { status: 503 });
        }
        return new Response(JSON.stringify(privateConfig), { status: 200 });
      }
      if (parsed.pathname === "/api/homelab") return new Response(JSON.stringify(EMPTY_HOMELAB), { status: 200 });
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Profil-Konfiguration"), { timeout: 4000 });
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Privat/ })).toBeTruthy();

    const requestsBeforeRetry = workConfigRequests;
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(workConfigRequests).toBeGreaterThan(requestsBeforeRetry));
    fireEvent.click(screen.getByRole("button", { name: /Privat/ }));
    await waitFor(() => expect(screen.getByText(/Privatort/)).toBeTruthy());
    expect(screen.queryByText(/Profil-Konfiguration konnte nicht geladen werden/)).toBeNull();
  });

  it("zeigt einen Katalogfehler mit Retry und lädt danach das erste Profil", async () => {
    localStorage.removeItem("dashboard:profiles");
    writeActiveProfileId(DEFAULT_PROFILE_ID);
    let profileRequests = 0;
    const work = profileConfig("dark", "Arbeitsort");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") {
        profileRequests += 1;
        return profileRequests <= 2
          ? new Response("nicht erreichbar", { status: 503 })
          : new Response(JSON.stringify({ ...TWO_PROFILE_CATALOG, profiles: [{ id: WORK_PROFILE_ID, name: "Arbeit" }] }), { status: 200 });
      }
      if (parsed.pathname === "/api/config") return new Response(JSON.stringify(work), { status: 200 });
      if (parsed.pathname === "/api/homelab") return new Response(JSON.stringify(EMPTY_HOMELAB), { status: 200 });
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Profilkatalog"), { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(screen.getByText(/Arbeitsort/)).toBeTruthy());
    expect(profileRequests).toBeGreaterThan(2);
  });

  it("zeigt einen Katalogfehler auch mit lokalem Stand und kann ihn erneut laden", async () => {
    const work = profileConfig("dark", "Arbeitsort");
    const privateConfig = profileConfig("light", "Privatort");
    writeLocalCatalog(TWO_PROFILE_CATALOG);
    writeActiveProfileId(WORK_PROFILE_ID);
    writeLocalConfig(WORK_PROFILE_ID, work);
    writeLocalConfig(PRIVATE_PROFILE_ID, privateConfig);
    let profileRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") {
        profileRequests += 1;
        return profileRequests <= 2
          ? new Response("nicht erreichbar", { status: 503 })
          : new Response(JSON.stringify(TWO_PROFILE_CATALOG), { status: 200 });
      }
      if (parsed.pathname === "/api/config") return new Response(JSON.stringify(work), { status: 200 });
      if (parsed.pathname === "/api/homelab") return new Response(JSON.stringify(EMPTY_HOMELAB), { status: 200 });
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Profilkatalog"), { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(screen.getByText(/Arbeitsort/)).toBeTruthy());
    expect(profileRequests).toBeGreaterThan(2);
  });

  it("isoliert das Raster, solange das Settings-Dialog offen ist", () => {
    setInitialConfig(defaultConfig);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );
    typeCommand(":settings");
    const app = document.querySelector<HTMLElement>(".app");
    expect(app?.getAttribute("aria-hidden")).toBe("true");
    expect(app?.hasAttribute("inert")).toBe(true);
  });

  it("importiert eine gültige Datei über das Kommando und speichert sie", async () => {
    const saved = { ...defaultConfig, theme: "light" as const, updatedAt: "2026-08-08T12:00:00.000Z" };
    const fetchMock = stubBaseApi(defaultConfig, new Response(JSON.stringify(saved), { status: 200 }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );

    chooseImportFile(jsonFile({ ...defaultConfig, theme: "light" }));

    await waitFor(() => expect(screen.getByText("Konfiguration importiert.")).toBeTruthy());
    expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input) === "/api/config?profile=default" && init?.method === "PUT",
    )).toBe(true);
  });

  it("verwirft einen verzögerten Import nach jedem Profilwechsel", async () => {
    const work = profileConfig("dark", "Arbeitsort");
    const privateConfig = profileConfig("light", "Privatort");
    const importText = deferred<string>();
    writeActiveProfileId(WORK_PROFILE_ID);
    writeLocalCatalog(TWO_PROFILE_CATALOG);
    writeLocalConfig(WORK_PROFILE_ID, work);
    writeLocalConfig(PRIVATE_PROFILE_ID, privateConfig);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") return new Response(JSON.stringify(TWO_PROFILE_CATALOG), { status: 200 });
      if (parsed.pathname === "/api/config" && init?.method === "PUT") {
        return new Response(JSON.stringify(work), { status: 200 });
      }
      if (parsed.pathname === "/api/config") {
        return new Response(JSON.stringify(parsed.searchParams.get("profile") === WORK_PROFILE_ID ? work : privateConfig), { status: 200 });
      }
      if (parsed.pathname === "/api/homelab") return new Response(JSON.stringify(EMPTY_HOMELAB), { status: 200 });
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([""], "config.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => importText.promise });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);

    await waitFor(() => expect(screen.getByText(/Arbeitsort/)).toBeTruthy());
    chooseImportFile(file);
    typeCommand(":profile privat");
    await waitFor(() => expect(screen.getByText(/Privatort/)).toBeTruthy());
    typeCommand(":profile arbeit");
    await waitFor(() => expect(screen.getByText(/Arbeitsort/)).toBeTruthy());

    await act(async () => {
      importText.resolve(JSON.stringify({ ...work, location: { ...work.location, label: "Importierter Ort" } }));
      await importText.promise;
    });

    await waitFor(() => expect(screen.getByText("Import verworfen — Profil wurde gewechselt.")).toBeTruthy());
    expect(fetchMock.mock.calls.some(([input, mutation]) => String(input).includes("/api/config") && mutation?.method === "PUT")).toBe(false);
    expect(screen.queryByText("Konfiguration importiert.")).toBeNull();
  });

  it("zeigt einen Importkonflikt sichtbar an und übernimmt ihn nicht still", async () => {
    stubBaseApi(defaultConfig, new Response(JSON.stringify({ current: "andere-revision" }), { status: 409 }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );

    chooseImportFile(jsonFile(defaultConfig));

    await waitFor(() => expect(screen.getByRole("alert").textContent)
      .toContain("Ein anderes Gerät hat zuerst gespeichert"));
  });

  it("zeigt einen Serverfehler beim Import sichtbar an", async () => {
    stubBaseApi(defaultConfig, new Response("kaputt", { status: 503 }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );

    chooseImportFile(jsonFile(defaultConfig));

    await waitFor(() => expect(screen.getByRole("alert").textContent)
      .toContain("Server nicht erreichbar"));
  });

  it("verdrahtet Profilduplikate mit der Katalogmutation und schaltet erst nach Bestätigung", async () => {
    writeLocalCatalog(PROFILE_CATALOG);
    let resolveCreate: (response: Response) => void = () => undefined;
    const createPending = new Promise<Response>((resolve) => { resolveCreate = resolve; });
    const createdCatalog: ProfileCatalog = {
      ...PROFILE_CATALOG,
      profilesUpdatedAt: "2026-09-16T00:00:00.000Z",
      profiles: [...PROFILE_CATALOG.profiles, { id: CREATED_PROFILE_ID, name: "Zuhause" }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles" && init?.method === "POST") return createPending;
      if (parsed.pathname === "/api/profiles") return new Response(JSON.stringify(PROFILE_CATALOG), { status: 200 });
      if (parsed.pathname === "/api/config") return new Response(JSON.stringify(defaultConfig), { status: 200 });
      if (parsed.pathname === "/api/homelab") return new Response(JSON.stringify(EMPTY_HOMELAB), { status: 200 });
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);

    await waitFor(() => expect(screen.getByText("Datasphere")).toBeTruthy());
    typeCommand(":settings");
    fireEvent.click(await screen.findByRole("tab", { name: "PROFILE" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Neuer Profilname" }), { target: { value: "  Zuhause  " } });
    fireEvent.click(screen.getByRole("button", { name: "Profil duplizieren" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => {
      return String(input) === "/api/profiles" && init?.method === "POST";
    })).toBe(true));
    expect(localStorage.getItem("dashboard:active-profile")).toBe(DEFAULT_PROFILE_ID);

    resolveCreate(new Response(JSON.stringify({ catalog: createdCatalog, createdId: CREATED_PROFILE_ID }), { status: 200 }));
    await waitFor(() => expect(localStorage.getItem("dashboard:active-profile")).toBe(CREATED_PROFILE_ID));
    expect(fetchMock.mock.calls.some(([input]) => String(input) === `/api/config?profile=${CREATED_PROFILE_ID}`)).toBe(true);
  });

  it("zeigt partielle Kalender- und Feed-Ausfälle in Pane und Statusline", async () => {
    const config = {
      ...defaultConfig,
      feeds: [
        { label: "gut", url: "https://feed-ok.example/rss", limit: 1 },
        { label: "kaputt", url: "https://feed-bad.example/rss", limit: 1 },
      ],
      calendars: [
        { label: "Kalender gut", url: "https://calendar-ok.example/work.ics" },
        { label: "Kalender kaputt", url: "https://calendar-bad.example/work.ics" },
      ],
    };
    const feed = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Meldung</title><link>https://example.com/1</link><pubDate>Sat, 08 Aug 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
    const ics = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:termin", "DTSTART:20260808T090000",
      "DTEND:20260808T100000", "SUMMARY:Termin", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const parsed = new URL(url, "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") return new Response(JSON.stringify(PROFILE_CATALOG), { status: 200 });
      if (parsed.pathname === "/api/config") return new Response(JSON.stringify(config), { status: 200 });
      if (parsed.pathname === "/api/homelab") return new Response(JSON.stringify(EMPTY_HOMELAB), { status: 200 });
      const target = new URL(url, "http://dashboard.test").searchParams.get("url") ?? "";
      if (target.includes("feed-ok")) return new Response(feed, { status: 200 });
      if (target.includes("calendar-ok")) return new Response(ics, { status: 200 });
      return new Response("kaputt", { status: 502 });
    });
    writeLocalCatalog(PROFILE_CATALOG);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Feeds nicht erreichbar: kaputt")).toBeTruthy();
      expect(screen.getByText("Kalender nicht erreichbar: Kalender kaputt")).toBeTruthy();
      expect(screen.getByLabelText(/news: veraltet/)).toBeTruthy();
      expect(screen.getByLabelText(/cal: veraltet/)).toBeTruthy();
    });
  });

  it("wählt die lokal aktive Profil-ID und lädt Config und Quellen profiliert", async () => {
    const work = profileConfig("dark", "Arbeitsort");
    writeLocalCatalog(TWO_PROFILE_CATALOG);
    writeActiveProfileId(WORK_PROFILE_ID);
    writeLocalConfig(WORK_PROFILE_ID, work);
    writeLocalConfig(PRIVATE_PROFILE_ID, profileConfig("light", "Privatort", true));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") return new Response(JSON.stringify(TWO_PROFILE_CATALOG), { status: 200 });
      if (parsed.pathname === "/api/config") return new Response(JSON.stringify(parsed.searchParams.get("profile") === WORK_PROFILE_ID ? work : defaultConfig), { status: 200 });
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/config?profile=${WORK_PROFILE_ID}`, expect.anything()));
    expect(await screen.findByText(/Arbeitsort/)).toBeTruthy();
    expect(client.getQueryCache().findAll().some((query) => String(query.queryKey[0]).startsWith(`profile:${WORK_PROFILE_ID}:`))).toBe(true);
  });

  it("fällt ohne lokale Auswahl auf das erste Serverprofil zurück und speichert es lokal", async () => {
    localStorage.removeItem("dashboard:active-profile");
    const privateConfig = profileConfig("light", "Privatort");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") return new Response(JSON.stringify(TWO_PROFILE_CATALOG), { status: 200 });
      if (parsed.pathname === "/api/config") return new Response(JSON.stringify(parsed.searchParams.get("profile") === WORK_PROFILE_ID ? profileConfig("dark", "Arbeitsort") : privateConfig), { status: 200 });
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);

    await waitFor(() => expect(localStorage.getItem("dashboard:active-profile")).toBe(WORK_PROFILE_ID));
    expect(await screen.findByText(/Arbeitsort/)).toBeTruthy();
  });

  it("wartet ohne lokalen Katalog vor Config- und Quellen-Requests auf den Serverkatalog", async () => {
    const work = profileConfig("dark", "Arbeitsort");
    writeActiveProfileId(DEFAULT_PROFILE_ID);
    let resolveProfiles: (value: Response) => void = () => undefined;
    const profilesPending = new Promise<Response>((resolve) => { resolveProfiles = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") return profilesPending;
      if (parsed.pathname === "/api/config") return new Response(JSON.stringify(work), { status: 200 });
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/profiles")).toBe(true));
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/config?profile=default")).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => {
      const path = new URL(String(input), "http://dashboard.test").pathname;
      return path === "/api/proxy" || path === "/api/homelab";
    })).toBe(false);

    resolveProfiles(new Response(JSON.stringify(TWO_PROFILE_CATALOG), { status: 200 }));
    await waitFor(() => expect(localStorage.getItem("dashboard:active-profile")).toBe(WORK_PROFILE_ID));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === `/api/config?profile=${WORK_PROFILE_ID}`)).toBe(true));
    expect(await screen.findByText(/Arbeitsort/)).toBeTruthy();
  });

  it("bewahrt eine gespeicherte Profil-ID ohne Katalog bis zur Serverauflösung", async () => {
    const privateConfig = profileConfig("light", "Privatort");
    writeActiveProfileId(PRIVATE_PROFILE_ID);
    let resolveProfiles: (value: Response) => void = () => undefined;
    const profilesPending = new Promise<Response>((resolve) => { resolveProfiles = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") return profilesPending;
      if (parsed.pathname === "/api/config") {
        return new Response(JSON.stringify(parsed.searchParams.get("profile") === PRIVATE_PROFILE_ID ? privateConfig : profileConfig("dark", "Arbeitsort")), { status: 200 });
      }
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/profiles")).toBe(true));
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/config?"))).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => {
      const path = new URL(String(input), "http://dashboard.test").pathname;
      return path === "/api/proxy" || path === "/api/homelab";
    })).toBe(false);

    resolveProfiles(new Response(JSON.stringify(TWO_PROFILE_CATALOG), { status: 200 }));
    await waitFor(() => expect(localStorage.getItem("dashboard:active-profile")).toBe(PRIVATE_PROFILE_ID));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === `/api/config?profile=${PRIVATE_PROFILE_ID}`)).toBe(true));
    expect(fetchMock.mock.calls.some(([input]) => String(input) === `/api/config?profile=${WORK_PROFILE_ID}`)).toBe(false);
    expect(await screen.findByText(/Privatort/)).toBeTruthy();
  });

  it("isoliert zwei simulierte Geräte durch die lokale aktive ID", async () => {
    const work = profileConfig("dark", "Arbeitsort");
    const privateConfig = profileConfig("light", "Privatort");
    writeLocalCatalog(TWO_PROFILE_CATALOG);
    writeLocalConfig(WORK_PROFILE_ID, work);
    writeLocalConfig(PRIVATE_PROFILE_ID, privateConfig);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") return new Response(JSON.stringify(TWO_PROFILE_CATALOG), { status: 200 });
      if (parsed.pathname === "/api/config") return new Response(JSON.stringify(parsed.searchParams.get("profile") === WORK_PROFILE_ID ? work : privateConfig), { status: 200 });
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    writeActiveProfileId(WORK_PROFILE_ID);
    const first = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText(/Arbeitsort/)).toBeTruthy());
    first.unmount();

    localStorage.clear();
    writeLocalCatalog(TWO_PROFILE_CATALOG);
    writeActiveProfileId(PRIVATE_PROFILE_ID);
    writeLocalConfig(PRIVATE_PROFILE_ID, privateConfig);
    expect(localStorage.getItem("dashboard:active-profile")).toBe(PRIVATE_PROFILE_ID);
    expect(localStorage.getItem(`dashboard:config:${PRIVATE_PROFILE_ID}`)).toContain("Privatort");
    const secondClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={secondClient}><App /></QueryClientProvider>);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === `/api/config?profile=${PRIVATE_PROFILE_ID}`)).toBe(true));
    await waitFor(() => expect(secondClient.getQueryData(["config", PRIVATE_PROFILE_ID])).toEqual(privateConfig));
    await waitFor(() => expect(document.body.textContent).toContain("Privatort"));
    expect(fetchMock.mock.calls.some(([input]) => String(input) === `/api/config?profile=${PRIVATE_PROFILE_ID}`)).toBe(true);
  });

  it("wechselt bei entfernter Auswahl zum ersten Profil und übernimmt Theme und Layout", async () => {
    const work = profileConfig("dark", "Arbeitsort");
    const privateConfig = profileConfig("light", "Privatort", true);
    writeLocalCatalog(TWO_PROFILE_CATALOG);
    writeActiveProfileId(WORK_PROFILE_ID);
    writeLocalConfig(WORK_PROFILE_ID, work);
    writeLocalConfig(PRIVATE_PROFILE_ID, privateConfig);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") return new Response(JSON.stringify(TWO_PROFILE_CATALOG), { status: 200 });
      if (parsed.pathname === "/api/config") return new Response(JSON.stringify(parsed.searchParams.get("profile") === WORK_PROFILE_ID ? work : privateConfig), { status: 200 });
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText(/Arbeitsort/)).toBeTruthy());

    fireEvent.keyDown(window, { key: "5" });
    expect(document.querySelector(".sl-panes .is-active")?.textContent).toContain("news");

    client.setQueryData(["profiles"], {
      ...TWO_PROFILE_CATALOG,
      profiles: [TWO_PROFILE_CATALOG.profiles[1]],
    });
    await waitFor(() => expect(screen.getByText("Profil wurde entfernt — Standardprofil aktiv.")).toBeTruthy());
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.queryByRole("heading", { name: "Weather" })).toBeNull();
    expect(document.querySelector(".sl-panes .is-active")).toBeNull();
    expect(localStorage.getItem("dashboard:active-profile")).toBe(PRIVATE_PROFILE_ID);
  });

  it("bewahrt einen offenen Settings-Entwurf bei entfernter aktiver Auswahl bis zur Bestätigung", async () => {
    const work = profileConfig("dark", "Arbeitsort");
    const privateConfig = profileConfig("light", "Privatort");
    writeLocalCatalog(TWO_PROFILE_CATALOG);
    writeActiveProfileId(WORK_PROFILE_ID);
    writeLocalConfig(WORK_PROFILE_ID, work);
    writeLocalConfig(PRIVATE_PROFILE_ID, privateConfig);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") return new Response(JSON.stringify(TWO_PROFILE_CATALOG), { status: 200 });
      if (parsed.pathname === "/api/config") {
        return new Response(JSON.stringify(parsed.searchParams.get("profile") === WORK_PROFILE_ID ? work : privateConfig), { status: 200 });
      }
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText(/Arbeitsort/)).toBeTruthy());

    typeCommand(":settings");
    fireEvent.click(screen.getByRole("tab", { name: "Links" }));
    fireEvent.change(screen.getByDisplayValue("Datasphere"), { target: { value: "Entwurf Arbeit" } });
    expect(screen.getByDisplayValue("Entwurf Arbeit")).toBeTruthy();

    client.setQueryData(["profiles"], {
      ...TWO_PROFILE_CATALOG,
      profiles: [TWO_PROFILE_CATALOG.profiles[1]],
    });
    await waitFor(() => expect(localStorage.getItem("dashboard:active-profile")).toBe(PRIVATE_PROFILE_ID));
    expect(screen.getByDisplayValue("Entwurf Arbeit")).toBeTruthy();
    expect(screen.getAllByRole("alert").some((alert) => alert.textContent?.includes("Entwurf"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Entwurf verwerfen und Profil laden/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Ort & Zeit" }));
    await waitFor(() => expect(screen.getByDisplayValue("Privatort")).toBeTruthy());
    expect(screen.queryByDisplayValue("Entwurf Arbeit")).toBeNull();
  });

  it("zeigt keine verspätete Antwort des alten Profils im neuen Profil", async () => {
    const work = { ...profileConfig("dark", "Arbeitsort"), feeds: [{ label: "Arbeit", url: "https://work.example/rss", limit: 5 }] };
    const privateConfig = { ...profileConfig("light", "Privatort"), feeds: [{ label: "Privat", url: "https://private.example/rss", limit: 5 }] };
    writeLocalCatalog(TWO_PROFILE_CATALOG);
    writeActiveProfileId(WORK_PROFILE_ID);
    writeLocalConfig(WORK_PROFILE_ID, work);
    writeLocalConfig(PRIVATE_PROFILE_ID, privateConfig);
    let resolveWork: (value: Response) => void = () => undefined;
    const workPending = new Promise<Response>((resolve) => { resolveWork = resolve; });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      if (parsed.pathname === "/api/profiles") return new Response(JSON.stringify(TWO_PROFILE_CATALOG), { status: 200 });
      if (parsed.pathname === "/api/config") return new Response(JSON.stringify(parsed.searchParams.get("profile") === WORK_PROFILE_ID ? work : privateConfig), { status: 200 });
      if (parsed.pathname === "/api/proxy" && parsed.searchParams.get("profile") === WORK_PROFILE_ID) return workPending;
      if (parsed.pathname === "/api/proxy") return new Response(rss("Privat"), { status: 200 });
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes(`profile=${WORK_PROFILE_ID}`))).toBe(true));
    client.setQueryData(["profiles"], { ...TWO_PROFILE_CATALOG, profiles: [TWO_PROFILE_CATALOG.profiles[1]] });
    await waitFor(() => expect(screen.getAllByText("Privat").length).toBeGreaterThan(0));

    resolveWork(new Response(rss("Arbeit"), { status: 200 }));
    await waitFor(() => expect(screen.queryByText("Arbeit")).toBeNull());
    expect(screen.getAllByText("Privat").length).toBeGreaterThan(0);
  });

  it("wechselt Uptime auf die neue Profil-ID und verwirft die alte Antwort", async () => {
    const work = uptimeConfig(true);
    const privateConfig = {
      ...uptimeConfig(true),
      uptime: {
        enabled: true,
        targets: uptimeConfig(true).uptime.targets.map((target) => ({ ...target, label: `Privat ${target.label}` })),
      },
    };
    writeLocalCatalog(TWO_PROFILE_CATALOG);
    writeActiveProfileId(WORK_PROFILE_ID);
    writeLocalConfig(WORK_PROFILE_ID, work);
    writeLocalConfig(PRIVATE_PROFILE_ID, privateConfig);
    let resolveWork: (value: Response) => void = () => undefined;
    const workPending = new Promise<Response>((resolve) => { resolveWork = resolve; });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://dashboard.test");
      const profileId = parsed.searchParams.get("profile");
      if (parsed.pathname === "/api/profiles") return new Response(JSON.stringify(TWO_PROFILE_CATALOG), { status: 200 });
      if (parsed.pathname === "/api/config") {
        return new Response(JSON.stringify(profileId === WORK_PROFILE_ID ? work : privateConfig), { status: 200 });
      }
      if (parsed.pathname === "/api/uptime" && profileId === WORK_PROFILE_ID) return workPending;
      if (parsed.pathname === "/api/uptime") return new Response(JSON.stringify(uptimeResponse("up")), { status: 200 });
      return new Response("", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === `/api/uptime?profile=${WORK_PROFILE_ID}`)).toBe(true));

    client.setQueryData(["profiles"], { ...TWO_PROFILE_CATALOG, profiles: [TWO_PROFILE_CATALOG.profiles[1]] });
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === `/api/uptime?profile=${PRIVATE_PROFILE_ID}`)).toBe(true));
    await waitFor(() => expect(screen.getByText("Privat Startseite")).toBeTruthy());

    resolveWork(new Response(JSON.stringify(uptimeResponse("down")), { status: 200 }));
    await waitFor(() => expect(screen.queryByText("nicht erreichbar")).toBeNull());
    expect(screen.getAllByText("erreichbar").length).toBeGreaterThan(0);
  });
});
