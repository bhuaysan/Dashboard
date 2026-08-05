import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";

// Die Kommandozeile öffnet sich erst durch das globale ":", vorher setzt CommandBar
// den Eingabewert bei jedem Moduswechsel zurück.
function typeCommand(cmd: string) {
  fireEvent.keyDown(window, { key: ":" });
  const input = screen.getByLabelText("Suche oder Kommando");
  fireEvent.change(input, { target: { value: cmd } });
  fireEvent.keyDown(input, { key: "Enter" });
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
});
