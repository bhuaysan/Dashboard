type Props = { open: boolean };

export function KeymapOverlay({ open }: Props) {
  return (
    <div className="overlay" hidden={!open}>
      <div className="overlay-box">
        <h2>Tastenbelegung</h2>
        <dl className="keys">
          <dt>Zeichen, /</dt><dd>Fokus ins Suchfeld (INSERT)</dd>
          <dt>1 – 6</dt><dd>Pane fokussieren</dd>
          <dt>j / k</dt><dd>Zeile ab / auf im fokussierten Pane</dd>
          <dt>Enter</dt><dd>ausgewählte Zeile öffnen</dd>
          <dt>Shift+Enter</dt><dd>in neuem Tab öffnen</dd>
          <dt>g, dann Zeichen</dt><dd>Link direkt öffnen — das Kürzel neben dem Link, z. B. gd → Datasphere</dd>
          <dt>:</dt><dd>Kommando — settings, export, import, refresh, reload, theme</dd>
          <dt>?</dt><dd>diese Übersicht</dd>
          <dt>Esc</dt><dd>zurück nach NORMAL</dd>
        </dl>
      </div>
    </div>
  );
}
