import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { initialUiState, uiReducer, useKeymap, type Mode, type PaneId, type UiAction, type UiState } from "./useKeymap";
import { openUrl } from "./url";

const ALL_PANES: ReadonlySet<PaneId> = new Set<PaneId>([
  "clock", "weather", "month", "links", "agenda", "news", "homelab",
]);

function setup(state: Partial<UiState>, options: {
  hints?: Record<string, string>;
  visiblePanes?: ReadonlySet<PaneId>;
} = {}) {
  const dispatch = vi.fn<(a: UiAction) => void>();
  const onSeed = vi.fn<(seed: string, mode: Mode) => void>();
  renderHook(() => useKeymap({
    state: { ...initialUiState, ...state },
    dispatch,
    hints: options.hints ?? {},
    rowCount: 0,
    selectedUrl: undefined,
    onSeed,
    overlayOpen: false,
    onOverlayEscape: () => undefined,
    visiblePanes: options.visiblePanes ?? ALL_PANES,
  }));
  return Object.assign(dispatch, { onSeed });
}

// Zwei Tasten im selben Tick, ohne dass React dazwischen rendern kann — fireEvent
// würde jedes Ereignis einzeln durch act() schleusen und die Lücke gerade zuschütten.
function pressTwiceInOneTick(first: string, second: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: first }));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: second }));
}

function press(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Kürzel", () => {
  it("erkennt gg — das zweite g gehört zum Kürzel, es beginnt keines neu", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const dispatch = setup({ hintBuffer: "g" }, { hints: { gg: "https://example.com/wiki" } });
    press("G", { shiftKey: true });
    expect(open).toHaveBeenCalledWith("https://example.com/wiki", "_blank", "noopener");
    expect(dispatch).toHaveBeenCalledWith({ type: "hint", buffer: "" });
  });

  it("verwirft den Puffer nach dem zweiten Zeichen, wenn nichts passt", () => {
    const dispatch = setup({ hintBuffer: "g" }, { hints: { gd: "https://example.com/" } });
    press("x");
    expect(dispatch).toHaveBeenCalledWith({ type: "hint", buffer: "" });
  });
});

describe("Auswahl-Synchronisierung", () => {
  const rowCounts = {
    clock: 0,
    weather: 0,
    month: 0,
    links: 0,
    news: 2,
    agenda: 0,
    homelab: 0,
  };

  it("klemmt eine Auswahl auf die letzte sichtbare Zeile", () => {
    const state: UiState = { ...initialUiState, pane: "news", row: 4 };
    const next = uiReducer(state, { type: "sync", rowCounts, visiblePanes: ALL_PANES });
    expect(next.pane).toBe("news");
    expect(next.row).toBe(1);
  });

  it("wechselt bei einem ausgeblendeten Pane deterministisch zum ersten sichtbaren", () => {
    const state: UiState = { ...initialUiState, pane: "news", row: 1 };
    const visible = new Set<PaneId>(["clock", "links"]);
    const next = uiReducer(state, { type: "sync", rowCounts, visiblePanes: visible });
    expect(next.pane).toBe("clock");
    expect(next.row).toBe(0);
  });
});

describe("Schnelles Tippen", () => {
  it("behält den Kommandomodus, wenn direkt nach dem : weitergetippt wird", () => {
    const dispatch = setup({});
    pressTwiceInOneTick(":", "s");
    expect(dispatch.onSeed).toHaveBeenCalledTimes(1);
    expect(dispatch.onSeed).toHaveBeenCalledWith(":", "COMMAND");
  });

  it("behält den Suchmodus, wenn direkt nach dem ersten Zeichen weitergetippt wird", () => {
    const dispatch = setup({});
    pressTwiceInOneTick("d", "a");
    expect(dispatch.onSeed).toHaveBeenCalledTimes(1);
    expect(dispatch.onSeed).toHaveBeenCalledWith("d", "INSERT");
  });

  it("öffnet ein schnell getipptes Kürzel, statt es an die Suche zu verlieren", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const dispatch = setup({}, { hints: { gd: "https://example.com/" } });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "D", shiftKey: true }));
    expect(dispatch.onSeed).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith("https://example.com/", "_blank", "noopener");
  });
});

describe("Pane-Tasten", () => {
  it("fokussiert ein sichtbares Pane", () => {
    const dispatch = setup({});
    press("5");
    expect(dispatch).toHaveBeenCalledWith({ type: "focusPane", pane: "news" });
  });

  it("fokussiert kein ausgeblendetes Pane", () => {
    const visible = new Set<PaneId>(["clock", "weather", "month", "links", "news", "homelab"]);
    const dispatch = setup({}, { visiblePanes: visible });
    press("6");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("erreicht auch die siebte Pane", () => {
    const dispatch = setup({});
    press("7");
    expect(dispatch).toHaveBeenCalledWith({ type: "focusPane", pane: "homelab" });
  });
});

describe("openUrl", () => {
  it("öffnet http und https", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openUrl("https://example.com/", true);
    expect(open).toHaveBeenCalledWith("https://example.com/", "_blank", "noopener");
  });

  it("öffnet kein javascript: aus der Config", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openUrl("javascript:alert(1)", true);
    expect(open).not.toHaveBeenCalled();
  });

  it("öffnet kein data:", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openUrl("data:text/html,<script>alert(1)</script>", true);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("Esc im Einstellungsdialog", () => {
  function setupOverlay() {
    const onOverlayEscape = vi.fn();
    renderHook(() => useKeymap({
      state: initialUiState,
      dispatch: vi.fn(),
      hints: {},
      rowCount: 0,
      selectedUrl: undefined,
      onSeed: vi.fn(),
      overlayOpen: true,
      onOverlayEscape,
      visiblePanes: ALL_PANES,
    }));
    return onOverlayEscape;
  }

  it("gibt bei offenem Dialog nur das Feld frei, statt den Entwurf zu verwerfen", () => {
    const onOverlayEscape = setupOverlay();
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).not.toBe(field);
    expect(onOverlayEscape).not.toHaveBeenCalled();
    field.remove();
  });

  it("schließt den Dialog, sobald der Fokus nicht mehr in einem Feld steht", () => {
    const onOverlayEscape = setupOverlay();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onOverlayEscape).toHaveBeenCalledOnce();
  });
});
