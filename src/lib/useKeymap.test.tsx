import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { initialUiState, openUrl, useKeymap, type PaneId, type UiAction, type UiState } from "./useKeymap";

const ALL_PANES: ReadonlySet<PaneId> = new Set<PaneId>([
  "clock", "weather", "links", "agenda", "news", "homelab",
]);

function setup(state: Partial<UiState>, options: {
  hints?: Record<string, string>;
  visiblePanes?: ReadonlySet<PaneId>;
} = {}) {
  const dispatch = vi.fn<(a: UiAction) => void>();
  renderHook(() => useKeymap({
    state: { ...initialUiState, ...state },
    dispatch,
    hints: options.hints ?? {},
    rowCount: 0,
    selectedUrl: undefined,
    onSeed: () => undefined,
    overlayOpen: false,
    onOverlayEscape: () => undefined,
    visiblePanes: options.visiblePanes ?? ALL_PANES,
  }));
  return dispatch;
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
    press("g", { shiftKey: true });
    expect(open).toHaveBeenCalledWith("https://example.com/wiki", "_blank", "noopener");
    expect(dispatch).toHaveBeenCalledWith({ type: "hint", buffer: "" });
  });

  it("verwirft den Puffer nach dem zweiten Zeichen, wenn nichts passt", () => {
    const dispatch = setup({ hintBuffer: "g" }, { hints: { gd: "https://example.com/" } });
    press("x");
    expect(dispatch).toHaveBeenCalledWith({ type: "hint", buffer: "" });
  });
});

describe("Pane-Tasten", () => {
  it("fokussiert ein sichtbares Pane", () => {
    const dispatch = setup({});
    press("4");
    expect(dispatch).toHaveBeenCalledWith({ type: "focusPane", pane: "agenda" });
  });

  it("fokussiert kein ausgeblendetes Pane", () => {
    const visible = new Set<PaneId>(["clock", "weather", "links", "news", "homelab"]);
    const dispatch = setup({}, { visiblePanes: visible });
    press("4");
    expect(dispatch).not.toHaveBeenCalled();
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
