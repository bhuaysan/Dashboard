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

**Schritte 0–9 aus `PLAN.md` sind umgesetzt und ausgerollt.** Der Dienst läuft als
`dashboard.service` im LXC 113 (`10.0.10.20`) auf Port 80 unter `http://start.home.arpa`.
`PLAN.md` ist damit kein Aufgabenzettel mehr, sondern Nachschlagewerk für Begründungen,
Farbwerte (Abschnitt 5) und die Liste dessen, was bewusst nicht gebaut wird.

**`.env` ist für dich gesperrt.** In opencode erzwingt das `opencode.json`; in Werkzeugen ohne
diese Sperre gilt die Regel trotzdem. Du brauchst die Datei nicht: die Variablennamen stehen in
`.env.example`, und zur Laufzeit liest der Server sie über `process.env`. Wenn du glaubst, `.env`
lesen zu müssen, ist das ein Denkfehler — frag nach. Auch `config.json` und `pve-ca.pem` sind
lokale, nicht versionierte Dateien.

## Befehle

```bash
pnpm install
pnpm dev:server                        # API auf :7777 (tsx watch, lädt .env)
pnpm dev                               # Vite auf :5173, proxyt /api nach :7777
pnpm test                              # vitest run (Frontend jsdom, Servertests Node)
pnpm build                             # tsc -b über beide Projekte + vite build
pnpm deploy                            # testet, baut, staged ein Release, Healthcheck + Rollback
```

Beide Dev-Prozesse werden gebraucht — ohne `dev:server` bleibt jede Pane leer, weil alle Daten
über `/api/...` kommen. Einzelne Tests:

```bash
pnpm vitest run server/pve.test.ts
pnpm vitest run -t "Kontraste"
```

## Architektur

Ein einziger Node-Prozess (Hono, `server/index.ts` mit App-Fabrik in `server/app.ts`) liefert `dist/`
**und** den offenen Profilkatalog `/api/profiles` (Schreibzugriffe geschützt), die profilabhängigen
Endpunkte `/api/config?profile=<id>`, `/api/proxy?profile=<id>&url=<url>` und `/api/homelab?profile=<id>`
sowie `/api/health`. Kein Bundling auf dem Server — `tsx` führt `server/` direkt aus, und weil der Server aus `src/` importiert
(`config/schema.ts`, `lib/relativeTime.ts`), wird `src/` mitdeployt. Ein Import aus `src/` in den
Server zieht also Produktionscode nach — nichts Browserspezifisches dort hineinziehen.

**Config und Profile.** `config.json` liegt nur auf dem Server-State (`/var/lib/dashboard`) und ist die Quelle der Wahrheit;
ein einziges Zod-Schema (`src/config/schema.ts`) validiert das Version-2-Dokument auf beiden Seiten:
`{ version: 2, profilesUpdatedAt, profiles: [{ id, name, config }] }`. Die IDs sind serverseitige UUIDs (für die
Migration ist `default` reserviert), Namen werden getrimmt und ohne Beachtung der Groß-/Kleinschreibung eindeutig
gehalten; es gibt mindestens ein und höchstens 16 Profile. `GET /api/profiles` liefert nur den Katalog aus IDs und
Namen, nie eine Config. `POST`, `PATCH` und `DELETE` am Katalog verlangen `If-Match: <profilesUpdatedAt>` und
die Schreibschutzprüfungen aus `DASHBOARD_WRITE_ALLOW` und `DASHBOARD_WRITE_HOSTS`.

Eine gültige alte Einzel-Config wird beim Lesen verlustfrei im Speicher zum Profil `default` / `Standard` migriert;
das reine Lesen schreibt nicht um. Der erste erfolgreiche Profil- oder Config-Schreibvorgang persistiert Version 2.
Unbekannte Panes werden je Profil entfernt, fehlende Panes je Profil aus den Defaults ergänzt. Eine syntaktisch oder
semantisch unlesbare Datei wird als `config.json.bak` gesichert und durch ein einzelnes Standardprofil ersetzt.
Jede Mutation läuft durch die Schreibqueue, rotiert das vollständige Profildokument in `config.json.1` bis
`config.json.7` und schreibt atomar über `rename`. Die Profil-Revision `profilesUpdatedAt` und die Config-Revision
`config.updatedAt` sind getrennte optimistische Sperren; ein Konflikt liefert 409, eine Größen- oder
Validierungsverletzung ändert Datei und Backups nicht.

Die profilabhängigen Endpunkte sind `GET /api/config?profile=<id>`, `PUT /api/config?profile=<id>`,
`GET /api/proxy?profile=<id>&url=<url>` und `GET /api/homelab?profile=<id>`. Die Profil-ID ist verpflichtend;
fehlend oder syntaktisch ungültig liefert 400, unbekannt 404. `PUT` prüft zusätzlich `If-Match: <config.updatedAt>`.
`/api/health` liest und validiert weiterhin das vollständige Dokument, gibt aber ausschließlich einen Status zurück.
`.env` und alle Secrets (einschließlich des PVE-Tokens) bleiben global für den Serverprozess, stehen nie in einem
Profil und werden von keinem Endpunkt zurückgegeben.

Im Browser hält `src/api/profiles.ts` den Katalog in React Query (Polling 15 s, Refetch bei Tab-Fokus),
`src/api/config.ts` die Config mit einem Query-Key pro Profil (ebenfalls Polling 15 s und Fokus-Refetch). Die lokale
Auswahl steht je Gerät unter `dashboard:active-profile`; Katalog und letzte gültige Config jedes verwendeten Profils
liegen getrennt in `localStorage`. Der alte Einzel-Cache wird einmalig für `default` übernommen. Wird das aktive
Profil entfernt, wechselt das Gerät zum ersten verbleibenden Profil und zeigt die definierte deutsche Meldung.

`homelab.enabled` des aktiven Profils steuert das Proxmox-Monitoring und den Zugriff auf
`/api/homelab?profile=<id>`.
`layout.homelab.visible` steuert nur die HOMELAB-Pane: Bei aktiviertem Monitoring bleibt die
Überwachung auch bei ausgeblendeter Pane aktiv. Bei deaktiviertem Monitoring gibt es keine
PVE-Requests und keine PVE-Status- oder Alarmanzeige. Fehlt `PVE_TOKEN_SECRET`, bleibt davon
unabhängig der Zustand `configured: false` („nicht konfiguriert“).

**Datenpfad der Panes.** Widget-Modul → `useCachedQuery` (React Query + `localStorage`-Cache mit
TTL und Schlüsselpräfix `profile:<id>:`) → `/api/proxy?profile=<id>&url=...`. Config-Abfragen laufen über
`useConfig(profileId)` und alle Browseraufrufe an Config, Proxy und Homelab übertragen die aktive Profil-ID.
Beim Wechsel werden die Abfragen des vorherigen Profils abgebrochen; getrennte Query- und Storage-Schlüssel
verhindern, dass späte Antworten den neuen Stand überschreiben. Der Proxy prüft vor jedem Cachetreffer die
manuelle Allowlist plus die aus Feed- und Kalenderquellen des gewählten Profils abgeleiteten Hosts, löst den Host
selbst auf und blockt private Ziele, prüft jede Weiterleitung erneut, begrenzt auf 2 MB und 5 s. Proxmox läuft
**nicht** darüber, sondern über den aggregierten `/api/homelab?profile=<id>` mit einem Server-Cache je Profil-ID und
Config-Revision (`<profileId>:<updatedAt>`); das Token verlässt den Server nie. Weil der `localStorage`-Cache reines
JSON ist, brauchen Daten mit `Date`-Feldern weiterhin eine Zod-`decode`-Funktion, die ISO-Strings wieder in `Date`
umwandelt — sonst leere Seite nach Reload.

**Homelab.** `fetchHomelab` holt sieben Quellen parallel, `buildHomelab` ist eine reine Funktion
mit Tests in `server/pve.test.ts`. Alarmregeln und Schwellwerte gehören dorthin, nicht in
`src/widgets/Homelab.tsx`. Fehlt `PVE_TOKEN_SECRET`, kommt `emptyHomelab` mit `configured: false`
zurück — das ist kein Fehler, sondern unabhängig von `homelab.enabled` der Zustand
„nicht konfiguriert".

**Tastatur.** `src/lib/useKeymap.ts` enthält den reinen Reducer plus einen globalen
`keydown`-Listener; er kennt keine Pane-Inhalte, sondern bekommt `rowCount` und `selectedUrl` aus
`App.tsx` (`rowsByPane`). Eine neue Pane anzulegen heißt: Eintrag in `PANE_IDS`
(`src/config/schema.ts`, speist zugleich `PaneId` und das `layout`-Enum), in `PANE_ORDER`, in
`rowsByPane`, in `defaultConfig.layout` und die Pane selbst in `App.tsx`. Eine `config.json`, die
die neue Pane noch nicht kennt, ergänzt der Server beim Lesen aus `defaultConfig`
(`server/config-store.ts`) — das gilt innerhalb jedes Profils. `:profile` öffnet das Settings-Overlay direkt im
Abschnitt `PROFILE`; `:profile <name>` vergleicht Namen exakt und ohne Beachtung der Groß-/Kleinschreibung und
wechselt nur dieses Gerät. `:export` und `:import` beziehen sich auf die Config des aktiven Profils.

**Farben.** `src/index.css` definiert die Tokens dreimal (Dark als Default, `prefers-color-scheme:
light`, plus `data-theme`-Overrides für den manuellen Umschalter); `tailwind.config.js` bildet sie
auf Utility-Namen ab. `tests/contrast.test.ts` hält dieselben Werte ein zweites Mal und rechnet
WCAG AA nach — wer ein Token ändert, ändert beide Stellen und muss den Test grün behalten.

## Was das Werkzeug können muss

Bauen und Testen brauchen **Dateisystem- und Shell-Zugriff** (`pnpm`). Darüber hinaus:

- Echte Homelab-Daten brauchen Netzzugriff auf `https://10.0.10.10:8006` (Proxmox-API)
- `pnpm deploy` braucht `ssh`, `rsync` und `systemctl` gegen `10.0.10.20`

Ein Werkzeug ohne Shell (reine Chat-Oberfläche) kann Bauen, Abfragen und Deployen nicht ausführen.
Es kann den Code schreiben, den Rest muss der Mensch übernehmen. Sag in diesem Fall ausdrücklich,
welche Befehle der Benutzer selbst ausführen soll — führe sie nicht stillschweigend aus der
Beschreibung heraus als erledigt an.

## Harte Regeln

Verstöße sind Fehler, auch wenn der Code läuft.

1. **Keine anderen Abhängigkeiten** als die, die in `package.json` stehen (die Liste aus
   `PLAN.md` Schritt 0). Keine Icon-, Charting-, UI- oder
   Date-Library. `Intl` reicht für Datum und Zeit.
2. **Keine Emoji, keine Icons.** Zustände sind Textzeichen: `●` läuft, `○` gestoppt, `!` Alarm,
   `▁▂▃▄▅▆▇` Sparkline, `━─` Balken.
3. **Farben nur über die CSS-Variablen** aus `PLAN.md` Abschnitt 5. Nie ein Hex-Wert in einer
   Komponente. Keine Tailwind-Opacity-Modifier auf diesen Farben. Die Werte sind gegen WCAG AA
   nachgerechnet — ändere keinen ohne neue Rechnung.
4. **Secrets nur in `.env`,** gelesen ausschließlich über `process.env`. Niemals in `config.json`,
   niemals in einer HTTP-Antwort, niemals in einem Log. `GET /api/profiles` und
   `GET /api/config?profile=<id>` gehen unauthentifiziert an das ganze LAN. Gib den Inhalt von `.env`
   auch nicht im Chat wieder.
5. **`/api/proxy?profile=<id>` bekommt kein Loch.** Private Adressen inklusive `10.x` bleiben gesperrt.
   Proxmox-Daten laufen ausschließlich über den aggregierten Endpunkt `GET /api/homelab?profile=<id>`.
6. **Sprache:** Pane-Titel und Statusline-Kürzel englisch und groß (`CLOCK`, `wx`, `cfg`), alle
   Inhalte und Meldungen für den Benutzer deutsch, Code-Identifier englisch.
7. **Nach jeder Änderung** `pnpm test` **und** `pnpm build`. Beide grün, bevor du fertig meldest.
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

To-Dos, Notizen, Drag-and-Drop-Layout, HTTPS, Zugriff von außerhalb des LAN,
Browser-Extensions, Microsoft Graph oder OAuth, Datenbank, Docker, Login, Pi-hole-Widget,
Speedtest, SMART-Werte, Graphen pro Gast. Die vollständige Liste mit Begründungen steht am Ende
von `PLAN.md`.
