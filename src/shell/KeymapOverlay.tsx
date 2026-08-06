import { useEffect, useRef } from "react";

type Props = { open: boolean };

export function KeymapOverlay({ open }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Ohne Fokus im Kasten liest ein Screenreader weiter die Seite dahinter — die
  // Übersicht wäre für ihn schlicht nicht da.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    boxRef.current?.focus();
    return () => restoreRef.current?.focus({ preventScroll: true });
  }, [open]);

  return (
    <div className="overlay" hidden={!open}>
      <div
        className="overlay-box"
        ref={boxRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keymap-title"
      >
        <h2 id="keymap-title">Tastenbelegung</h2>
        <dl className="keys">
          <dt>Zeichen, /</dt><dd>Fokus ins Suchfeld (INSERT)</dd>
          <dt>1 – 6</dt><dd>Pane fokussieren</dd>
          <dt>j / k</dt><dd>Zeile ab / auf im fokussierten Pane</dd>
          <dt>Enter</dt><dd>ausgewählte Zeile öffnen</dd>
          <dt>Shift+Enter</dt><dd>in neuem Tab öffnen</dd>
          <dt>Tab</dt><dd>Zeile für Zeile ohne Maus — jede Zeile ist ein Link</dd>
          <dt>g, dann Zeichen</dt><dd>Link direkt öffnen — das Kürzel neben dem Link, z. B. gd → Datasphere</dd>
          <dt>:</dt><dd>Kommando — settings, export, import, refresh, reload, theme</dd>
          <dt>?</dt><dd>diese Übersicht</dd>
          <dt>Esc</dt><dd>zurück nach NORMAL</dd>
        </dl>
      </div>
    </div>
  );
}
