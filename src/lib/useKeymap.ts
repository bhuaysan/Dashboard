import { useEffect } from "react";

export type Mode = "NORMAL" | "INSERT" | "COMMAND";
export type PaneId = "clock" | "weather" | "links" | "agenda" | "news" | "homelab";

export type UiState = {
  mode: Mode;
  pane: PaneId | null;
  row: number;
  hintBuffer: string;
  showHelp: boolean;
};

export type UiAction =
  | { type: "mode"; mode: Mode }
  | { type: "focusPane"; pane: PaneId }
  | { type: "move"; delta: number; rowCount: number }
  | { type: "hint"; buffer: string }
  | { type: "help"; show: boolean }
  | { type: "reset" };

export const PANE_ORDER: { id: PaneId; label: string }[] = [
  { id: "clock", label: "clock" },
  { id: "weather", label: "weather" },
  { id: "links", label: "links" },
  { id: "agenda", label: "agenda" },
  { id: "news", label: "news" },
  { id: "homelab", label: "lab" },
];

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "mode":
      return { ...state, mode: action.mode, hintBuffer: "" };
    case "focusPane":
      return { ...state, mode: "NORMAL", pane: action.pane, row: 0, hintBuffer: "" };
    case "move": {
      if (state.pane === null || action.rowCount === 0) return state;
      const row = Math.max(0, Math.min(action.rowCount - 1, state.row + action.delta));
      return { ...state, row };
    }
    case "hint":
      return { ...state, hintBuffer: action.buffer };
    case "help":
      return { ...state, showHelp: action.show };
    case "reset":
      return { ...state, mode: "NORMAL", hintBuffer: "", showHelp: false };
  }
}

export const initialUiState: UiState = {
  mode: "NORMAL",
  pane: null,
  row: 0,
  hintBuffer: "",
  showHelp: false,
};

type Params = {
  state: UiState;
  dispatch: (a: UiAction) => void;
  hints: Record<string, string>;
  rowCount: number;
  selectedUrl: string | undefined;
  onSeed: (seed: string, mode: Mode) => void;
};

export function openUrl(url: string, newTab: boolean): void {
  if (newTab) window.open(url, "_blank", "noopener");
  else window.location.assign(url);
}

export function useKeymap({ state, dispatch, hints, rowCount, selectedUrl, onSeed }: Params): void {
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        dispatch({ type: "reset" });
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (state.mode !== "NORMAL") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (state.showHelp) {
        dispatch({ type: "help", show: false });
        e.preventDefault();
        return;
      }
      if (e.key === "?") {
        dispatch({ type: "help", show: true });
        e.preventDefault();
        return;
      }
      if (e.key === "/" || e.key === ":") {
        onSeed(e.key === ":" ? ":" : "", e.key === ":" ? "COMMAND" : "INSERT");
        e.preventDefault();
        return;
      }
      if (e.key === "g") {
        dispatch({ type: "hint", buffer: "g" });
        e.preventDefault();
        return;
      }
      if (state.hintBuffer !== "") {
        if (e.key.length !== 1) return;
        const buf = state.hintBuffer + e.key;
        const url = hints[buf];
        if (url) {
          openUrl(url, e.shiftKey);
          dispatch({ type: "hint", buffer: "" });
        } else if (buf.length >= 3) {
          dispatch({ type: "hint", buffer: "" });
        } else {
          dispatch({ type: "hint", buffer: buf });
        }
        e.preventDefault();
        return;
      }
      if (e.key >= "1" && e.key <= "6") {
        const entry = PANE_ORDER[Number(e.key) - 1];
        if (entry) dispatch({ type: "focusPane", pane: entry.id });
        e.preventDefault();
        return;
      }
      if (e.key === "j") {
        dispatch({ type: "move", delta: 1, rowCount });
        e.preventDefault();
        return;
      }
      if (e.key === "k") {
        dispatch({ type: "move", delta: -1, rowCount });
        e.preventDefault();
        return;
      }
      if (e.key === "Enter") {
        if (selectedUrl) openUrl(selectedUrl, e.shiftKey);
        e.preventDefault();
        return;
      }
      if (/^[a-zA-Z0-9äöüß]$/.test(e.key)) {
        onSeed(e.key, "INSERT");
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [state, dispatch, hints, rowCount, selectedUrl, onSeed]);
}
