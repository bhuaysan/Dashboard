import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { defaultConfig } from "./config/defaults";

const EMPTY_HOMELAB = {
  configured: false,
  node: {
    cpu: 0, mem: 0, root: 0, uptimeDays: 0,
    cpuSpark: [], memSpark: [], cpuLevel: "ok", memLevel: "ok", rootLevel: "ok",
  },
  guests: [], storage: [], alerts: [],
};

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

function stubBaseApi(config = defaultConfig, putResponse?: Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/config" && init?.method === "PUT") {
      return putResponse ?? new Response(JSON.stringify(defaultConfig), { status: 200 });
    }
    if (url === "/api/config") return new Response(JSON.stringify(config), { status: 200 });
    if (url === "/api/homelab") return new Response(JSON.stringify(EMPTY_HOMELAB), { status: 200 });
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

describe("App", () => {
  it("rendert Panes, Suchzeile und Statusline", () => {
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
  });

  it("gibt jeder Linkzeile ein echtes href", () => {
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
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );
    typeCommand(":gibtsnicht");
    expect(screen.getByText("Unbekanntes Kommando: :gibtsnicht")).toBeTruthy();
  });

  it("isoliert das Raster, solange das Settings-Dialog offen ist", () => {
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
      String(input) === "/api/config" && init?.method === "PUT",
    )).toBe(true);
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
      if (url === "/api/config") return new Response(JSON.stringify(config), { status: 200 });
      if (url === "/api/homelab") return new Response(JSON.stringify(EMPTY_HOMELAB), { status: 200 });
      const target = new URL(url, "http://dashboard.test").searchParams.get("url") ?? "";
      if (target.includes("feed-ok")) return new Response(feed, { status: 200 });
      if (target.includes("calendar-ok")) return new Response(ics, { status: 200 });
      return new Response("kaputt", { status: 502 });
    });
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
});
