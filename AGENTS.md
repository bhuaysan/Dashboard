# Dashboard — Arbeitsanweisung

Persönliche Browser-Startseite im Stil eines Terminal-Multiplexers (tmux/ranger). Läuft als Dienst
in einem LXC im Heimnetz, erreichbar unter `http://start.home.arpa`. Zeigt Uhr, Wetter, Termine,
News, eigene Links und den Zustand des Proxmox-Homelabs. Bedienung primär per Tastatur.

> Diese Datei ist die kanonische Anweisung, unabhängig vom eingesetzten Werkzeug.
> `CLAUDE.md` ist nur ein Symlink hierauf. Bearbeite immer `AGENTS.md`.

## Die zwei Quellen der Wahrheit

| Datei | Rolle |
| --- | --- |
| **`PLAN.md`** | Die vollständige Umsetzungsanleitung. Zehn Schritte in fester Reihenfolge, jeder mit Dateiliste, Code-Vorlagen und Abnahmekriterien. **Lies den Schritt komplett, bevor du ihn beginnst.** |
| **`mockup/index.html`** | Das abgestimmte Design. Verbindlich für Farben, Abstände, Spaltenbreiten, Zeichen, Beschriftungen und Interaktion. Im Browser öffnen und ansehen. |

Bei Widersprüchen gilt: Mockup vor ASCII-Skizze, `PLAN.md` vor eigener Einschätzung.

`mockup/` ist **kein** Teil der Anwendung — nichts daraus wird importiert, gebaut oder deployt.

## Stand

Noch nichts gebaut. Der nächste Schritt ist **Schritt 0** in `PLAN.md` (Node installieren, Vite-
Gerüst, Abhängigkeiten). Vorhanden sind bereits: `.env` mit gültigem Proxmox-Token, `.env.example`,
`.gitignore`, `pve-ca.pem` (verifizierte Proxmox-CA), `mockup/index.html`, `opencode.json`.

**`.env` ist für dich gesperrt** (Lesen und Schreiben, siehe `opencode.json`). Du brauchst sie nicht:
die Variablennamen stehen in `.env.example`, und zur Laufzeit liest der Server sie über
`process.env`. Wenn du glaubst, `.env` lesen zu müssen, ist das ein Denkfehler — frag nach.

## Was das Werkzeug können muss

Der Plan setzt **Dateisystem- und Shell-Zugriff** voraus. Konkret:

- Schritt 0 ruft `brew install node` und `pnpm` auf
- Schritt 6 braucht Netzzugriff auf `https://10.0.10.10:8006` (Proxmox-API)
- Schritt 7 braucht `ssh`, `scp`, `rsync` und `systemctl` gegen `10.0.10.20`

Ein Werkzeug ohne Shell (reine Chat-Oberfläche) kann die Schritte 0, 6 und 7 nicht ausführen. Es
kann den Code schreiben, aber Installation, Abfrage und Deployment muss der Mensch übernehmen. Sag
in diesem Fall ausdrücklich, welche Befehle der Benutzer selbst ausführen soll — führe sie nicht
stillschweigend aus der Beschreibung heraus als erledigt an.

## Harte Regeln

Verstöße sind Fehler, auch wenn der Code läuft.

1. **Keine anderen Abhängigkeiten** als die Liste in Schritt 0. Keine Icon-, Charting-, UI- oder
   Date-Library. `Intl` reicht für Datum und Zeit.
2. **Keine Emoji, keine Icons.** Zustände sind Textzeichen: `●` läuft, `○` gestoppt, `!` Alarm,
   `▁▂▃▄▅▆▇` Sparkline, `━─` Balken.
3. **Farben nur über die CSS-Variablen** aus `PLAN.md` Abschnitt 5. Nie ein Hex-Wert in einer
   Komponente. Keine Tailwind-Opacity-Modifier auf diesen Farben. Die Werte sind gegen WCAG AA
   nachgerechnet — ändere keinen ohne neue Rechnung.
4. **Secrets nur in `.env`,** gelesen ausschließlich über `process.env`. Niemals in `config.json`,
   niemals in einer HTTP-Antwort, niemals in einem Log. `GET /api/config` geht unauthentifiziert an
   das ganze LAN. Gib den Inhalt von `.env` auch nicht im Chat wieder.
5. **`/api/proxy` bekommt kein Loch.** Private Adressen inklusive `10.x` bleiben gesperrt.
   Proxmox-Daten laufen ausschließlich über den aggregierten Endpunkt `GET /api/homelab`.
6. **Sprache:** Pane-Titel und Statusline-Kürzel englisch und groß (`CLOCK`, `wx`, `cfg`), alle
   Inhalte und Meldungen für den Benutzer deutsch, Code-Identifier englisch.
7. **Nach jedem Schritt** `pnpm test` **und** `pnpm build`. Beide grün, bevor der nächste beginnt.
8. **TypeScript strict** inklusive `noUncheckedIndexedAccess` — Array-Zugriffe brauchen einen
   Fallback (`arr[i] ?? default`). Kein `any`, kein `as` zum Wegdrücken von Fehlern.
9. **Der Browser ruft nie eine fremde Domain direkt auf.** Jeder Netzzugriff geht an `/api/...`.
10. **Bei Unklarheit die einfachste Lösung.** Keine Architekturänderung, keine zusätzliche
    Abstraktionsschicht, keine Datenbank, kein Framework-Wechsel.

## Umgebung (geprüft, nicht neu ermitteln)

- Proxmox `10.0.10.10:8006`, Node heißt `pve`, 13 Gäste (VMID 100–112), Storages `tank`, `local`,
  `local-lvm`. Token in `.env` funktioniert, alle sechs benötigten Endpunkte antworten mit `200`.
- **`/cluster/resources` enthält kein `onboot`** — deshalb die Liste `homelab.expectRunning` in der
  Config.
- **Es gibt null `vzdump`-Tasks.** Die Backup-Alarmlogik muss den leeren Fall zuerst behandeln,
  sonst entstehen dreizehn Alarmzeilen. Siehe `PLAN.md`, Schritt 6.
- Pi-hole `10.0.10.11` ist **v6** (REST-API unter `/api`, nicht `api.php`).
- Zielcontainer wird `10.0.10.20`, Hostname `start.home.arpa` (nicht `.local` — macOS löst das per
  mDNS auf und fragt den Pi-hole nicht).
- Browser sind Firefox und Safari. **Kein Chrome** — keine Chrome-Extension bauen.

## Nicht bauen

To-Dos, Notizen, Drag-and-Drop-Layout, Multi-Profile, HTTPS, Zugriff von außerhalb des LAN,
Browser-Extensions, Microsoft Graph oder OAuth, Datenbank, Docker, Login, Pi-hole-Widget,
Speedtest, SMART-Werte, Graphen pro Gast. Die vollständige Liste mit Begründungen steht am Ende
von `PLAN.md`.
