import { useEffect, useRef, useState } from "react";
import type { Config } from "../config/schema";
import { fuzzyFilter } from "../lib/fuzzy";
import { resolveQuery } from "../lib/bangs";
import { openUrl, type Mode } from "../lib/useKeymap";

export type FlatLink = { label: string; url: string; hint?: string; group: string };

type Props = {
  mode: Mode;
  seed: string | null;
  links: FlatLink[];
  search: Config["search"];
  onModeChange: (mode: Mode) => void;
  onCommand: (cmd: string) => void;
};

export function CommandBar({ mode, seed, links, search, onModeChange, onCommand }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const previousMode = useRef<Mode>(mode);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const wasNormal = previousMode.current === "NORMAL";
    const isActive = mode === "INSERT" || mode === "COMMAND";
    if (isActive) {
      // Nur der Übergang aus NORMAL initialisiert den Wert. INSERT und COMMAND
      // dürfen beim Tippen ineinander wechseln, ohne den bisher eingegebenen Text
      // durch den alten Seed zu ersetzen.
      if (wasNormal) setValue(seed ?? "");
      el.focus();
    } else {
      setValue("");
      el.blur();
    }
    previousMode.current = mode;
  }, [mode, seed]);

  function close() {
    setValue("");
    onModeChange("NORMAL");
  }

  function onEnter() {
    const v = value.trim();
    if (v.startsWith(":")) {
      // Mehrere Doppelpunkte sind kein Fehler: die Zeile öffnet sich bereits mit einem,
      // und wer ihn aus Gewohnheit noch einmal tippt, meint dasselbe Kommando.
      const cmd = v.replace(/^:+\s*/, "");
      close();
      if (cmd !== "") onCommand(cmd);
      return;
    }
    if (v === "") {
      close();
      return;
    }
    const hits = fuzzyFilter(v, links, (l) => l.label);
    const first = hits[0];
    close();
    if (first) {
      openUrl(first.url, false);
      return;
    }
    const target = resolveQuery(v, search);
    if (target) openUrl(target, false);
  }

  const hits = value.startsWith(":") || value.startsWith("!") || value.trim() === ""
    ? []
    : fuzzyFilter(value, links, (l) => l.label);
  const showResults = value.trim() !== "" && !value.startsWith(":");

  return (
    <div className={`cmd${mode !== "NORMAL" ? " is-focused" : ""}`}>
      <div className="cmd-inner">
        <span className="cmd-prompt">▸</span>
        <input
          ref={inputRef}
          type="text"
          placeholder="search or type a command"
          autoComplete="off"
          spellCheck={false}
          aria-label="Suche oder Kommando"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            setValue(v);
            if (v.startsWith(":")) onModeChange("COMMAND");
            else if (mode !== "INSERT") onModeChange("INSERT");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            }
          }}
          onFocus={() => {
            if (mode === "NORMAL") onModeChange("INSERT");
          }}
        />
        <span className="caret" aria-hidden="true" />
      </div>
      <div className="results" hidden={!showResults}>
        {value.startsWith("!") ? (
          <div className="res-row is-sel">
            <span>Websuche mit Bang <b>{value.split(" ")[0]}</b></span>
          </div>
        ) : hits.length === 0 ? (
          <div className="res-row is-sel">
            <span>Websuche nach „{value.trim()}“</span>
          </div>
        ) : (
          hits.map((l, i) => (
            <div key={l.url} className={`res-row${i === 0 ? " is-sel" : ""}`}>
              <span className="hint">{l.hint ?? ""}</span>
              <span>{l.label}</span>
              <span className="where">{l.group}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
