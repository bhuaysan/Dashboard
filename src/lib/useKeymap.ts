import { useEffect, useRef } from "react";
import { PANE_IDS, type PaneId } from "../config/schema";
import { openUrl } from "./url";

export type Mode = "NORMAL" | "INSERT" | "COMMAND";
export type { PaneId };

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
  | { type: "sync"; rowCounts: Readonly<Record<PaneId, number>>; visiblePanes: ReadonlySet<PaneId> }
  | { type: "resetSelection" }
  | { type: "reset" };

// Reihenfolge und Kürzel der Statusline. Die Ziffern 1–7 folgen dieser Liste, sie muss
// deshalb dieselbe Reihenfolge haben wie PANE_IDS und die Panes in App.tsx.
const PANE_LABELS: Record<PaneId, string> = {
  clock: "clock", weather: "weather", month: "month", links: "links",
  news: "news", agenda: "agenda", homelab: "lab",
};
export const PANE_ORDER: { id: PaneId; label: string }[] = PANE_IDS.map((id) => ({
  id,
  label: PANE_LABELS[id],
}));

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
    case "sync": {
      if (state.pane === null) return state;
      const visiblePane = action.visiblePanes.has(state.pane)
        ? state.pane
        : PANE_ORDER.find((entry) => action.visiblePanes.has(entry.id))?.id ?? null;
      if (visiblePane === null) return { ...state, pane: null, row: 0 };
      const count = action.rowCounts[visiblePane] ?? 0;
      const row = count === 0 ? 0 : Math.max(0, Math.min(count - 1, state.row));
      if (visiblePane === state.pane && row === state.row) return state;
      return { ...state, pane: visiblePane, row };
    }
    case "reset":
      return { ...state, mode: "NORMAL", hintBuffer: "", showHelp: false };
    case "resetSelection":
      return { ...state, mode: "NORMAL", pane: null, row: 0, hintBuffer: "", showHelp: false };
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
  overlayOpen: boolean;
  onOverlayEscape: () => void;
  visiblePanes: ReadonlySet<PaneId>;
};

export function useKeymap({ state, dispatch, hints, rowCount, selectedUrl, onSeed, overlayOpen, onOverlayEscape, visiblePanes }: Params): void {
  // Der Handler kennt nur den Zustand aus dem letzten Render. Kommen zwei Tasten an,
  // bevor React neu gerendert hat, sähe die zweite noch den alten Modus und würde ihn
  // überschreiben — aus ":s" wurde so eine Suche nach "s" statt eines Kommandos.
  // Deshalb werden Modus und Kürzelpuffer hier sofort mitgeführt.
  const live = useRef({ mode: state.mode, hintBuffer: state.hintBuffer });
  useEffect(() => {
    live.current = { mode: state.mode, hintBuffer: state.hintBuffer };
  }, [state.mode, state.hintBuffer]);

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField = target !== null && (
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" || target.isContentEditable
      );
      if (e.key === "Escape") {
        // Im Einstellungsdialog gibt Esc erst das Feld frei. Vorher hat ein Esc aus
        // Gewohnheit mitten im Tippen den ganzen Entwurf verworfen. Die Kommandozeile
        // bleibt davon unberührt — dort schließt Esc weiterhin sofort.
        if (overlayOpen && inField) {
          target.blur();
          e.preventDefault();
          return;
        }
        if (overlayOpen) onOverlayEscape();
        else {
          live.current = { mode: "NORMAL", hintBuffer: "" };
          dispatch({ type: "reset" });
        }
        return;
      }
      // Solange ein Overlay offen ist, gilt keine andere globale Taste —
      // sonst würde jeder Tastendruck im Formular als Kommando gedeutet.
      if (overlayOpen) return;
      if (inField) return;
      if (live.current.mode !== "NORMAL") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "?") {
        dispatch({ type: "help", show: true });
        e.preventDefault();
        return;
      }
      if (e.key === "/" || e.key === ":") {
        const mode: Mode = e.key === ":" ? "COMMAND" : "INSERT";
        live.current.mode = mode;
        onSeed(e.key === ":" ? ":" : "", mode);
        e.preventDefault();
        return;
      }
      // Nur solange kein Kürzel angefangen ist — sonst wäre das zweite Zeichen von "gg"
      // nicht erreichbar.
      if (e.key === "g" && live.current.hintBuffer === "") {
        live.current.hintBuffer = "g";
        dispatch({ type: "hint", buffer: "g" });
        e.preventDefault();
        return;
      }
      if (live.current.hintBuffer !== "") {
        if (e.key === "Backspace") {
          const next = live.current.hintBuffer.slice(0, -1);
          live.current.hintBuffer = next;
          dispatch({ type: "hint", buffer: next });
          e.preventDefault();
          return;
        }
        if (e.key.length !== 1) return;
        const buf = (live.current.hintBuffer + e.key).toLowerCase();
        const url = hints[buf];
        if (url) {
          openUrl(url, e.shiftKey);
          live.current.hintBuffer = "";
          dispatch({ type: "hint", buffer: "" });
        } else {
          // Solange mindestens ein konfiguriertes Kürzel so beginnt, wartet die
          // Tastatursteuerung auf das nächste Zeichen. Sonst ist die Folge ungültig.
          const next = Object.keys(hints).some((hint) => hint.startsWith(buf)) ? buf : "";
          live.current.hintBuffer = next;
          dispatch({ type: "hint", buffer: next });
        }
        e.preventDefault();
        return;
      }
      if (e.key >= "1" && e.key <= String(PANE_ORDER.length)) {
        const entry = PANE_ORDER[Number(e.key) - 1];
        // Ausgeblendete Panes lassen sich nicht fokussieren — die Auswahl wäre unsichtbar.
        if (entry && visiblePanes.has(entry.id)) dispatch({ type: "focusPane", pane: entry.id });
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
        live.current.mode = "INSERT";
        onSeed(e.key, "INSERT");
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [state, dispatch, hints, rowCount, selectedUrl, onSeed, overlayOpen, onOverlayEscape, visiblePanes]);
}
