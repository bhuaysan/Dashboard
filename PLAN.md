# Dashboard — Startseite im TUI-Stil, self-hosted im Homelab

> **Diese Datei ist eine Umsetzungsanleitung.** Alle Entscheidungen sind schon getroffen. Arbeite die
> Schritte **in dieser Reihenfolge** ab. Jeder Schritt hat einen Abschnitt „Fertig, wenn" — erst
> weitergehen, wenn alle Punkte erfüllt sind. Code-Blöcke, die als *Vorlage* markiert sind,
> übernimmst du wörtlich; erfinde dort nichts Eigenes.

---

## 1. Auftrag

Eine persönliche Browser-Startseite im Stil eines Terminal-Multiplexers (tmux/ranger): Panes mit
Titelzeile, Statusline unten, Bedienung per Tastatur. Sie zeigt Uhrzeit, Wetter, Termine, News, die
eigenen Links und den Zustand des Proxmox-Homelabs. Sie läuft als Dienst in einem LXC-Container im
Heimnetz und ist von jedem Gerät unter `http://start.home.arpa` erreichbar. Die Konfiguration liegt
auf dem Server, damit alle Geräte denselben Stand sehen.

Das Projektverzeichnis `/Users/ben/Projekte/Dashboard` ist leer. Es gibt noch kein Git-Repo.

---

## 2. Regeln für die Umsetzung

Diese Regeln gelten über den ganzen Plan. Verstöße sind Fehler, auch wenn der Code läuft.

1. **Keine anderen Abhängigkeiten** als die in Schritt 0 aufgelistete Liste. Keine Icon-Library,
   keine Charting-Library, keine UI-Library, keine Date-Library (`Intl` reicht).
2. **Keine Emoji und keine Icons.** Zustände werden mit Textzeichen dargestellt: `●` läuft,
   `○` gestoppt, `!` Alarm, `▁▂▃▄▅▆▇` Sparkline, `█░` Balken.
3. **Farben ausschließlich über die Tokens** aus Abschnitt 5. Niemals ein Hex-Wert direkt in einer
   Komponente. Keine Opacity-Modifier (`bg-bg/50`) auf diesen Farben — sie sind CSS-Variablen und
   Tailwind kann daraus keine Alpha-Werte berechnen.
4. **Secrets niemals in `config.json`,** niemals in einer Antwort eines Endpunkts, niemals in einem
   `console.log`. Sie stehen ausschließlich in `.env` und werden nur über `process.env` gelesen.
   `.env` existiert bereits im Projektverzeichnis und ist über `.gitignore` ausgeschlossen.
5. **Sprache:** Pane-Titel und Statusline-Kürzel englisch und großgeschrieben (`CLOCK`, `WEATHER`,
   `wx`, `cfg`). Alle Inhalte und Meldungen für den Benutzer auf Deutsch. Code-Identifier englisch.
6. **Nach jedem Schritt** `pnpm test` und `pnpm build` ausführen. Beide müssen grün sein, bevor der
   nächste Schritt beginnt.
7. **Bei Unklarheit die einfachste Lösung wählen.** Niemals die Architektur umbauen, keine
   zusätzlichen Abstraktionsschichten einführen, keine Datenbank, kein Framework-Wechsel.
8. **TypeScript ist `strict` inklusive `noUncheckedIndexedAccess`.** Array-Zugriffe brauchen darum
   einen Fallback: `arr[i] ?? default`. Kein `any`, kein `as` zum Wegdrücken von Fehlern.
9. **Jeder Netzwerkzugriff aus dem Browser geht an den eigenen Server** (`/api/...`). Der Browser
   ruft niemals eine fremde Domain direkt auf.

---

## 3. Zielumgebung (geprüfte Fakten)

Diese Werte sind verifiziert. Nicht neu ermitteln, nicht raten.

| Was | Wert |
| --- | --- |
| Proxmox-Host | `10.0.10.10`, API `https://10.0.10.10:8006` |
| Proxmox-Node-Name | `pve` |
| Proxmox-Zertifikat | selbst ausgestellt, `CN=pve.homelab.local`, eigene PVE-CA |
| Fingerprint (zur Kontrolle) | `55:73:80:DC:FC:B0:A0:AA:39:CB:6A:F2:10:CF:51:D8:87:BE:51:95:E8:A5:7A:3A:B2:49:F3:D1:C6:7F:73:22` |
| Pi-hole (DNS für das Netz) | `10.0.10.11`, Version **v6** |
| Geplante IP des Containers | `10.0.10.20` |
| Geplanter Hostname | `start.home.arpa` |
| Vorhandene Dienste | 13 Gäste, darunter `caddy` (Reverse Proxy), `uptime.local`, `monitor.local`, `home.local`, `postgres.local` |
| Entwicklungsrechner | macOS, `10.0.10.164`. Node und SSH-Key fehlen noch. |

Zwei dieser Dienste berühren den Auftrag: Es läuft schon ein **Caddy**-Container, hinter den der
Dashboard-Dienst später für HTTPS gehängt werden könnte — nicht in v1, aber der geplante
HTTPS-Schritt wird dadurch deutlich kleiner. Und **`uptime.local`** ist offenbar ein
Uptime-Monitor, überwacht also bereits Erreichbarkeit. Halte `homelab.reachability` in der
Default-Config deshalb **leer** und überlasse dem Benutzer, ob er dort etwas einträgt; doppelte
Überwachung erzeugt nur doppelte Alarme.
| Browser | Firefox und Safari. **Kein Chrome** — keine Chrome-Extension bauen. |

Warum `start.home.arpa` und nicht `start.homelab.local`: macOS löst `.local` über mDNS auf und fragt
dafür den Pi-hole nicht. `home.arpa` ist per RFC 8375 für private Netze vorgesehen und wird normal
per DNS aufgelöst.

---

## 4. Architektur

```
Browser (Mac, iPhone)
  │  http://start.home.arpa
  ▼
LXC "dashboard" · 10.0.10.20:80 · ein einziger Node-Prozess (Hono)
  ├─ GET  /*             statische Dateien aus dist/
  ├─ GET  /api/config    config.json (enthält keine Secrets)
  ├─ PUT  /api/config    Zod-geprüft, atomar, mit If-Match
  ├─ GET  /api/proxy     Wetter, RSS, ICS — mit Allowlist und SSRF-Sperre
  └─ GET  /api/homelab   Proxmox-Daten, serverseitig aggregiert
  Dateien in /opt/dashboard: dist/  server/  config.json  .env  pve-ca.pem
```

`homelab.enabled` steuert das Proxmox-Monitoring und den Zugriff auf `/api/homelab`.
`layout.homelab.visible` steuert nur die HOMELAB-Pane; bei aktiviertem Monitoring läuft die
Überwachung auch bei ausgeblendeter Pane weiter. Bei deaktiviertem Monitoring gibt es keine
PVE-Requests und keine PVE-Status- oder Alarmanzeige. Fehlt `PVE_TOKEN_SECRET`, bleibt davon
unabhängig `configured: false` („nicht konfiguriert“).

Es gibt genau **einen** Serverprozess. Er liefert die App und alle Daten. Dadurch gibt es im ganzen
Projekt kein CORS-Problem.

**Datenfluss für jedes Widget** — immer dasselbe Muster:

```
Widget-Komponente
  → useCachedQuery("wx", ...)        Hook aus src/api/useCachedQuery.ts
    → liest localStorage-Cache      sofortiges Rendern, auch offline
    → fetch("/api/proxy?url=...")   parallel im Hintergrund
      → Server prüft, holt, cacht
  → Statusline bekommt den Zustand ok | stale | error
```

---

## 5. Design-Tokens

Kommen **wörtlich** so in `src/index.css`. Nichts hinzufügen, nichts umbenennen.

```css
/* Vorlage — wörtlich übernehmen */
:root {
  --color-bg:      #21262E;
  --color-bg-alt:  #191D24;
  --color-bg-sel:  #2B323C;
  --color-border:  #2F3846;
  --color-border-strong: #5E708C;
  --color-fg:      #CBD3DE;
  --color-dim:     #929CA9;
  --color-accent:  #7FA7C4;
  --color-ok:      #8FB58A;
  --color-warn:    #D9B36C;
  --color-crit:    #CC8985;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --color-bg:      #E9EAE4;
    --color-bg-alt:  #DCDDD5;
    --color-bg-sel:  #CFD1C8;
    --color-border:  #C4C6BC;
    --color-border-strong: #848874;
    --color-fg:      #23262B;
    --color-dim:     #535860;
    --color-accent:  #2B5C7E;
    --color-ok:      #396034;
    --color-warn:    #70510D;
    --color-crit:    #96322C;
  }
}
:root[data-theme="light"] { /* dieselben elf Werte wie im light-Block */ }
:root[data-theme="dark"]  { /* dieselben elf Werte wie im :root-Block  */ }
```

**Alle Werte sind gegen WCAG AA nachgerechnet** — jede Textfarbe erreicht mindestens 4.5:1 sowohl auf
`--color-bg` als auch auf `--color-bg-sel`, in beiden Themes. Ändere keinen Wert ohne neue Rechnung.
`--color-border-strong` ist ausschließlich für den Rahmen des Eingabefelds: der begrenzt ein
Formularelement und braucht deshalb 3:1, was das dekorative `--color-border` bewusst nicht erfüllt.

Der manuelle Toggle setzt `data-theme` auf `<html>`. Die `:not([data-theme="dark"])`-Bedingung
sorgt dafür, dass der Toggle die Systemeinstellung überstimmt.

**Bedeutung der Farben, nicht verwechseln:** `--color-accent` heißt immer „Fokus / anklickbar".
`ok` / `warn` / `crit` heißen immer „Zustand eines Dings". Ein Zustand wird **zusätzlich** über ein
Textzeichen dargestellt, niemals nur über Farbe.

**Typografie:** überall JetBrains Mono, importiert per
`import "@fontsource-variable/jetbrains-mono"` in `src/main.tsx`.
Fließtext 14 px / `line-height: 1.6`. Pane-Titel 12 px, `font-weight: 700`, `uppercase`,
`letter-spacing: 0.06em`, Farbe `--color-dim`. Uhr `clamp(3rem, 7vw, 5.5rem)`.
**Überall wo Zahlen in Spalten stehen** (Uhr, Gästetabelle, Temperaturen, Prozente):
`font-variant-numeric: tabular-nums`.

**Animation:** genau eine — der blinkende Cursor im Suchfeld. Sie wird unter
`@media (prefers-reduced-motion: reduce)` abgeschaltet. Keine weiteren Transitions, kein Hover-Fade.

---

## 6. Ziel-Layout

**Es gibt ein fertiges, abgestimmtes Design-Mockup: `mockup/index.html` im Projektverzeichnis.**
Öffne es im Browser und sieh es dir an, bevor du mit Schritt 1 beginnst. Es ist die verbindliche
Referenz für Farben, Abstände, Spaltenbreiten, Zeichen und Interaktion — bei Abweichungen zwischen
Mockup und ASCII-Skizze unten gilt das Mockup. Es enthält bereits die korrekte Pane-Technik, das
Raster, die Statusline, die Tastensteuerung und die Fuzzy-Suche in lesbarem Vanilla-JavaScript; du
darfst dort abschauen, musst die Logik aber nach React und TypeScript übertragen.

Das Mockup ist **kein** Baustein der Anwendung: nichts daraus wird importiert, der Ordner `mockup/`
bleibt unangetastet und wird nicht gebaut oder deployt.

```
 dashboard                                            Mi 05.08.  KW32
┌─ CLOCK ──────────────────────┐┌─ WEATHER ─ Heilbronn ─────────────┐
│      14:32                   ││ 24°  gefühlt 26°   leicht bewölkt │
│      Mittwoch, 5. August     ││ ▁▂▄▅▇▇▆▄▃▂▁▁  24→31→19°           │
│      IBsolution  ·  IST 18:02││ ↑ 05:58  ↓ 21:04   Regen 10 %     │
└──────────────────────────────┘└───────────────────────────────────┘
┌─ LINKS ──────────────────────┐┌─ AGENDA ──────────────────────────┐
│ SAP                          ││ heute                             │
│  gd  Datasphere              ││  09:00 10:00  Daily BDC-Team      │
│  gs  Analytics Cloud         ││  13:30 14:30  Kunde XY Workshop   │
│ INTERN                       ││ morgen                            │
│  gj  Jira                    ││  08:30 09:15  Sprint Planning     │
│  gc  Confluence              │└───────────────────────────────────┘
│ HOMELAB                      │┌─ NEWS ────────────────────────────┐
│  gp  Proxmox                 ││ 14:02  heise    Neue HANA-Version │
│  gh  Pi-hole                 ││ 13:47  tages…   Meldung des Tages │
└──────────────────────────────┘└───────────────────────────────────┘
┌─ HOMELAB ─ pve ──────────────────────────────────────────────────┐
│ cpu  12% ▁▂▄▃▂▁▂▃▂   mem  41% ▄▄▅▄▄▄▅▄▄   root 23%    up 34d    │
│ local-lvm ████████░░░░░ 58%      backups ██████░░░░░░░ 41%       │
│ ● 100 pi.hole    run   2%  38%    ● 102 gitea      run   1%  22% │
│ ● 105 dashboard  run   0%  14%    ○ 103 testvm    stop    –   –  │
│ ! backup dashboard fehlgeschlagen vor 2d                         │
│ ! pve  7 updates verfügbar                                       │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│ ▸ search or type a command                                       │
└──────────────────────────────────────────────────────────────────┘
 [dashboard] NORMAL  1 clock 2 weather 3 links 4 agenda 5 news 6 lab
                       wx ● news ● cal ● pve ● cfg ●   ? keys  14:32
```

**Wichtig zur Umsetzung der Rahmen:** Baue die Rahmen **nicht** aus `─`- und `│`-Zeichen. Das bricht,
sobald sich die Breite ändert. Verwende diese Technik:

```css
/* Vorlage — wörtlich übernehmen */
.pane {
  position: relative;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  padding: 1.25rem 0.75rem 0.75rem;
}
.pane-title {
  position: absolute;
  top: 0;
  left: 0.75rem;
  transform: translateY(-50%);
  background: var(--color-bg);
  padding: 0 0.5rem;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-dim);
  white-space: nowrap;
}
.pane:focus-within { border-color: var(--color-accent); }
.pane:focus-within > .pane-title { color: var(--color-accent); }
```

Der Titel überdeckt die obere Kante mit der Hintergrundfarbe — dadurch entsteht die Kerbe optisch
exakt, bleibt aber bei jeder Breite korrekt.

**Raster:** CSS Grid mit `gap: 10px`. Der Seitenhintergrund ist `--color-bg-alt` und damit dunkler
als der Pane-Grund `--color-bg` — die Panes liegen also als Module auf einer dunkleren Fläche.
Drei Spalten ab 1240 px, zwei ab 820 px, eine darunter. Die HOMELAB-Pane und die Suchzeile gehen
immer über die volle Breite (`grid-column: 1 / -1`), WEATHER über zwei Spalten, LINKS über zwei
Zeilen.

Verwende **nicht** `gap: 1px`: weil jede Pane schon einen eigenen 1-px-Rahmen hat, ergäbe das eine
3 px dicke Doppellinie zwischen benachbarten Panes. Das ist beim Mockup aufgefallen.

---

## 7. Tastaturbedienung

| Taste | Wirkung |
| --- | --- |
| Buchstabe oder Ziffer tippen, oder `/` | Fokus ins Suchfeld, Modus `INSERT` |
| `1`–`7` | Pane fokussieren (1 clock, 2 weather, 3 month, 4 links, 5 news, 6 agenda, 7 lab) |
| `j` / `k` | eine Zeile ab / auf im fokussierten Pane |
| `Enter` | ausgewählte Zeile öffnen |
| `Shift+Enter` | in neuem Tab öffnen |
| `g` dann 1–2 Zeichen | Link direkt per Kürzel öffnen (`gd` → Datasphere) |
| `:` | Modus `COMMAND`: `:settings` `:export` `:import` `:reload` `:theme` |
| `?` | Overlay mit dieser Tabelle |
| `Esc` | zurück in Modus `NORMAL` |

Es gibt genau drei Modi: `NORMAL`, `INSERT`, `COMMAND`. Der aktuelle Modus steht links in der
Statusline. Tastendrücke werden **nur** im Modus `NORMAL` als Kommandos gedeutet — sonst tippt man
in einem Textfeld und alles geht dorthin.

Die Suchzeile arbeitet in dieser Reihenfolge:
1. Beginnt die Eingabe mit einem Bang (`!g`, `!ddg`, `!gh`, `!npm`, `!mdn` oder eigenem aus der
   Config) → Websuche mit dieser Suchmaschine.
2. Sonst: Fuzzy-Suche über alle eigenen Links. Treffer werden unter der Zeile gelistet, `Enter`
   öffnet den ersten.
3. Kein Treffer → Websuche mit der Standard-Suchmaschine.
4. Leere Eingabe → nichts tun.

---

## Schritt 0 · Werkzeuge und Projektgerüst

**Ziel:** Ein leeres, lauffähiges Vite-React-Projekt mit allen Abhängigkeiten und einem Git-Repo.

Node fehlt auf diesem Mac komplett. Zuerst:

```bash
brew install node && corepack enable
```

Dann im Projektverzeichnis:

```bash
cd /Users/ben/Projekte/Dashboard
pnpm create vite . --template react-ts
pnpm add react react-dom @tanstack/react-query zod@^3 ical.js hono @hono/node-server undici tsx @fontsource-variable/jetbrains-mono
pnpm add -D typescript vite @vitejs/plugin-react tailwindcss@^3 postcss autoprefixer vitest jsdom @testing-library/react @testing-library/jest-dom @types/node
npx tailwindcss init -p
git init && git add -A && git commit -m "Gerüst"
```

Zwei Versionen sind absichtlich festgenagelt, weiche davon nicht ab:
**`zod@^3`** und **`tailwindcss@^3`**. Die jeweils neueren Majors haben eine andere API
(`z.iso.datetime()` statt `z.string().datetime()`, CSS-`@theme` statt `tailwind.config.js`); v3 ist
in beiden Fällen die Variante mit der stabileren, verbreiteteren Schreibweise.

Einen SSH-Key gibt es auf diesem Mac noch nicht, er wird in Schritt 7 gebraucht:

```bash
ssh-keygen -t ed25519 -C "dashboard-deploy" -f ~/.ssh/id_ed25519 -N ""
```

`tsconfig.json` — diese Optionen müssen gesetzt sein:
`"strict": true`, `"noUncheckedIndexedAccess": true`, `"noEmit": true`, `"types": ["vitest/globals"]`.

`tailwind.config.js` — *Vorlage:*

```js
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)", "bg-alt": "var(--color-bg-alt)", "bg-sel": "var(--color-bg-sel)",
        border: "var(--color-border)", "border-strong": "var(--color-border-strong)",
        fg: "var(--color-fg)", dim: "var(--color-dim)",
        accent: "var(--color-accent)", ok: "var(--color-ok)",
        warn: "var(--color-warn)", crit: "var(--color-crit)",
      },
      fontFamily: { mono: ["JetBrains Mono Variable", "ui-monospace", "monospace"] },
    },
  },
};
```

`.gitignore`, `.env` und `.env.example` **liegen bereits im Projektverzeichnis** und sind fertig
ausgefüllt — nicht überschreiben, nicht löschen, nicht neu anlegen. `.env` enthält das
Proxmox-Token-Secret. `.gitignore` schließt `.env`, `config.json` und `pve-ca.pem` aus.

`package.json` — Skripte:

```json
"scripts": {
  "dev": "vite",
  "dev:server": "tsx watch server/index.ts",
  "build": "tsc -b && vite build",
  "test": "vitest run",
  "serve": "tsx server/index.ts",
  "deploy": "./deploy/deploy.sh"
}
```

`vite.config.ts` braucht einen Proxy, damit `/api` in der Entwicklung an den lokalen Server geht:

```ts
server: { proxy: { "/api": "http://localhost:7777" } }
```

**Fertig, wenn:**
- `pnpm dev` startet und zeigt die Vite-Startseite
- `pnpm build` läuft ohne Fehler durch
- `pnpm test` läuft (noch ohne Tests) ohne Fehler durch
- `git status` zeigt keine der ignorierten Dateien
- `node --version` gibt eine 22 oder höher aus

**Nicht tun:**
- Keine anderen Pakete installieren. Kein ESLint- oder Prettier-Setup — nicht Teil des Auftrags.
- **`pnpm create vite .` fragt, weil das Verzeichnis nicht leer ist.** Wähle
  „Ignore files and continue". Auf keinen Fall „Remove existing files and continue" — das würde
  `.env` mit dem Proxmox-Secret löschen. Prüfe danach mit `ls -a`, dass `.env`, `.env.example` und
  `.gitignore` noch da sind, und dass `git status` `.env` **nicht** als zu committende Datei zeigt.

---

## Schritt 1 · Design-System und Panes

**Ziel:** Das Layout aus Abschnitt 6 steht sichtbar auf dem Bildschirm, gefüllt mit fest
eingetippten Beispieltexten. Noch keine Daten, keine Logik.

**Dateien:** `src/index.css`, `src/shell/Pane.tsx`, `src/shell/PaneGrid.tsx`,
`src/shell/StatusLine.tsx`, `src/App.tsx`.

1. `src/index.css`: die Token-Blöcke aus Abschnitt 5 wörtlich, dann die `.pane`-Regeln aus
   Abschnitt 6 wörtlich, dann `@tailwind base; @tailwind components; @tailwind utilities;`
   **darüber**. Body bekommt `background: var(--color-bg-alt)`, `color: var(--color-fg)`,
   `font-family: theme(fontFamily.mono)`, `font-size: 14px`, `line-height: 1.6`.
2. `Pane.tsx`: Props `{ title: string; subtitle?: string; span?: 1 | 2 | "full"; children }`.
   Rendert `<section class="pane">` mit `<h2 class="pane-title">`. Steht ein `subtitle` an, wird er
   im Titel angehängt: `HOMELAB ─ pve`. Die Section bekommt `tabIndex={-1}`, damit sie
   programmatisch fokussierbar ist.
3. `PaneGrid.tsx`: das Grid aus Abschnitt 6.
4. `StatusLine.tsx`: drei Bereiche via Flexbox — links `[dashboard] NORMAL`, mittig die
   Pane-Ziffern, rechts die Statuspunkte und die Uhrzeit. Nimmt alles als Props, hat keine eigene
   Logik.
5. `App.tsx`: setzt alle sieben Panes mit Beispielinhalt zusammen, exakt in der Anordnung aus
   Abschnitt 6.

**Fertig, wenn:**
- Das Bild im Browser entspricht Abschnitt 6, mit Beispieltexten
- Fenster auf 1280 px, 900 px und 500 px Breite ziehen: 3, dann 2, dann 1 Spalte, ohne
  waagerechtes Scrollen der Seite
- In den Browser-Einstellungen zwischen hellem und dunklem Systemdesign wechseln: die Seite wechselt
  mit, in beiden Varianten ist jeder Text lesbar
- `document.documentElement.dataset.theme = "light"` in der Konsole erzwingt Hell, `"dark"` erzwingt
  Dunkel

**Nicht tun:** Keine Rahmen aus `─`-Zeichen. Keine Schatten, keine abgerundeten Ecken, keine
Gradienten — das Design ist flach und kantig.

---

## Schritt 2 · Config-Schema und lokaler Zustand

**Ziel:** Alle Inhalte kommen aus einem typisierten Config-Objekt im localStorage. Export und Import
funktionieren.

**Dateien:** `src/config/schema.ts`, `src/config/defaults.ts`, `src/config/local.ts`,
`src/config/io.ts`.

`schema.ts` — *Vorlage, so übernehmen:*

```ts
import { z } from "zod";

export const configSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),                       // ISO-8601, wird vom Server gesetzt
  theme: z.enum(["dark", "light", "system"]).default("system"),
  clock: z.object({
    secondary: z.array(z.object({ label: z.string(), tz: z.string() })).default([]),
  }),
  location: z.object({ label: z.string(), lat: z.number(), lon: z.number() }),
  linkGroups: z.array(z.object({
    title: z.string(),
    links: z.array(z.object({
      label: z.string(),
      url: z.string().url(),
      hint: z.string().max(2).optional(),
    })),
  })),
  feeds: z.array(z.object({
    label: z.string(), url: z.string().url(), limit: z.number().int().min(1).default(5),
  })),
  calendars: z.array(z.object({ label: z.string(), url: z.string() })),
  search: z.object({
    default: z.string(),                       // "https://duckduckgo.com/?q=%s"
    bangs: z.record(z.string()),               // { "g": "https://www.google.com/search?q=%s" }
  }),
  layout: z.array(z.object({
    id: z.enum(["clock", "weather", "links", "agenda", "news", "homelab"]),
    visible: z.boolean(),
    span: z.union([z.literal(1), z.literal(2)]),
  })),
  proxyAllowlist: z.array(z.string()),         // Hostnamen, z.B. "api.open-meteo.com"
  homelab: z.object({
    enabled: z.boolean().default(true),       // Monitoring und /api/homelab
    node: z.string().default("pve"),
    expectRunning: z.array(z.number().int()).default([]),   // VMIDs, die laufen sollen
    thresholds: z.object({
      cpu: z.number().default(90), mem: z.number().default(85),
      storage: z.number().default(80), backupAgeHours: z.number().default(36),
    }),
    reachability: z.array(z.object({
      label: z.string(), host: z.string(), port: z.number().int(),
    })).default([]),
  }),
});

export type Config = z.infer<typeof configSchema>;
```

`homelab.enabled` steuert das Monitoring und `/api/homelab`; `layout.homelab.visible` steuert
nur die Pane. Bei deaktiviertem Monitoring gibt es keine PVE-Requests, Status- oder
Alarmanzeige. Fehlt `PVE_TOKEN_SECRET`, bleibt unabhängig davon `configured: false`
(„nicht konfiguriert“). Die neue `defaultConfig` setzt `homelab.enabled` auf `false`; das
Schema behandelt das fehlende Feld einer älteren Config als `true`.

Beachte: **`expectRunning` ist eine Liste von VMIDs in der Config**, keine Abfrage des
Proxmox-`onboot`-Flags. Das erspart einen zusätzlichen API-Aufruf pro Gast, und „soll laufen" ist
ohnehin eine menschliche Festlegung.

`defaults.ts`: ein vollständiges, gültiges `Config`-Objekt mit den Inhalten aus dem Wireframe
(Links-Gruppen SAP / INTERN / HOMELAB, Ort Heilbronn `lat: 49.1427, lon: 9.2109`, zwei Feeds,
`proxyAllowlist: ["api.open-meteo.com", "geocoding-api.open-meteo.com"]` plus die Feed-Hosts).
`configSchema.parse(defaultConfig)` muss ohne Fehler durchlaufen — das ist ein Test.

`local.ts` — *Vorlage:*

```ts
const KEY = "dashboard:config";

export function readLocalConfig(): Config | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = configSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

export function writeLocalConfig(cfg: Config): void {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* Speicher voll: ignorieren */ }
}
```

Kaputter Inhalt führt **nie** zu einer Exception — es wird still auf die Defaults zurückgefallen.

`io.ts`: `exportConfig(cfg)` erzeugt einen Download (`Blob` + `URL.createObjectURL` + `<a download>`),
`importConfig(file)` liest die Datei, prüft mit `configSchema.safeParse` und gibt bei Fehler eine
deutsche Meldung mit dem ersten `issue.path` zurück.

Zustand in der App: **kein zustand, kein Redux.** Config kommt später aus React Query (Schritt 4);
bis dahin ein `useState` in `App.tsx`, initialisiert mit `readLocalConfig() ?? defaultConfig`.
UI-Zustand (Modus, fokussierte Pane, ausgewählte Zeile) kommt in Schritt 3 in einen `useReducer`.

**Fertig, wenn:**
- Alle Panes zeigen Inhalte aus der Config, nichts ist mehr fest eingetippt
- Ein Link in `defaults.ts` geändert und neu geladen → Änderung sichtbar
- Tests grün: `configSchema.parse(defaultConfig)` läuft durch; ein Objekt ohne `location` wird
  abgewiesen; `readLocalConfig()` liefert bei kaputtem JSON `undefined` und wirft nicht

---

## Schritt 3 · Tastatursteuerung und Suchzeile

**Ziel:** Die Seite ist ohne Maus vollständig bedienbar. Noch ohne jeden Netzzugriff.

**Dateien:** `src/lib/useKeymap.ts`, `src/lib/fuzzy.ts`, `src/lib/bangs.ts`,
`src/shell/CommandBar.tsx`, `src/shell/KeymapOverlay.tsx`.

UI-Zustand als `useReducer` in `App.tsx`:

```ts
type UiState = {
  mode: "NORMAL" | "INSERT" | "COMMAND";
  pane: "clock" | "weather" | "links" | "agenda" | "news" | "homelab";
  row: number;          // ausgewählte Zeile im fokussierten Pane
  hintBuffer: string;   // gesammelte Zeichen nach "g"
  showHelp: boolean;
};
```

`useKeymap.ts`: ein einziger `keydown`-Listener auf `window`. Ganz am Anfang abbrechen, wenn der
Modus nicht `NORMAL` ist oder das Event aus einem `<input>` kommt:

```ts
// Vorlage
const t = e.target as HTMLElement | null;
if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
if (state.mode !== "NORMAL") return;
```

`bangs.ts` — *Vorlage:*

```ts
export function resolveQuery(input: string, search: Config["search"]): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  const m = /^!(\S+)\s+([\s\S]+)$/.exec(trimmed);
  if (m) {
    const key = m[1] ?? "";
    const rest = m[2] ?? "";
    const tpl = search.bangs[key];
    if (tpl) return tpl.replace("%s", encodeURIComponent(rest));
  }
  return search.default.replace("%s", encodeURIComponent(trimmed));
}
```

Beachte: der Bang zählt nur **am Anfang** und nur mit folgendem Text. `foo !g` ist eine normale
Websuche nach `foo !g`. Ein unbekannter Bang fällt auf die Standard-Suchmaschine zurück.

`fuzzy.ts`: Zeichen-für-Zeichen-Subsequenz-Suche über `label` (ohne Groß-/Kleinschreibung).
Bewertung: Treffer am Wortanfang zählen mehr, dichter beieinander liegende Treffer zählen mehr.
Rückgabe absteigend sortiert, maximal 8 Ergebnisse. Kein Fremdpaket.

`CommandBar.tsx`: ein `<input>`, das bei `mode === "INSERT"` den Fokus bekommt. Beginnt die Eingabe
mit `:`, ist es ein Kommando (`settings`, `export`, `import`, `reload`, `theme`) — unbekannte
Kommandos erzeugen eine deutsche Meldung in der Statusline. Sonst zeigt sie die Fuzzy-Treffer und
`Enter` öffnet den ersten; ohne Treffer greift `resolveQuery`.

Link-Hints: nach `g` sammelt `hintBuffer` bis zu zwei Zeichen und vergleicht mit dem `hint`-Feld
aller Links. Bei Übereinstimmung öffnen und Buffer leeren. `Esc` leert den Buffer.

**Fertig, wenn** (alles ohne Maus):
- `3` fokussiert LINKS, der Rahmen wechselt auf die Akzentfarbe
- `j` / `k` bewegen die Auswahl, die ausgewählte Zeile hat `--color-bg-sel` als Hintergrund
- `Enter` öffnet den Link, `Shift+Enter` in einem neuen Tab
- `gd` öffnet Datasphere aus jedem Pane heraus
- `/` springt ins Suchfeld; `!gh vite` öffnet die GitHub-Suche; `dat` zeigt Datasphere als Treffer
- `?` zeigt das Overlay, `Esc` schließt es
- Im Suchfeld tippen löst **keine** Pane-Wechsel aus
- Tests grün: `resolveQuery` für `!g foo`, `foo !g`, `!xx foo`, `""`; `fuzzy` für Reihenfolge und
  Obergrenze

---

## Schritt 4 · Server: Config und Proxy

**Ziel:** Der Node-Server läuft lokal auf Port 7777, liefert die Config und holt fremde URLs.

**Dateien:** `server/index.ts`, `server/env.ts`, `server/config-store.ts`, `server/proxy.ts`,
`server/write-guard.ts`, `src/api/useCachedQuery.ts`, `src/api/config.ts`.

Alle Pfade, der Port und die Zugangsdaten kommen aus Umgebungsvariablen. Die bereits vorhandene
`.env` wird ohne Zusatzpaket geladen — als **allererste Zeile** von `server/index.ts`, vor allen
anderen Imports, die `process.env` lesen:

```ts
// Vorlage — muss vor allen anderen Importen stehen, die process.env lesen
import { loadEnvFile } from "node:process";
try { loadEnvFile(); } catch { /* keine .env: echte Umgebungsvariablen nutzen (Produktion) */ }
```

`server/env.ts` liest `process.env` **einmal** aus, prüft und exportiert ein typisiertes Objekt:

```ts
// Vorlage
export const env = {
  port: Number(process.env.PORT ?? 7777),
  configPath: process.env.DASHBOARD_CONFIG ?? "./config.json",
  writeAllow: (process.env.DASHBOARD_WRITE_ALLOW ?? "127.0.0.1").split(",").map((s) => s.trim()),
  pve: process.env.PVE_TOKEN_SECRET
    ? {
        url: process.env.PVE_URL ?? "",
        tokenId: process.env.PVE_TOKEN_ID ?? "",
        secret: process.env.PVE_TOKEN_SECRET,
        caPath: process.env.PVE_CA_PATH ?? "./pve-ca.pem",
      }
    : undefined,     // undefined = Homelab nicht konfiguriert, das ist kein Fehler
};
```

Ist `PVE_TOKEN_SECRET` leer, bleibt `env.pve` `undefined` und die Homelab-Pane meldet später ruhig
„nicht konfiguriert" — kein Absturz, keine Fehlermeldung. Werte aus `env.pve` dürfen **nie** in einer
HTTP-Antwort oder einem Log auftauchen. `dist/` wird relativ zum Servermodul aufgelöst, nicht
absolut; das ist die Vorbereitung für die späte Docker-Variante und kostet jetzt nichts.

`config-store.ts` — *Vorlage für das atomare Schreiben:*

```ts
import { writeFile, rename, readFile, copyFile } from "node:fs/promises";

async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, path);        // rename ist atomar, halbe Dateien unmöglich
}

export async function readConfig(): Promise<Config> {
  try {
    const parsed = configSchema.safeParse(JSON.parse(await readFile(configPath, "utf8")));
    if (parsed.success) return parsed.data;
    await copyFile(configPath, `${configPath}.bak`);   // kaputte Datei aufbewahren
  } catch { /* Datei fehlt: Defaults */ }
  return defaultConfig;
}
```

`server/index.ts` — die vier Routen. *Vorlage für `PUT`:*

```ts
app.put("/api/config", async (c) => {
  const current = await readConfig();
  if (c.req.header("If-Match") !== current.updatedAt) {
    return c.json({ error: "conflict", current: current.updatedAt }, 409);
  }
  const body = await c.req.json();
  const parsed = configSchema.safeParse({ ...body, updatedAt: new Date().toISOString() });
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  await writeAtomic(configPath, JSON.stringify(parsed.data, null, 2));
  return c.json(parsed.data);
});
```

`write-guard.ts`: Middleware, die bei `PUT` und `DELETE` die Client-IP gegen `env.writeAllow` prüft
und sonst `403` liefert. `GET` bleibt für alle offen.

`proxy.ts` — *Vorlage für die SSRF-Sperre:*

```ts
import { lookup } from "node:dns/promises";

function isBlockedIp(ip: string): boolean {
  if (ip.includes(":")) return true;              // IPv6: pauschal ablehnen, nicht gebraucht
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return true;
  const a = parts[0] ?? 0, b = parts[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true;          // auch das ganze Homelab
  if (a === 169 && b === 254) return true;                    // Cloud-Metadaten
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT
  return false;
}

export async function assertAllowed(url: URL, allowlist: string[]): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Schema");
  if (!allowlist.includes(url.hostname)) throw new Error("Host nicht erlaubt");
  const { address } = await lookup(url.hostname);
  if (isBlockedIp(address)) throw new Error("Private Adresse");
}
```

Weiter für `/api/proxy`: `redirect: "manual"`, maximal 3 Weiterleitungen und **jedes** Ziel erneut
durch `assertAllowed`; `AbortSignal.timeout(5000)`; Antwort bei 2 MB abbrechen; In-Memory-`Map` als
Cache mit TTL nach URL (Wetter 600 s, News und Kalender 900 s).

Die effektive Allowlist besteht aus `config.proxyAllowlist` plus den Hosts der eingetragenen
Feed- und Kalender-URLs. Diese Quellhosts werden nur zur Laufzeit abgeleitet und nicht zusätzlich
in `config.json` persistiert; dadurch bleibt die manuelle Array-Grenze auch bei vielen Quellen
eingehalten. Cache und Single-Flight müssen die effektive Policy in ihren Schlüssel aufnehmen,
damit entfernte Redirect-Ziele nicht aus einem älteren Cache weiter ausgeliefert werden.

Weil `10.x` in `isBlockedIp` gesperrt ist, kann `/api/proxy` das Homelab nicht erreichen — das ist
so gewollt. Die Proxmox-Daten laufen über den eigenen Endpunkt in Schritt 6.

`src/api/useCachedQuery.ts` — *Vorlage, das Muster für alle Widgets:*

```ts
export function useCachedQuery<T>(key: string, fn: () => Promise<T>, ttlMs: number) {
  return useQuery<T>({
    queryKey: [key],
    queryFn: async () => {
      const data = await fn();
      try { localStorage.setItem(`dashboard:cache:${key}`,
              JSON.stringify({ t: Date.now(), data })); } catch {}
      return data;
    },
    initialData: () => {
      try {
        const raw = localStorage.getItem(`dashboard:cache:${key}`);
        return raw ? (JSON.parse(raw).data as T) : undefined;
      } catch { return undefined; }
    },
    staleTime: ttlMs,
    retry: 1,
  });
}
```

Das ist der Grund, warum die Startseite auch offline sofort Inhalte zeigt: `initialData` liest
synchron aus localStorage, der `fetch` läuft danach im Hintergrund.

Config im Client: `GET /api/config` per `useQuery` mit `initialData: readLocalConfig()`. Nach jedem
Erfolg `writeLocalConfig`. Speichern per `useMutation` mit `If-Match: config.updatedAt`. Bei `409`
eine deutsche Meldung anzeigen: *„Ein anderes Gerät hat zuerst gespeichert. Seite neu laden."*
Der Server gewinnt immer. Ist er nicht erreichbar, läuft alles mit der letzten bekannten Config
weiter und Speichern ist gesperrt.

**Fertig, wenn:**
- `pnpm dev:server` und `pnpm dev` laufen parallel; die Seite lädt die Config vom Server
- `curl localhost:7777/api/config` liefert JSON
- Änderung speichern → `config.json` auf der Platte enthält sie, `updatedAt` ist neu
- Zweimal mit demselben alten `If-Match` speichern → beim zweiten Mal `409`
- `curl "localhost:7777/api/proxy?url=https://api.open-meteo.com/v1/forecast?latitude=49&longitude=9&current=temperature_2m"`
  liefert Wetterdaten
- `curl "localhost:7777/api/proxy?url=http://10.0.10.10:8006/"` → `403`
- `curl "localhost:7777/api/proxy?url=http://169.254.169.254/"` → `403`
- Tests grün: `assertAllowed` für fremden Host, private IP, Metadaten-IP, falsches Schema;
  atomares Schreiben; `409` bei falschem `If-Match`; kaputte `config.json` landet in `.bak`

---

## Schritt 5 · Wetter, Agenda, News

**Ziel:** Die drei Datenwidgets zeigen echte Daten und funktionieren offline mit den letzten Werten.

**Dateien:** `src/lib/sparkline.ts`, `src/lib/weatherCodes.ts`, `src/lib/rss.ts`,
`src/lib/ics.ts`, `src/lib/relativeTime.ts`, `src/widgets/Weather.tsx`,
`src/widgets/Agenda.tsx`, `src/widgets/News.tsx`.

`sparkline.ts` — *Vorlage:*

```ts
const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇"] as const;

export function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return BLOCKS[3].repeat(values.length);
  return values.map((v) => {
    const i = Math.round(((v - min) / (max - min)) * (BLOCKS.length - 1));
    return BLOCKS[i] ?? BLOCKS[0];
  }).join("");
}

export function bar(pct: number, width = 13): string {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}
```

Jede Sparkline und jeder Balken braucht ein `aria-label` mit den echten Zahlen, zum Beispiel
`aria-label="Temperatur der nächsten 12 Stunden: 24, 25, 27, … Grad"`. Sonst ist die Grafik für
Screenreader bedeutungslos.

**Wetter-URL** (über `/api/proxy` aufrufen, `url` muss URL-kodiert sein):

```
https://api.open-meteo.com/v1/forecast
  ?latitude=49.1427&longitude=9.2109
  &current=temperature_2m,apparent_temperature,weather_code
  &hourly=temperature_2m,precipitation_probability
  &daily=temperature_2m_min,temperature_2m_max,weather_code,sunrise,sunset
  &timezone=Europe%2FBerlin&forecast_days=5
```

Die Sparkline nimmt die **nächsten 12 Werte** aus `hourly.temperature_2m` ab der aktuellen Stunde —
nicht die ersten 12 des Tages. Open-Meteo braucht keinen API-Key.
Für die Ortssuche in den Einstellungen:
`https://geocoding-api.open-meteo.com/v1/search?name=<ort>&count=1&language=de`.

`weatherCodes.ts`: Map von WMO-Code auf deutschen Text. Diese Codes abdecken:
`0` klar · `1` überwiegend klar · `2` leicht bewölkt · `3` bedeckt · `45` Nebel · `48` Reifnebel ·
`51`/`53`/`55` Sprühregen leicht/mäßig/stark · `56`/`57` gefrierender Sprühregen ·
`61`/`63`/`65` Regen leicht/mäßig/stark · `66`/`67` gefrierender Regen ·
`71`/`73`/`75` Schneefall leicht/mäßig/stark · `77` Schneegriesel ·
`80`/`81`/`82` Regenschauer leicht/mäßig/heftig · `85`/`86` Schneeschauer ·
`95` Gewitter · `96`/`99` Gewitter mit Hagel. Unbekannter Code → `"—"`.

`rss.ts`: parsen mit `new DOMParser().parseFromString(xml, "application/xml")`. Beide Formate
bedienen, Feldnamen exakt so:

| | RSS 2.0 | Atom |
| --- | --- | --- |
| Einträge | `channel > item` | `entry` |
| Titel | `title` (Textinhalt) | `title` (Textinhalt) |
| Link | `link` (Textinhalt) | `link` → Attribut `href` |
| Datum | `pubDate` | `updated`, sonst `published` |

Rückgabe für beide: `{ title, url, date: Date, source: string }[]`. Alle Feeds zusammenführen, nach
Datum absteigend, pro Feed höchstens `feed.limit`.

`ics.ts` mit `ical.js` — *Vorlage für die Ausweitung von Serienterminen:*

```ts
import ICAL from "ical.js";

export function parseIcs(text: string, from: Date, to: Date): CalEvent[] {
  const comp = new ICAL.Component(ICAL.parse(text));
  const out: CalEvent[] = [];
  for (const vevent of comp.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(vevent);
    if (event.isRecurring()) {
      const it = event.iterator();
      for (let next = it.next(); next; next = it.next()) {
        const start = next.toJSDate();
        if (start > to) break;
        if (start >= from) {
          const d = event.getOccurrenceDetails(next);
          out.push(toCalEvent(event, d.startDate.toJSDate(), d.endDate.toJSDate()));
        }
      }
    } else {
      const start = event.startDate.toJSDate();
      if (start >= from && start <= to) {
        out.push(toCalEvent(event, start, event.endDate.toJSDate()));
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
```

Bei Serienterminen **immer** die Schleife mit `if (start > to) break;` begrenzen — eine unbegrenzte
Wiederholungsregel läuft sonst endlos. Ganztagstermine (`event.startDate.isDate === true`) werden
separat oben in der Gruppe gelistet, ohne Uhrzeit. Die Agenda zeigt heute plus die nächsten drei
Tage, gruppiert nach `heute` / `morgen` / Wochentag; der laufende Termin bekommt
`--color-bg-sel` als Hintergrund.

`DTEND` ist exklusiv: Ein Termin überschneidet ein Fenster am Anfang nur bei `end > from`.
Null-Dauer-Termine werden als Zeitpunkt separat behandelt.

**Hinweis zum Kalender:** Ob sich der Outlook-Kalender bei IBsolution als ICS veröffentlichen lässt,
entscheidet eine Exchange-Richtlinie der IT und kann gesperrt sein. Falls es nicht geht: eine
`.ics`-Datei in `/var/lib/dashboard/static/` legen und als `calendars[].url` einen Pfad auf dem eigenen
Server eintragen. Dann greift der Proxy nicht und alles andere bleibt gleich. Microsoft Graph mit
OAuth ist **nicht** Teil dieses Auftrags.

TTL-Werte für `useCachedQuery`: Wetter `600_000`, News `900_000`, Kalender `900_000`.
Statusline-Punkte an die Query-Zustände hängen: `isError` → `crit`, `isStale` → `warn`, sonst `ok`.

**Fertig, wenn:**
- Alle drei Panes zeigen echte Daten
- WLAN abschalten und neu laden: die letzten Werte erscheinen **sofort**, kein Pane ist leer, keine
  Fehlermeldung im Pane-Inhalt, die Statuspunkte stehen auf `warn` oder `crit`
- Tests grün: `sparkline` für gleiche Werte, einen Wert, leeres Array, negative Werte; `bar` für
  0 / 50 / 100; `rss` liefert für ein RSS-2.0- und ein Atom-Beispiel dieselbe Struktur; `ics` für
  Ganztagstermin, wöchentliche Serie, Termin über Mitternacht; `weatherCodes` für einen bekannten
  und einen unbekannten Code

---

## Schritt 6 · Homelab-Pane

**Ziel:** Eine Pane mit dem Zustand des Proxmox-Hosts. Dauerinhalt oben, Alarmzeilen nur dann, wenn
etwas nicht in Ordnung ist.

**Dateien:** `server/pve.ts`, `server/reachability.ts`, `src/widgets/Homelab.tsx`.

Zuerst per Hand in der Proxmox-Weboberfläche einrichten (`https://10.0.10.10:8006`):

1. *Datacenter → Permissions → Users*: Benutzer `dashboard@pve` anlegen
2. *Datacenter → Permissions → API Tokens*: Token `startpage` für diesen Benutzer,
   **Privilege Separation aktiviert**. Das Secret wird nur einmal angezeigt — sofort notieren.
3. *Datacenter → Permissions*: Rolle **`PVEAuditor`** auf Pfad `/` für `dashboard@pve` **und** für
   das Token. `PVEAuditor` darf nur lesen — ein geleakter Token kann nichts verändern.
4. Die CA-Datei vom Host holen, sie wird für die TLS-Prüfung gebraucht:
   `scp root@10.0.10.10:/etc/pve/pve-root-ca.pem ./pve-ca.pem`
5. Das Token-Secret in die **bereits vorhandene** `.env` eintragen, Zeile `PVE_TOKEN_SECRET=`.
   `PVE_URL`, `PVE_TOKEN_ID` und `PVE_CA_PATH` stehen dort schon richtig. Keine neue Datei anlegen.
   Ist die Zeile leer, liefert der Server unabhängig von `homelab.enabled` den gültigen Zustand
   `configured: false` („nicht konfiguriert“), keinen Fehler.

`server/pve.ts` — *Vorlage für den TLS-Teil:*

```ts
import { Agent } from "undici";
import { readFileSync } from "node:fs";

// Das Proxmox-Zertifikat ist selbst ausgestellt. Wir prüfen es korrekt gegen die eigene CA,
// statt die Prüfung abzuschalten. servername ist nötig, weil wir per IP verbinden,
// das Zertifikat aber auf pve.homelab.local lautet.
const agent = new Agent({
  connect: { ca: readFileSync(env.pve.caPath), servername: "pve.homelab.local" },
});

async function pveGet<T>(path: string): Promise<T> {
  const res = await fetch(`${env.pve.url}/api2/json${path}`, {
    headers: { Authorization: `PVEAPIToken=${env.pve.tokenId}=${env.pve.secret}` },
    dispatcher: agent,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`PVE ${path}: HTTP ${res.status}`);
  return (await res.json() as { data: T }).data;
}
```

Setze **nicht** `rejectUnauthorized: false`. Mit dieser Option würde `checkServerIdentity` von Node
gar nicht mehr aufgerufen, eine Fingerprint-Prüfung wäre also wirkungslos. Der Weg über `ca` und
`servername` prüft echt. Der Fingerprint aus Abschnitt 3 dient nur der einmaligen Kontrolle, dass du
die richtige CA-Datei kopiert hast:
`openssl x509 -in pve-ca.pem -noout -fingerprint -sha256`.

**Die fünf Aufrufe** — alle mit `Promise.all` parallel, Antwort steckt immer in `data`:

| Zweck | Pfad | Benutzte Felder |
| --- | --- | --- |
| Node-Zustand | `/nodes/pve/status` | `cpu` (0…1), `memory.used`, `memory.total`, `rootfs.used`, `rootfs.total`, `uptime` (Sekunden) |
| Verlauf | `/nodes/pve/rrddata?timeframe=hour&cf=AVERAGE` | Array mit `cpu`, `memused`, `memtotal` |
| Gäste | `/cluster/resources?type=vm` | `vmid`, `name`, `type`, `status`, `cpu`, `mem`, `maxmem`, `template` |
| Storage | `/nodes/pve/storage` | `storage`, `total`, `used`, `active` |
| Backups | `/nodes/pve/tasks?typefilter=vzdump&limit=50` | `id` (VMID), `starttime`, `endtime`, `status` |
| Updates | `/nodes/pve/apt/update` | Array, nur die Länge zählt |

Der Host ist bereits abgefragt, alle sechs Endpunkte antworten mit `200`. Verlass dich auf diese
gemessenen Werte statt zu raten: Node `pve`, 13 Gäste (VMID 100–112, überwiegend LXC), Storages
`tank`, `local`, `local-lvm`, 31 ausstehende Updates, `rrddata` liefert 60 Punkte pro Stunde,
und `/cluster/resources` enthält **kein** `onboot` — daher `expectRunning` in der Config.

**Die Gästeliste muss 13 und mehr Einträge vertragen.** Im Mockup ist sie deshalb dreispaltig mit
festen Spaltenbreiten und `text-overflow: ellipsis` auf dem Namen (der längste ist
`filebrowser.local`). Eine einspaltige Liste mit `1fr`-Namensspalte läuft bei dieser Menge aus dem
Raster — das war der erste Entwurf und ist verworfen.

Auswertungsregeln, genau so:
- `cpu` ist ein Anteil zwischen 0 und 1 → für die Anzeige mit 100 multiplizieren und runden
- Gäste mit `template: 1` überspringen
- Die Sparkline nimmt die letzten 30 Punkte aus `rrddata`; Punkte mit `cpu === undefined`
  überspringen (Proxmox liefert Lücken)
- Storage nur, wenn `active === 1`
- Backups: der neueste Task pro `id` zählt. `status === "OK"` ist Erfolg, jeder andere Text ist ein
  Fehlschlag. Tasks ohne `endtime` laufen noch und werden ignoriert.

**Alarmzeilen**, jeweils nur erzeugen, wenn die Bedingung zutrifft:

| Bedingung | Zeile | Stufe |
| --- | --- | --- |
| VMID steht in `expectRunning`, `status !== "running"` | `! gast <name> läuft nicht` | `crit` |
| **die Task-Liste enthält überhaupt kein vzdump** | `! keine vzdump-Backups konfiguriert` | `crit` |
| letztes vzdump für eine VMID `status !== "OK"` | `! backup <name> fehlgeschlagen vor <x>` | `crit` |
| letztes vzdump älter als `backupAgeHours` | `! backup <name> alt: vor <x>` | `warn` |
| `apt/update` gibt mehr als 0 Pakete | `! pve <n> updates verfügbar` | `warn` |
| Storage über `thresholds.storage` | `! storage <name> zu <n>% voll` | `warn` |
| Erreichbarkeitsziel antwortet nicht | `! <label> nicht erreichbar` | `crit` |

**Zur Backup-Logik, sonst wird es sofort unbenutzbar:** Auf diesem Host gibt es derzeit
**null vzdump-Tasks**. Prüfe deshalb in dieser Reihenfolge:

1. Ist die vzdump-Liste komplett leer → **genau eine** Zeile „keine vzdump-Backups konfiguriert",
   und danach **keine** weitere Backup-Prüfung.
2. Sonst pro Gast den neuesten vzdump-Task auswerten — aber **nur für Gäste, die überhaupt einen
   Task in der Historie haben.** Ein Gast ohne jede Backup-Historie erzeugt keine Zeile.

Ohne Regel 1 und die Einschränkung in Regel 2 stünden am ersten Tag dreizehn Alarmzeilen in der
Pane, und die Pane verliert genau die Eigenschaft, um die es geht: im Normalfall stumm zu sein.

`reachability.ts`: `net.createConnection({ host, port })` mit 1000 ms Timeout, alle Ziele parallel
per `Promise.all`. Socket in **jedem** Fall mit `socket.destroy()` schließen, sonst bleiben Handles
offen.

Der Endpunkt `GET /api/homelab` gibt **ein** Objekt zurück:

```ts
type HomelabData = {
  node: { cpu: number; mem: number; root: number; uptimeDays: number;
          cpuSpark: number[]; memSpark: number[] };
  guests: { vmid: number; name: string; running: boolean; cpu: number; mem: number }[];
  storage: { name: string; pct: number }[];
  alerts: { level: "warn" | "crit"; text: string }[];
  configured: boolean;    // false, wenn env.pve undefined ist
};
```

Serverseitiger Cache 60 s, damit mehrere Geräte und Tabs nur einen Durchlauf auslösen. Der Browser
ruft `/api/homelab` alle 60 s ab und **pausiert per `visibilitychange`**, solange der Tab nicht
sichtbar ist. Ist `homelab.enabled` false, sperrt der Server die Route mit 404 und der Browser
führt keinen PVE-Request aus.

`Homelab.tsx`: Node-Zeile, Storage-Balken, Gästetabelle zweispaltig, darunter die Alarmzeilen. Ist
`configured: false`, zeigt die Pane eine ruhige Zeile *„Homelab nicht konfiguriert"* statt eines
Fehlers. `Enter` auf einer Gastzeile öffnet
`https://10.0.10.10:8006/?console=kvm&novnc=1&vmid=<vmid>&node=pve`.

Wichtig: **`/api/proxy` wird hier nicht angefasst.** Die Sperre für `10.x` bleibt bestehen. Der
Browser sieht nie einen Token und nie eine Proxmox-URL, weil der Server aggregiert.

**Fertig, wenn:**
- Die Pane zeigt echte Werte des Hosts `pve`
- Läuft alles rund, hat die Pane **keine** Alarmzeile und ist entsprechend kurz
- Einen unwichtigen Gast stoppen und seine VMID in `expectRunning` eintragen → Alarmzeile erscheint,
  `pve` in der Statusline geht auf `crit`; wieder starten → Zeile verschwindet
- Ein falsches Secret in `.env` → Pane bleibt bedienbar, `pve` steht auf `error`, die App
  stürzt nicht ab
- `PVE_TOKEN_SECRET=` in `.env` leeren und Server neu starten → *„Homelab nicht konfiguriert"*,
  alle anderen Panes unverändert
- `curl localhost:7777/api/config | grep -i -e token -e secret` → **keine Treffer**
- Tests grün: Gast in `expectRunning` und gestoppt → `crit`; Gast nicht in der Liste und gestoppt →
  keine Alarmzeile; **leere vzdump-Liste → genau eine Zeile, nicht dreizehn**; Gast ohne
  Backup-Historie bei sonst vorhandenen Tasks → keine Zeile; vzdump älter als Schwelle → `warn`;
  erfolgreiches, frisches vzdump → keine Zeile; `template: 1` wird übersprungen;
  `rrddata` mit Lücken erzeugt keine `NaN`;
  **`GET /api/config` enthält keinen Wert aus `.env`** (Token, Secret, URL)

---

## Schritt 7 · Container bereitstellen

**Ziel:** Der Dienst läuft im LXC und ist unter `http://start.home.arpa` erreichbar.

**Dateien:** `deploy/provision.sh`, `deploy/dashboard.service`, `deploy/deploy.sh`.

Auf dem Proxmox-Host: **unprivilegierten** Debian-13-Container anlegen, 1 vCPU, 512 MB RAM, 4 GB
Disk, statische IP `10.0.10.20/24`, Gateway `10.0.10.1`, DNS `10.0.10.11`, *Start at boot* an.

Im Container (automatisiert durch `deploy/provision.sh`):

```bash
apt update && apt install -y curl rsync
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
corepack enable && corepack install --global pnpm@11.20.0
useradd -r -s /usr/sbin/nologin -d /opt/dashboard dashboard
install -d -o root -g root -m 0755 /opt/dashboard /opt/dashboard/releases
install -d -o dashboard -g dashboard -m 0750 /var/lib/dashboard /var/lib/dashboard/static
install -d -o root -g root -m 0755 /etc/dashboard
```

`config.json` nach `/var/lib/dashboard/config.json`, `.env` als `/etc/dashboard/dashboard.env` und
`pve-ca.pem` nach `/etc/dashboard/pve-ca.pem` kopieren. In der Environment-Datei müssen `PORT=80`,
`DASHBOARD_CONFIG=/var/lib/dashboard/config.json`, `DASHBOARD_STATIC=/var/lib/dashboard/static` und
`PVE_CA_PATH=/etc/dashboard/pve-ca.pem` stehen; `DASHBOARD_WRITE_ALLOW` enthält die
schreibberechtigten Geräte. Code und Dependencies bleiben in root-owned Release-Verzeichnissen.
Dann:

```bash
chown dashboard:dashboard /var/lib/dashboard/config.json
chmod 600 /etc/dashboard/dashboard.env
chown root:dashboard /etc/dashboard/pve-ca.pem
chmod 640 /etc/dashboard/pve-ca.pem
```

`deploy/dashboard.service` — *Vorlage:*

```ini
[Unit]
Description=Dashboard Startseite
After=network-online.target

[Service]
Type=simple
User=dashboard
WorkingDirectory=/opt/dashboard/current
EnvironmentFile=/etc/dashboard/dashboard.env
ExecStart=/opt/dashboard/current/node_modules/.bin/tsx server/index.ts
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateDevices=true
LimitCORE=0
ReadWritePaths=/var/lib/dashboard

[Install]
WantedBy=multi-user.target
```

`AmbientCapabilities=CAP_NET_BIND_SERVICE` ist der Grund, warum der Dienst Port 80 belegen darf,
ohne als root zu laufen. `EnvironmentFile` bedeutet: systemd liest die Environment-Datei selbst ein.
Der Code validiert alle Werte beim Start; Fehler nennen nur Variablennamen, niemals Secrets.

`deploy/deploy.sh` erstellt ein vollständiges Release unter `/opt/dashboard/releases/`: Lokal laufen
zuerst `pnpm test`, `pnpm build` und `git diff --check`; remote folgt `pnpm install --prod
--frozen-lockfile`. Danach wird der Symlink `/opt/dashboard/current` atomar umgeschaltet, der Dienst
neu gestartet und `GET /api/health` geprüft. Bei Installations-, Start- oder Healthcheck-Fehlern
wird der vorherige Symlink und die vorherige Unit wiederhergestellt.

```bash
#!/usr/bin/env bash
set -euo pipefail
pnpm test
pnpm build
git diff --check
./deploy/deploy.sh
```

`config.json`, `.env` und `pve-ca.pem` werden vom Deployment **nicht** übertragen — sie gehören zum
Container-State und würden sonst durch Entwicklungswerte überschrieben. `--delete` wird nur innerhalb
des neuen, noch nicht aktiven Release-Verzeichnisses verwendet.

Im Pi-hole (`http://10.0.10.11/admin`) unter *Settings → Local DNS Records* eintragen:
`start.home.arpa` → `10.0.10.20`.

Zum Abschluss in Proxmox einen Snapshot des Containers anlegen und ihn in den `vzdump`-Zeitplan
aufnehmen — danach überwacht der Dienst sein eigenes Backup in seiner Alarmzeile.

**Fertig, wenn:**
- `systemctl status dashboard` im Container zeigt `active (running)`
- `http://start.home.arpa` lädt auf dem Mac vollständig
- `http://10.0.10.20` lädt ebenso (falls DNS noch nicht greift)
- Auf dem Mac einen Link ergänzen, auf dem iPhone neu laden → der Link ist da; umgekehrt genauso
- `curl -X PUT http://start.home.arpa/api/config` von einem nicht gelisteten Gerät → `403`
- `curl "http://start.home.arpa/api/proxy?url=http://10.0.10.10:8006/"` → `403`
- Container in Proxmox neu starten → der Dienst kommt von allein zurück
- `journalctl -u dashboard -n 50` enthält kein Secret und keinen Token

---

## Schritt 8 · Einstellungen und Feinschliff

**Ziel:** Die Config ist in der Oberfläche bearbeitbar, und die Zugänglichkeit stimmt.

**Dateien:** `src/shell/SettingsPane.tsx`, `index.html`, `public/manifest.webmanifest`.

**Das Aussehen ist im Mockup schon festgelegt:** `:settings` im Mockup eingeben und Enter drücken —
dort steht das fertige Overlay mit allen acht Abschnitten, den Feldtypen und der Fußzeile. Übernimm
Aufbau und Beschriftungen daraus, statt eigene zu erfinden.

`SettingsPane.tsx` öffnet sich mit `:settings` als Overlay über dem Raster. Die Navigation links
listet acht Abschnitte: Links, Feeds, Kalender, Ort &amp; Zeit, Layout, Homelab, Suche, Proxy.
Solange das Overlay offen ist, gilt **nur** `Esc` als globale Taste — sonst würde jeder Tastendruck
in einem Eingabefeld als Pane-Kommando gedeutet. Bearbeitbar:
Link-Gruppen und Links (anlegen, ändern, löschen, sortieren), Feeds, Kalender-URLs, Ort mit
Ortssuche über die Geocoding-URL, Zweitzeitzonen, Theme, Pane-Sichtbarkeit und -Breite,
`expectRunning`, Schwellwerte, Erreichbarkeitsziele, Proxy-Allowlist. Speichern schickt das ganze
Objekt per `PUT`. Eingaben werden **vor** dem Senden mit `configSchema.safeParse` geprüft und Fehler
als deutscher Text am Feld angezeigt.

Feinschliff, alles abarbeiten:
- Kontrast: die Token-Werte aus Abschnitt 5 sind **bereits nachgerechnet** und erfüllen AA. Deine
  Aufgabe ist nur, das mit `tests/contrast.test.ts` festzuschreiben: jede Textfarbe gegen
  `--color-bg` **und** `--color-bg-sel`, in beiden Themes, mindestens 4.5:1; `border-strong` gegen
  `--color-bg` mindestens 3:1. Der Test darf keine Farbe ändern — schlägt er an, hast du ein Token
  verändert und musst es zurücknehmen.
- Jedes fokussierbare Element hat einen sichtbaren `:focus-visible`-Zustand.
- `@media (prefers-reduced-motion: reduce)` schaltet den Cursor-Blink ab.
- `aria-label` auf allen Sparklines, Balken und Statuspunkten, jeweils mit den echten Zahlen.
- Link-Gruppen als `<nav><ul>`, Gästeliste als `<table>` mit `<th scope="col">`.
- `<title>Dashboard</title>`, `<html lang="de">`, `<meta name="color-scheme" content="dark light">`.
- `manifest.webmanifest` mit `display: standalone`, `name`, `theme_color: "#21262E"` und Icons in
  192 px und 512 px, plus `<link rel="apple-touch-icon">` — dafür wird das Home-Screen-Icon auf dem
  iPhone brauchbar.

**Fertig, wenn:**
- Ein Link lässt sich in der Oberfläche anlegen, überlebt einen Neuladen und erscheint auf einem
  zweiten Gerät
- `:export` lädt eine Datei; einen Link löschen, `:import` mit dieser Datei → Stand ist zurück
- Die ganze Seite ist per Tabulator durchlaufbar, der Fokus ist immer sichtbar
- Der Kontrast-Test ist grün
- Auf dem iPhone „Zum Home-Bildschirm" liefert ein Icon, das die Seite ohne Browser-Leiste öffnet

---

## Schritt 9 · Browser einrichten und dokumentieren

**Firefox:** *Einstellungen → Startseite → Startseite und neue Fenster → Benutzerdefinierte Adresse*
= `http://start.home.arpa`; *Wenn Firefox gestartet wird* = „Startseite anzeigen".
Der **neue Tab** lässt sich in Firefox nur per Add-on überschreiben — das ist nicht Teil des
Auftrags. `Alt+Home` öffnet die Startseite jederzeit.

**Safari:** *Einstellungen → Allgemein → Homepage* = `http://start.home.arpa`,
*Neue Fenster öffnen mit* = „Homepage".

**iPhone:** Seite in Safari öffnen, *Teilen → Zum Home-Bildschirm*. iOS Safari kennt keine
Startseite; das Icon ist der Ersatz.

`README.md` schreiben mit: Aufbau in zwei Sätzen, Entwicklung (`pnpm dev` plus `pnpm dev:server`),
Deployment (`pnpm deploy`), Aufbau von `config.json` und `.env` (mit Verweis auf `.env.example`),
Erneuerung des
Proxmox-Tokens, Neukopieren von `pve-ca.pem` falls die PVE-CA neu erzeugt wird, und der Restore-Weg
über den Proxmox-Snapshot.

**Fertig, wenn:** Firefox komplett neu starten → das Dashboard erscheint von selbst.

---

## Definition of Done

Alles muss zutreffen:

1. Alle sieben Panes zeigen echte Daten unter `http://start.home.arpa`.
2. Die Seite ist ohne Maus vollständig bedienbar.
3. Offline erscheinen sofort die letzten bekannten Werte, kein leeres Pane, kein Absturz.
4. Eine Config-Änderung auf einem Gerät ist auf dem nächsten sichtbar.
5. Zwei Tabs können sich nicht gegenseitig überschreiben (`409`).
6. `GET /api/config` gibt keinen Wert aus `.env` heraus, und `.env` ist nicht in Git.
7. `/api/proxy` erreicht keine private Adresse und keinen Host außerhalb der Allowlist.
8. Läuft im Homelab alles rund, hat die HOMELAB-Pane keine Alarmzeile.
9. `pnpm test` und `pnpm build` sind grün.
10. Der Dienst übersteht einen Neustart des Containers von allein.

---

## Ausdrücklich nicht Teil dieses Auftrags

Nicht einbauen, auch nicht „schnell mit dazu":

To-Dos, Notizen, Drag-and-Drop-Layout, Multi-Profile, HTTPS, Zugriff von außerhalb des Heimnetzes,
Chrome-Extension, Firefox-Add-on, Microsoft Graph oder OAuth, Datenbank, Docker,
Authentifizierung/Login, Pi-hole-Widget, Speedtest, SMART-Werte, Graphen pro Gast.

### Für später vorgemerkt (nicht jetzt bauen)

- **Pi-hole-Widget** — Queries, Blockrate, 24-Stunden-Verlauf über die v6-API
  (`POST /api/auth` liefert eine Session, dann `/api/stats/summary` und `/api/history`).
  Zurückgestellt, weil die Session abläuft und serverseitig erneuert werden muss — mehr Zustand als
  die zustandslosen Proxmox-Aufrufe. Die HOMELAB-Pane hat den Platz schon.
- **Docker-Variante** — mehrstufiges `Dockerfile` (`node:22-alpine` als Builder, schlankes
  Runtime-Image, als Nicht-root), `docker-compose.yml` mit `env_file: .env`, `config.json` und
  `pve-ca.pem` als gemountete Volumes, `HEALTHCHECK` auf `/api/config`. Dass die Zugangsdaten schon
  jetzt in `.env` liegen, macht diesen Schritt zu einer einzigen `env_file`-Zeile.
  Das ist kein Docker-in-LXC, sondern ein
  zweiter Betriebsweg zum Weitergeben. Weil Port und alle Pfade schon aus Umgebungsvariablen kommen
  und der Prozess außer den zwei Dateien keinen Zustand hält, sind das zwei neue Dateien und keine
  Änderung am Anwendungscode.
- **HTTPS** per Caddy mit interner CA, falls einmal `navigator.clipboard` oder ein Service Worker
  gebraucht wird — beides verlangt einen Secure Context, den `http://` nicht bietet.
