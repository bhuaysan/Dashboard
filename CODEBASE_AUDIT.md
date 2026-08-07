# Codebase-Audit: Dashboard

Stand: 8. August 2026
Zielgruppe: Luna Max
Status: reine Analyse; am Anwendungscode wurde nichts geändert

## 1. Kurzfazit

Die Codebase hat eine klare, für das Projekt angemessene Architektur und mehrere ungewöhnlich
sauber gelöste Sicherheitsgrundlagen: striktes TypeScript, ein gemeinsames Config-Schema,
serverseitige Proxmox-Secrets, SSRF-Prüfung mit Redirect-Revalidierung und DNS-Pinning sowie
automatisierte WCAG-Kontrasttests. Die normalen Pfade bauen und testen vollständig grün.

Trotzdem gibt es mehrere Fehler in Kernabläufen. Besonders relevant sind nicht atomare
Config-Updates, ein konfliktzerstörender Retry, der nicht funktionierende Config-Restore,
fehlerhafte lokale Kalender, unvollständige ICS-Wiederholungen, eine auf Touch-Geräten defekte
Kommandoeingabe und ein Proxy, der aktiven Inhalt unter der Dashboard-Origin ausliefern kann.
Diese Punkte sind durch die bestehende Testsuite nicht abgedeckt.

**Gesamtbewertung: 7,0/10 – gut, aber mit klarem Härtungsbedarf vor weiteren Features.**

- Keine P0-Lücke und kein gefundener direkter Secret-Leak.
- Neun P1-Findings sollten vor dem nächsten regulären Deployment behoben werden.
- Die Grundarchitektur soll beibehalten werden; ein Frameworkwechsel oder neue Abhängigkeiten
  sind weder nötig noch erlaubt.
- Feature-Erweiterungen erst nach den P1- und den reliability-relevanten P2-Fixes umsetzen.

## 2. Prüfrahmen und Evidenz

Geprüft wurden Frontend, Server, Config-Persistenz, Parser, Cachepfade, Deployment, systemd-Unit,
Tests sowie die verbindlichen Vorgaben aus `AGENTS.md`, `PLAN.md` und `mockup/index.html`.

Nicht durchgeführt wurden Deployment, externe Schreiboperationen oder Änderungen am
Anwendungscode. `.env`, `config.json` und `pve-ca.pem` wurden nicht gelesen.

| Prüfung | Ergebnis |
| --- | --- |
| `pnpm test` | 26 Testdateien, 177/177 Tests bestanden |
| `pnpm build` | bestanden; Client-JS 421,92 kB, 124,77 kB gzip |
| `pnpm audit --prod` | keine bekannten Produktions-Schwachstellen |
| Browserprüfung | 500, 900 und 1280 px; kein horizontaler Seiten-Overflow |
| Lokaler API-Check | `/static/*.ics` und unbekannte `/api/*` liefern fälschlich SPA-HTML mit 200 |
| Proxy-Check | erlaubte HTML-Quelle wird als `text/html` unter `/api/proxy` ausgeliefert |

Die grünen Tests sind ein positiver Befund, aber kein Gegenbeweis zu den Findings: Die meisten
Fehler liegen in noch nicht getesteten Parallelitäts-, Import-, Browser- und Grenzfällen.

## 3. Bewertungsmatrix

| Bereich | Wertung | Begründung |
| --- | ---: | --- |
| Architektur | 8,5/10 | Kleine, verständliche Ein-Prozess-Architektur; klare Browser-/Server-Grenze |
| Codequalität | 7,5/10 | Strict TypeScript, viele reine Funktionen; einzelne Casts und ein großer Settings-Hotspot |
| Funktionale Korrektheit | 6,4/10 | Kalender-, Import-, Konflikt- und Touch-Abläufe enthalten bestätigte Fehler |
| Security | 6,8/10 | SSRF und Secrets stark; aktiver Proxy-Inhalt, Rebinding- und Größenlücken bleiben |
| Reliability/Datenintegrität | 5,8/10 | Nicht atomare Writes, falscher Fehler-Fallback, Cache-Stampede, nicht atomarer Deploy |
| Tests | 7,4/10 | Gute Breite und 177 grüne Tests; wichtige Systemgrenzen fehlen oder sind nicht hermetisch |
| UX/Accessibility | 6,6/10 | Responsiv und visuell solide; mehrere Kerncontrols und Dialoge sind unzureichend zugänglich |
| Betrieb/Deployment | 5,5/10 | Nicht reproduzierbare Installation, kein Healthcheck/Rollback, zu breite Schreibrechte |

## 4. Prioritäten

- **P0:** akuter Totalausfall, direkter Secret-Verlust oder trivial ausnutzbare kritische Lücke.
  Es wurde kein P0 gefunden.
- **P1:** Datenverlust, Sicherheitsgrenze oder zentraler Benutzerablauf betroffen. Vor dem nächsten
  regulären Deployment beheben.
- **P2:** relevante Korrektheits-, Zuverlässigkeits-, Accessibility- oder Betriebsverbesserung.
  Im direkt folgenden Fix-Zyklus bearbeiten.
- **P3:** Randfall, Diagnose, Wartbarkeit oder UX-Politur. Danach priorisieren.

## 5. Übersicht der Findings

| ID | Priorität | Kurzbeschreibung |
| --- | --- | --- |
| F-01 | P1 | Proxy kann aktiven Same-Origin-Inhalt ausliefern |
| F-02 | P1 | Config-CAS und Temp-Dateien sind bei Parallelzugriff nicht atomar |
| F-03 | P1 | Config-Lesefehler fallen still und potenziell gefährlich auf Defaults zurück |
| F-04 | P1 | Zweiter Speicherversuch nach 409 überschreibt bewusst den Serverstand |
| F-05 | P1 | Export/Import-Restore scheitert wegen veraltetem `updatedAt` |
| F-06 | P1 | Lokale ICS-Dateien sind unerreichbar; `//host` umgeht die Browser-Netzwerkregel |
| F-07 | P1 | Das zentrale Config-Schema akzeptiert laufzeitbrechende Werte |
| F-08 | P1 | ICS-`RECURRENCE-ID`-Ausnahmen erscheinen doppelt oder falsch |
| F-09 | P1 | `:settings` wird bei Touch-/Mauseingabe sofort gelöscht |
| F-10 | P2 | Agenda-/Monats-Zeitraum und Intervallüberschneidung sind unvollständig |
| F-11 | P2 | Initiale Local-Config verzögert den Serverabgleich bis zu 15 Sekunden |
| F-12 | P2 | Atom-/RSS-Auswahl kann falsche Links und alte statt neue Artikel liefern |
| F-13 | P2 | Auswahlzustand kann nach Refresh auf unsichtbare Zeilen/Panes zeigen |
| F-14 | P2 | Unvalidierte Client-Caches und Upstream-Antworten können die App crashen |
| F-15 | P2 | Linkgruppen sind entgegen PLAN nicht sortierbar |
| F-16 | P2 | Feiertagsregion NRW widerspricht dem Default-Ort Heilbronn/BW |
| F-17 | P2 | Homelab-Cache ignoriert Config-Revisionen und besitzt kein Single-Flight |
| F-18 | P2 | Ein vollständig fehlender erwarteter Gast löst keinen Alarm aus |
| F-19 | P2 | Write-Guard prüft weder Host noch Origin |
| F-20 | P2 | Config-Body und Proxy-Cache besitzen ungeeignete Ressourcengrenzen |
| F-21 | P2 | Deployment ist weder reproduzierbar noch atomar und erzwingt keine Tests |
| F-22 | P2 | Dienstrechte und Environment-Validierung sind zu weit beziehungsweise zu spät |
| F-23 | P2 | Ausfall einzelner News-/Kalenderquellen bleibt unsichtbar |
| F-24 | P2 | Settings, Dialoge und Monatsraster haben bestätigte Accessibility-Lücken |
| F-25 | P2 | Code, PLAN und verbindliches Mockup sind sichtbar auseinandergelaufen |
| F-26 | P2 | Kritische Servergrenzen fehlen in Tests; einzelne Tests nutzen echte Infrastruktur |
| F-27 | P3 | Upstream-204 wird durch einen unzulässigen Response-Body zu 502 |
| F-28 | P3 | Unbekannte API-/Static-Routen liefern die SPA mit HTTP 200 |
| F-29 | P3 | Ortssuche unterscheidet HTTP-Fehler nicht von „nicht gefunden“ |
| F-30 | P3 | Suchvorschau und tatsächliches Enter-Verhalten widersprechen sich |
| F-31 | P3 | „Homelab nicht konfiguriert“ wird als „veraltet“ angesagt |
| F-32 | P3 | Repo-Hygiene und Settings-Hotspot erschweren Wartung |

## 6. Detaillierte Findings und Behebung

### F-01 – Proxy kann aktiven Same-Origin-Inhalt ausliefern

**Priorität:** P1 / Security
**Betroffene Stellen:** `server/proxy.ts:106-110`, `server/index.ts:50-53`

**Befund**

Der Proxy übernimmt den `Content-Type` des Upstreams. Liefert ein erlaubter oder kompromittierter
Feed-Host HTML, kann eine Navigation auf `/api/proxy?url=...` dieses HTML unter
`http://start.home.arpa` ausführen. Der Pfad wurde mit einer erlaubten HTML-Quelle bestätigt:
Die Antwort war `200 text/html`.

Damit läuft fremdes Skript in derselben Origin wie das Dashboard. Es könnte die offen lesbare
Config abrufen und – wenn der Browser auf einer schreibberechtigten LAN-Adresse läuft – auch einen
Config-PUT auslösen. Die SSRF-Logik selbst ist dabei nicht gebrochen; das Problem liegt in der
Auslieferung der bereits erlaubten Antwort.

**Behebung**

1. Proxy-Antworten grundsätzlich als inerten Inhalt ausliefern. `application/octet-stream` oder
   `text/plain; charset=utf-8` genügt, weil die Clients `res.json()` beziehungsweise `res.text()`
   verwenden und den Upstream-MIME-Typ nicht benötigen.
2. Zusätzlich setzen:
   - `Content-Disposition: attachment`
   - `X-Content-Type-Options: nosniff`
   - `Content-Security-Policy: sandbox; default-src 'none'`
3. Niemals Upstream-CSP, Cookies oder andere aktiven Browserheader ungeprüft durchreichen.
4. Optional aktive Typen wie HTML, SVG und XHTML zusätzlich explizit ablehnen. Das ist Defense in
   Depth, nicht Ersatz für die sicheren Response-Header.

**Abnahme/Tests**

- Gemockter Upstream liefert `text/html` mit Skript; die Proxy-Antwort besitzt den inerten
  Content-Type und alle Schutzheader.
- JSON-Weather, RSS/Atom und ICS funktionieren weiterhin über `res.json()`/`res.text()`.
- Ein Browser-Navigationstest darf den Inhalt nicht als Dashboard-Dokument ausführen.

### F-02 – Config-CAS und Temp-Dateien sind nicht atomar

**Priorität:** P1 / Datenintegrität
**Betroffene Stellen:** `server/index.ts:20-34`, `server/config-store.ts:24-27`,
`server/config-store.ts:59-77`

**Befund**

Der Ablauf „lesen → `If-Match` prüfen → schreiben“ ist nicht serialisiert. Zwei parallele PUTs mit
demselben `updatedAt` können beide die Prüfung bestehen. Alle Schreibvorgänge desselben Prozesses
verwenden zudem denselben Temp-Pfad `${path}.tmp-${process.pid}`. Mögliche Resultate sind ein
Lost Update, zwei erfolgreiche Antworten, eine zufällig gewinnende Config oder ein sporadisches
`ENOENT`/500 beim zweiten Rename.

`new Date().toISOString()` ist außerdem nicht garantiert eindeutig: Zwei Updates innerhalb
derselben Millisekunde können denselben Revisionswert erhalten.

**Behebung**

1. Eine einzige Store-Funktion `updateConfig(ifMatch, candidate)` einführen, die folgende Schritte
   innerhalb einer prozessweiten Promise-Queue ausführt:
   - aktuelle Config lesen,
   - `If-Match` vergleichen,
   - Candidate zentral validieren,
   - strikt monotone Revision erzeugen,
   - Backup rotieren,
   - eindeutig benannte Temp-Datei schreiben,
   - atomar umbenennen.
2. Temp-Dateien ohne neue Abhängigkeit mit `crypto.randomUUID()` oder einem Prozesszähler
   eindeutig machen.
3. Temp-Dateien in `finally` best-effort entfernen.
4. Die Revision muss größer als die bisherige sein. Wenn `Date.now()` nicht fortgeschritten ist,
   mindestens eine Millisekunde auf die alte Revision addieren; alternativ eine opaque separate
   Revision verwenden. Die bestehende API kann beim ISO-Zeitstempel bleiben.
5. Erst nach erfolgreichem Rename mit 200 antworten.

**Abnahme/Tests**

- Zwei gleichzeitig freigegebene PUTs mit demselben `If-Match` liefern exakt einmal 200 und einmal
  409.
- Unter eingefrorener Systemzeit erzeugen zwei sequenzielle Updates verschiedene Revisionen.
- Backups bleiben konsistent und keine `.tmp-*`-Datei bleibt zurück.
- Der Gewinnerinhalt entspricht vollständig einem Request, niemals einer Mischung.

### F-03 – Config-Lesefehler fallen still auf Defaults zurück

**Priorität:** P1 / Reliability und Security
**Betroffene Stelle:** `server/config-store.ts:30-47`

**Befund**

Ein pauschaler `catch` behandelt fehlende Datei, syntaktisch ungültiges JSON, Schemafehler,
`EACCES`, `EIO` und Backup-Fehler gleich. Operative Lesefehler werden dadurch als gültige
Default-Config getarnt. Das kann eine bewusst eingeschränkte Proxy-Allowlist temporär erweitern
und einen späteren Write gegen einen falschen Stand erlauben.

Syntaktisch kaputtes JSON wie `{` wird entgegen der dokumentierten Recovery-Regel nicht nach
`.bak` gesichert, weil der Parse-Fehler vor dem vorgesehenen `copyFile` entsteht. Der vorhandene
Test prüft nur valides JSON mit ungültigem Schema.

**Behebung**

1. `readFile` separat behandeln: Nur `ENOENT` darf Defaults liefern.
2. JSON-Parsefehler und Zod-Schemafehler separat auffangen, die Originaldatei sichern und erst
   danach Defaults verwenden.
3. `EACCES`, `EIO`, übergroße Dateien und fehlgeschlagene Sicherungen propagieren.
4. API-Aufrufer sollen bei einem operativen Config-Fehler 503 erhalten. Proxy, Homelab und PUT
   dürfen in diesem Zustand nicht mit Defaults fortfahren.
5. Fehlermeldungen dürfen Pfad/Fehlerklasse nennen, aber keine Config-Inhalte oder Secrets.

**Abnahme/Tests**

- Literal `{` erzeugt eine Sicherung und liefert anschließend Defaults.
- Gemocktes `EACCES`/`EIO` führt zu Fehler/503, niemals Defaults.
- Ein fehlgeschlagenes Backup wird nicht verschluckt.
- Der Proxy nutzt bei Config-I/O-Fehlern keinesfalls die Default-Allowlist.

### F-04 – Der zweite Speicherversuch nach 409 überschreibt den Serverstand

**Priorität:** P1 / Datenintegrität
**Betroffene Stellen:** `src/shell/SettingsPane.tsx:256-263`,
`src/shell/SettingsPane.test.tsx:121-139`

**Befund**

Nach einem 409 wird der frische Server-Zeitstempel in den unveränderten alten Draft kopiert. Beim
nächsten Klick besitzt der alte Entwurf damit einen gültigen `If-Match` und überschreibt bewusst
die Änderungen des anderen Geräts/Tabs. Das widerspricht der Vorgabe aus `PLAN.md`, nach der der
Serverstand gewinnt. Der bestehende Test schreibt das falsche Verhalten aktuell sogar fest.

**Behebung**

1. Bei 409 den lokalen Draft für eine mögliche manuelle Übernahme erhalten, aber dessen
   `updatedAt` nicht ändern.
2. Weitere Saves aus diesem Dialog sperren, bis der Serverstand neu geladen oder der Dialog
   geschlossen wurde.
3. Einfache plan-konforme Meldung: „Ein anderes Gerät hat die Einstellungen geändert. Bitte
   Serverstand neu laden.“
4. Falls später ein Force-Overwrite gewünscht wird, nur als getrennte, ausdrücklich bestätigte
   Aktion implementieren – nicht als stillen zweiten Klick.

**Abnahme/Tests**

- Nach 409 bleibt der alte ETag im Draft unverändert.
- Ein wiederholter Save kann den Server nicht verändern.
- „Neu laden“ zeigt den Serverstand; erst eine danach bewusst erneut vorgenommene Änderung darf
  gespeichert werden.
- Den vorhandenen Test umdrehen, statt einen zusätzlichen widersprüchlichen Test anzulegen.

### F-05 – Export/Import-Restore scheitert wegen altem `updatedAt`

**Priorität:** P1 / Kernfunktion
**Betroffene Stellen:** `src/config/io.ts:16-29`, `src/App.tsx:193`, `src/App.tsx:237-246`,
`src/api/config.ts:39-43`

**Befund**

Eine Exportdatei enthält das damalige `updatedAt`. Nach jeder zwischenzeitlichen Änderung sendet
der Import genau diesen alten Wert als `If-Match`; der Server antwortet zwangsläufig mit 409.
Damit funktioniert die in `PLAN.md` verlangte Strecke „exportieren → ändern → importieren → alten
Inhalt wiederherstellen“ nicht. Außerdem kann die UI Erfolg signalisieren, bevor die Mutation
wirklich erfolgreich abgeschlossen ist.

**Behebung**

1. `updatedAt` im Export als Information betrachten, beim Restore aber nicht als aktuelle
   Schreibberechtigung übernehmen.
2. Den importierten Inhalt validieren und unmittelbar vor dem PUT mit der aktuell bekannten
   Serverrevision `config.updatedAt` versehen.
3. Zwischen Lesen dieser Revision und PUT bleibt der normale CAS-Schutz erhalten; eine echte
   parallele Änderung muss weiter 409 liefern.
4. Erfolgsmeldung und Schließen des Dialogs nur in `onSuccess` der Mutation ausführen.
5. Importfehler müssen Dateifehler, Schemaverletzung und 409 unterscheidbar auf Deutsch melden.

**Abnahme/Tests**

- Snapshot exportieren, Config ändern/speichern, alten Snapshot importieren: Inhalt wird
  wiederhergestellt.
- Während des Imports speichert ein zweiter Client: der Import endet mit 409 und überschreibt ihn
  nicht.
- Bei 4xx/5xx erscheint keine Erfolgsmeldung.

### F-06 – Lokale ICS-Dateien sind unerreichbar; `//host` umgeht die Netzwerkregel

**Priorität:** P1 / Funktion und Security
**Betroffene Stellen:** `src/widgets/Agenda.tsx:21-26`,
`src/shell/SettingsPane.tsx:459-480`, `src/config/schema.ts:28`, `server/index.ts:81-83`,
`deploy/deploy.sh:5`, `PLAN.md:869-873`

**Befund**

Die UI dokumentiert `/static/*.ics`, der Server serviert aber nur `dist/`. Eine Datei in
`/opt/dashboard/static/` ist somit nicht erreichbar. In `dist/static` wäre sie ebenfalls nicht
dauerhaft, weil `rsync --delete` sie beim nächsten Deployment entfernt. Eine fehlende Datei wird
zusätzlich durch den SPA-Fallback als `index.html` mit 200 beantwortet.

Noch kritischer: `startsWith("/")` klassifiziert auch `//evil.example/x.ics` als lokal. Im Browser
ist dies eine protocol-relative Fremd-URL und erzeugt einen direkten Cross-Origin-Request. Das
verletzt die harte Regel, dass Browser-Netzzugriffe nur an `/api/...` gehen.

**Behebung**

1. Im zentralen Schema lokale Kalender ausschließlich als sicheren `/static/...`-Pfad erlauben:
   - genau ein führender Slash,
   - kein `//`, `..`, Backslash, NUL oder URL-Schema,
   - vorzugsweise Endung `.ics`.
2. Externe Kalender ausschließlich als `http:`/`https:` akzeptieren und immer über
   `/api/proxy?url=...` laden.
3. Ein separates erhaltenes Static-Root definieren, z. B.
   `DASHBOARD_STATIC=/opt/dashboard/static`, und `/static/*` vor dem SPA-Fallback daraus servieren.
4. Den aufgelösten Dateipfad gegen das Root prüfen; Traversal ablehnen.
5. Das Verzeichnis beim Provisioning anlegen und nicht in den `rsync --delete`-Zielbaum legen.
6. Fehlende `/static/*`-Dateien mit 404 beantworten.

**Abnahme/Tests**

- Gültiges `/static/arbeit.ics` wird korrekt ausgeliefert und geparst.
- Fehlende Datei liefert 404, kein HTML.
- `//host/x.ics`, `/static/../config.json`, encodiertes Traversal und Backslashes werden abgelehnt.
- `https://example/...ics` wird nur über `/api/proxy` angefordert.
- Browsertest bestätigt: kein direkter Request an eine Fremd-Origin.

### F-07 – Zentrales Config-Schema akzeptiert laufzeitbrechende Werte

**Priorität:** P1 / Reliability
**Betroffene Stellen:** `src/config/schema.ts:9-52`, `src/App.tsx:299` sowie manuelle
Teilvalidierung in `src/shell/SettingsPane.tsx`

**Befund**

Eine ungültige Zeitzone wird vom Schema akzeptiert, löst aber beim Rendern über
`Intl.DateTimeFormat` einen `RangeError` aus und kann die App in einen leeren Zustand bringen.
Importe und direkte API-PUTs umgehen die manuellen UI-Prüfungen vollständig.

Weitere fehlende Invarianten sind unter anderem:

- ausschließlich HTTP(S)-URLs und sichere lokale Kalenderpfade,
- Suchvorlagen mit genau einem `%s`,
- Latitude `-90..90`, Longitude `-180..180`,
- Ports `1..65535`, Prozentwerte `0..100`,
- positiver und sinnvoll gedeckelter Backup-Zeitraum,
- positive, eindeutige VMIDs,
- eindeutige Layout-IDs und Link-Hints,
- nichtleere/realistisch begrenzte Namen, Hosts, Node-Namen, Strings und Arrays,
- valides ISO-Datetime für `updatedAt`.

**Behebung**

1. Kleine wiederverwendbare Zod-v3-Schemas für URL, Zeitzone, Koordinaten, Port, Prozent,
   Suchvorlage, lokalen Kalenderpfad und begrenzte Strings definieren.
2. Zeitzone mit einem `Intl.DateTimeFormat`-Versuch innerhalb eines sicheren `refine` prüfen.
3. Eindeutigkeit von Layout, VMIDs und Hints über `superRefine` abbilden.
4. Grenzen in demselben Schema server- und clientseitig erzwingen. HTML-Attribute und
   Settings-Prüfungen dienen nur der besseren UX.
5. Bestehende Configs über Defaults ergänzen, aber niemals semantisch falsche Werte still
   akzeptieren.

**Abnahme/Tests**

- Für jede Invariante: gültiger Grenzwert sowie Wert direkt darunter/darüber.
- Import mit ungültiger Zeitzone oder Port wird vor dem Save mit feldnaher Meldung abgelehnt.
- Direkter API-PUT kann die Regeln nicht umgehen.
- Default-Config und bekannte Alt-Configs bleiben gültig.

### F-08 – ICS-Wiederholungsausnahmen erscheinen doppelt oder falsch

**Priorität:** P1 / Kernfunktion
**Betroffene Stelle:** `src/lib/ics.ts:14-36`

**Befund**

Eine tägliche Serie mit verschobener `RECURRENCE-ID`-Instanz ergab in der Reproduktion drei statt
zwei Einträge. Die Master-Serie liefert über `getOccurrenceDetails()` zwar die geänderte Zeit,
`toCalEvent(event, ...)` verwendet jedoch weiter Titel und Ganztagsstatus des Masters. Danach wird
die Exception-VEVENT im äußeren Loop erneut als eigener Termin gerendert. Abgesagte Instanzen sind
ebenfalls nicht zuverlässig entfernt; ohne UID-Gruppierung können Exceptions falschen Serien
zugeordnet werden.

**Behebung**

1. VEVENT-Komponenten zunächst nach UID gruppieren.
2. Komponenten mit `RECURRENCE-ID` nicht eigenständig rendern.
3. Pro UID einen Master mit ausschließlich zugehörigen Exceptions aufbauen; strikte
   Exception-Zuordnung aktivieren.
4. Bei `getOccurrenceDetails()` `details.item` für Titel, Status und Ganztagsinformation sowie
   die tatsächlichen Start-/Endzeiten verwenden.
5. `STATUS:CANCELLED` überspringen.
6. Wiederholungsexpansion defensiv begrenzen, damit pathologische Kalender die UI nicht blockieren.

**Abnahme/Tests**

- Verschobene Instanz erscheint genau einmal mit neuem Titel und neuer Uhrzeit.
- Abgesagte Einzelinstanz fehlt.
- Zwei Serien mit Exceptions am selben Zeitpunkt bleiben getrennt.
- Verwaiste Exception wird definiert behandelt und führt nicht zu einem Crash.
- Sehr alte tägliche Serie wird in begrenzter Zeit auf den angefragten Bereich reduziert.

### F-09 – `:settings` wird bei Touch-/Mauseingabe sofort gelöscht

**Priorität:** P1 / Kernfunktion und Mobile UX
**Betroffene Stellen:** `src/shell/CommandBar.tsx:22-32`, `src/shell/CommandBar.tsx:81-86`

**Befund**

Wird das Eingabefeld angeklickt und `:` beziehungsweise `:settings` getippt oder eingefügt,
wechselt `onChange` von `INSERT` zu `COMMAND`. Der zugehörige Effekt läuft erneut und setzt den
Wert auf `seed ?? ""`. Im Browser wurde bestätigt: Das `:` verschwindet sofort, obwohl die
Statusline schon `COMMAND` anzeigt. Auf iPhone/Touch ist der einzige Settings-Zugang damit
praktisch defekt. Der globale Doppelpunkt-Shortcut funktioniert nur mit physischer Tastatur.

**Behebung**

1. Den Eingabewert nur beim Übergang `NORMAL → INSERT|COMMAND` initialisieren.
2. Den vorherigen Modus mit `useRef` halten.
3. Bei `INSERT ↔ COMMAND` lediglich den Modus ändern und den lokalen Text erhalten.
4. Fokus- und Seed-Logik getrennt behandeln, damit der globale `:`-Shortcut unverändert arbeitet.
5. Als spätere UX-Erweiterung `cfg` in der Statusline als textuelle Schaltfläche nutzbar machen.

**Abnahme/Tests**

- Feld fokussieren, `:settings` per Change/Typing eingeben: Text bleibt erhalten und Enter ruft das
  Kommando auf.
- Doppelpunkt wieder löschen: Modus wechselt zu `INSERT`, Resttext bleibt erhalten.
- Globaler `:`-Shortcut fokussiert und seedet weiterhin korrekt.
- Paste von `:settings` funktioniert.

### F-10 – Agenda-/Monats-Zeitraum und Intervallüberschneidung sind unvollständig

**Priorität:** P2 / Korrektheit
**Betroffene Stellen:** `src/App.tsx:89-93`, `src/App.tsx:107-113`,
`src/widgets/Agenda.tsx:13-16`, `src/widgets/Month.tsx:22`, `src/lib/ics.ts:21-32`

**Befund**

`fetchEvents` beginnt immer heute. MONTH kann daher Termine früherer sichtbarer Monatstage nie
markieren. Das Abrufende ist nur `monthGrid(now).to`, obwohl die Agenda heute plus vier Tage
anzeigen möchte. Endet das Monatsraster am Monatsletzten – reproduzierbar am 31. Mai 2026 – fehlen
Termine der Folgetage vollständig.

Zusätzlich werden Ereignisse nur berücksichtigt, wenn ihr Start innerhalb des Fensters liegt.
Ein Termin von 23:00 bis 01:00 fehlt bei einer Abfrage ab Mitternacht, obwohl er noch läuft.

**Behebung**

1. Eine reine Funktion für den gemeinsamen Abrufbereich verwenden:
   - `from = monthGrid(now).from`
   - `to = max(monthGrid(now).to, endOfAgendaRange)`
2. Datumsgrenzen in den Query-Key aufnehmen, damit Tages-/Monatswechsel sofort neu laden.
3. Agenda anschließend auf den Agenda-Zeitraum filtern, MONTH auf das Monatsraster.
4. Intervallüberschneidung statt Startpunktprüfung verwenden:
   `event.end >= from && event.start <= to`.
5. Bei Wiederholungen erst die tatsächlichen Occurrence-Zeiten bestimmen und dann den Overlap
   prüfen.

**Abnahme/Tests**

- 31.05.2026 mit Termin am 02.06.: Termin erscheint in der Agenda.
- Ein früherer Termin desselben sichtbaren Monats markiert MONTH.
- Über-Mitternacht- und mehrtägige Termine erscheinen korrekt.
- Tageswechsel verändert den Query-Key ohne 15-Sekunden-Wartezeit.

### F-11 – Local-Config verzögert den initialen Serverabgleich

**Priorität:** P2 / Datenaktualität
**Betroffene Stelle:** `src/api/config.ts:17-33`

**Befund**

TanStack Query betrachtet `initialData` aus Local Storage zusammen mit `staleTime: 30_000` als
frisch. Dadurch erfolgt beim Mount kein Serverfetch; erst das 15-Sekunden-Polling gleicht ab. Im
Browser war zunächst lokaler/default Inhalt sichtbar, bevor der Serverstand erschien.

**Behebung**

- `refetchOnMount: "always"` oder `initialDataUpdatedAt: 0` setzen.
- Local Storage weiterhin für sofortiges Offline-Rendering nutzen, aber sofort im Hintergrund
  revalidieren.
- Fehler beim ersten Fetch sollen den sichtbaren Cache nicht löschen.

**Abnahme/Tests**

- Mit vorhandener Local-Config wird Fetch unmittelbar beim Mount aufgerufen.
- Bis zur Antwort bleibt der Cache sichtbar.
- Bei erfolgreicher Antwort wird der Serverstand ohne Polling-Verzögerung übernommen.

### F-12 – RSS/Atom kann falsche Links und alte Artikel wählen

**Priorität:** P2 / Korrektheit
**Betroffene Stellen:** `src/lib/rss.ts:22-27`, `src/widgets/News.tsx:15-20`

**Befund**

Atom nimmt blind das erste `<link>`. Steht `rel="self"` vor `rel="alternate"`, öffnet ein Artikel
den Feed/API-Endpunkt. Relative Links werden später gegen `start.home.arpa` statt gegen die
Feed-URL aufgelöst. Außerdem wird pro Feed `slice(0, limit)` vor der Datumssortierung ausgeführt;
aufsteigend gelieferte Feeds behalten dadurch die ältesten Artikel.

**Behebung**

1. Feed-Basis-URL an `parseFeed` übergeben.
2. `rel="alternate"` oder Link ohne `rel` bevorzugen; `self`, `hub` und Assets ignorieren.
3. Relative Links mit `new URL(href, feedUrl)` absolut auflösen und anschließend `safeHref`
   anwenden.
4. Pro Feed zuerst absteigend nach Datum sortieren, dann limitieren; danach Feeds zusammenführen
   und erneut global sortieren.

**Abnahme/Tests**

- `self` vor `alternate` wählt `alternate`.
- Relativer Link wird gegen die Feed-URL aufgelöst.
- Aufsteigender Feed mit Limit 1 liefert den neuesten Artikel.
- Unsichere Schemata bleiben blockiert.

### F-13 – Auswahlzustand kann unsichtbar werden

**Priorität:** P2 / Tastaturbedienung
**Betroffene Stellen:** `src/App.tsx:146-169`, `src/App.tsx:186-191`,
`src/lib/useKeymap.ts:41-45`

**Befund**

Schrumpft beispielsweise NEWS nach einem Refresh, bleibt `ui.row` außerhalb des neuen Arrays.
Dann ist keine Zeile markiert und Enter tut nichts. Wird das aktive Pane über eine Config-Änderung
eines anderen Geräts ausgeblendet, zeigt `ui.pane` weiter auf ein nicht montiertes Pane.

**Behebung**

1. Eine Reducer-Aktion zur Synchronisation ergänzen.
2. Bei geändertem `rowCount` den Zeilenindex auf den letzten gültigen Wert klemmen.
3. Ist das aktive Pane nicht mehr sichtbar, das erste sichtbare Pane oder `null` wählen.
4. Dieselbe Normalisierung beim initialen Hydratisieren einer neuen Config anwenden.

**Abnahme/Tests**

- Liste schrumpft von fünf auf zwei: Auswahl liegt sichtbar auf Zeile 0 oder 1.
- Aktives Pane wird ausgeblendet: Fokus wechselt deterministisch auf das erste sichtbare Pane.
- Enter öffnet danach weiterhin die sichtbare Auswahl.

### F-14 – Unvalidierte Caches und Upstream-Antworten können die App crashen

**Priorität:** P2 / Reliability
**Betroffene Stellen:** `src/api/useCachedQuery.ts:18-30`, `src/widgets/Weather.tsx:45`,
`src/widgets/Weather.tsx:118-127`, `src/widgets/Homelab.tsx:23-36`, `server/pve.ts:82-90`

**Befund**

Syntaktisch valides Cache-JSON wird direkt auf `T` gecastet. Ein altes Objekt wie `{data:{}}` kann
dadurch bei `hours.map` oder `cpuSpark.join` die React-Ausgabe abbrechen. Externe Weather- und
PVE-Antworten werden ebenfalls nur typbehauptet; geänderte 200-Antworten können falsche Nullen,
`NaN` oder pauschale Fehler produzieren.

**Behebung**

1. Cacheformat versionieren, z. B. `{version, t, data}`.
2. `useCachedQuery` einen Decoder geben, der `unknown` erhält und validierte Daten oder
   `undefined` zurückgibt. Ungültige Einträge löschen.
3. Mit vorhandenem Zod nur die tatsächlich genutzten Weather-/Homelab-/PVE-Felder validieren;
   keine neue Abhängigkeit hinzufügen.
4. Zahlen auf Endlichkeit prüfen und Fehler sanitisiert einem Quellstatus zuordnen.
5. Alte Dashboard-Cachekeys begrenzt aufräumen, ohne fremde Local-Storage-Einträge anzufassen.

**Abnahme/Tests**

- Cache `{data:{}}`, falscher Timestamp und alte Version werden verworfen; die App rendert einen
  ruhigen Lade-/Leerzustand.
- Malformed Weather/PVE-200 wird als Quellfehler behandelt, nicht als 0 °C oder `NaN`.
- Gültige Date-Felder werden nach wie vor revived.

### F-15 – Linkgruppen sind nicht sortierbar

**Priorität:** P2 / fehlender PLAN-Abnahmepunkt
**Betroffene Stelle:** `src/shell/SettingsPane.tsx:322-367`

**Befund**

Einzelne Links besitzen Auf-/Ab-Aktionen, Gruppenheader nur Löschen. `PLAN.md` verlangt ausdrücklich,
dass Linkgruppen und Links angelegt, geändert, gelöscht und sortiert werden können.

**Behebung**

- Im Gruppenheader dieselben textuellen Auf-/Ab-Aktionen ergänzen.
- Vor dem Tauschen beide Arraywerte prüfen; nicht mit `as T` die
  `noUncheckedIndexedAccess`-Prüfung umgehen.
- Randaktionen deaktivieren und zugänglich mit Gruppennamen beschriften.

**Abnahme/Tests**

- Zweite Gruppe nach oben verschieben und speichern; Reihenfolge bleibt nach Reload erhalten.
- Erste/letzte Gruppe kann nicht über den Rand verschoben werden.

### F-16 – Feiertagsregion widerspricht dem Default-Ort

**Priorität:** P2 / fachliche Korrektheit
**Betroffene Stellen:** `src/config/defaults.ts:14`, `src/lib/holidays.ts:26-45`,
`src/lib/holidays.test.ts:34-41`, `src/shell/SettingsPane.tsx:162-174`

**Befund**

Der Default-Ort ist Heilbronn in Baden-Württemberg, die Feiertagsberechnung ist fest auf NRW
verdrahtet. Dadurch fehlt im Defaultfall unter anderem der 6. Januar. Ein frei konfigurierbarer Ort
ändert die Feiertagsregion ebenfalls nicht. Referenz:
[Innenministerium Baden-Württemberg – Feiertage](https://im.baden-wuerttemberg.de/de/service/feiertage).

**Behebung**

1. Ein kleines `holidayRegion`-Enum in die Config aufnehmen, Default für diese Installation `BW`.
2. Bestehende Configs ohne Feld über einen dokumentierten Default ergänzen; nicht aus Koordinaten
   raten.
3. Region in „Ort & Zeit“ auswählbar machen. Das Geocoding-Ergebnis darf `admin1` als Vorschlag
   liefern, die gespeicherte Entscheidung bleibt explizit.
4. Feiertagsfunktionen nach Region dispatchen; gemeinsame und regionale Feiertage trennen.

**Abnahme/Tests**

- 6. Januar ist in BW vorhanden und in NRW nicht.
- Config ohne `holidayRegion` migriert deterministisch.
- Standort-/Regionswechsel ändert das Feiertagsset.

### F-17 – Homelab-Cache ignoriert Config-Revision und hat kein Single-Flight

**Priorität:** P2 / Reliability
**Betroffene Stellen:** `server/index.ts:63-76`, `src/App.tsx:101-103`,
`src/api/config.ts:52-55`

**Befund**

Neue Schwellwerte, `expectRunning`, Reachability-Ziele oder der Node können bis zu 60 Sekunden alten
Homelab-Inhalt zeigen, weil der Cache nicht mit `config.updatedAt` verknüpft ist. Mehrere Requests
nach Ablauf starten jeweils alle Backend-Abfragen. Bei einem PVE-Ausfall wird der Request-Sturm bei
jedem Client wiederholt.

**Behebung**

1. Config vor der Cache-Hit-Entscheidung lesen.
2. Cache als `{revision, fetchedAt, data}` führen und nur bei gleicher Revision verwenden.
3. Eine laufende `Promise` teilen und in `finally` löschen.
4. Fehler kurz negativ cachen oder einen kleinen Retry-Backoff mit `Retry-After` verwenden.
5. Optional letzten erfolgreichen Stand zeitlich begrenzt mit `stale: true` und `fetchedAt`
   zurückgeben.
6. Nach erfolgreichem Client-Config-Save die Query `['pve']` invalidieren.

**Abnahme/Tests**

- Gleiche Revision trifft den Cache; neue Revision berechnet sofort neu.
- Zehn parallele Cache-Misses rufen `fetchHomelab` genau einmal auf.
- Nach Fehler wird innerhalb des Backoffs nicht vervielfacht, danach ist ein neuer Versuch möglich.

### F-18 – Fehlender erwarteter Gast erzeugt keinen Alarm

**Priorität:** P2 / Monitoring-Korrektheit
**Betroffene Stelle:** `server/pve.ts:129-132`

**Befund**

Die Logik alarmiert nur, wenn der erwartete Gast gefunden wird und nicht läuft. Fehlt eine VMID aus
`expectRunning` vollständig in `/cluster/resources` – etwa nach versehentlichem Löschen –, bleibt
der kritischere Zustand fälschlich gesund.

Im laufenden UI wurde außerdem eine Backupmeldung mit `vmid 0` beobachtet. Das kann eine
Cluster-/Job-Task ohne konkrete Gastzuordnung sein. Dieser zweite Punkt ist eine Runtime-Anomalie,
deren Rohdaten vor einer Änderung gezielt mit synthetischen Fixtures nachgestellt werden sollen;
keine Produktionsdaten loggen.

**Behebung**

- `!guest` als `crit` mit „gast vmid X nicht gefunden“ melden.
- Vorhandene, gestoppte Gäste weiterhin mit Namen melden.
- Backup-Tasks mit nichtpositiver/unbekannter Gast-ID als Job-Level-Meldung behandeln oder nach
  bestätigter PVE-Semantik ignorieren; nicht als realen Gast `vmid 0` anzeigen.

**Abnahme/Tests**

- Erwartete, aber fehlende VMID erzeugt genau einen kritischen Alarm.
- Vorhandener gestoppter Gast bleibt ein separater Fall.
- Synthetische Cluster-Backup-Task ohne VMID erzeugt keine irreführende Gastmeldung.

### F-19 – Write-Guard prüft weder Host noch Origin

**Priorität:** P2 / Defense in Depth
**Betroffene Stellen:** `server/write-guard.ts:25-40`, `server/index.ts:20`

**Befund**

Die Schreibberechtigung basiert ausschließlich auf der Socket-IP. Bei einer großzügigen
LAN-Allowlist kann ein DNS-Rebinding-Angriff über den Browser eines erlaubten Geräts schreiben,
wenn vorgelagerte DNS-Schutzmechanismen nicht greifen.

**Behebung**

1. Erlaubte Dashboard-Hosts explizit konfigurieren: `start.home.arpa`, direkte Ziel-IP und lokale
   Dev-Hosts.
2. Schreibrequests mit unbekanntem `Host` ablehnen.
3. Wenn `Origin` vorhanden ist, eine passende erlaubte Same-Origin verlangen.
4. Headerlose CLI-Requests weiterhin zulassen, sofern die Quell-IP erlaubt ist.
5. Keine Login-/HTTPS-Architektur hinzufügen; das wäre außerhalb des Scopes.

**Abnahme/Tests**

- Fremder Host und Origin-Mismatch liefern 403.
- Legitime Browser-Origin und headerloser curl-Request aus erlaubter Adresse funktionieren.
- Proxy-Forwarded-Header werden nur berücksichtigt, wenn der Server tatsächlich hinter einem
  vertrauenswürdigen Proxy konfiguriert ist.

### F-20 – Config-Body und Proxy-Cache haben ungeeignete Ressourcengrenzen

**Priorität:** P2 / Availability
**Betroffene Stellen:** `server/index.ts:25-32`, `src/config/schema.ts:9-51`,
`server/config-store.ts:50-77`, `server/proxy.ts:43-81`

**Befund**

`c.req.json()` besitzt kein projektspezifisches Limit; Arrays und Strings sind weitgehend
unbegrenzt. Durch sieben Backups vervielfacht sich der Diskbedarf. Der Proxy-Cache erlaubt
theoretisch 64 Einträge zu knapp 2 MiB, also rund 128 MiB plus Overhead und parallele Kopien in
einem 512-MiB-LXC. Gleichzeitige Requests sind unbegrenzt; URL-Fragmente können identische Inhalte
mehrfach cachen.

**Behebung**

1. Honos vorhandene `bodyLimit`-Middleware vor dem JSON-Parser einsetzen, etwa 512 KiB oder 1 MiB.
2. Strings, Arrays und lokale Config-Dateigröße zusätzlich im Schema/Store begrenzen.
3. Proxy-Cache über ein Gesamtbytebudget von etwa 16–32 MiB statt nur über Eintragszahl steuern.
4. Echte LRU-Eviction verwenden; Cache-Key normalisieren und URL-Fragment entfernen.
5. Gleiche laufende URLs zusammenfassen, `Content-Length` früh prüfen und das Streaming-Limit
   beibehalten.
6. Globale Parallelität einfach begrenzen, ohne eine neue Rate-Limit-Abhängigkeit einzuführen.

**Abnahme/Tests**

- Übergroßer `Content-Length`- und chunked Config-Body liefert 413.
- Übergroße lokale Config wird nicht vollständig eingelesen.
- Proxy überschreitet das Bytebudget nicht und evicted den ältesten Eintrag.
- Äquivalente URL mit Fragment erzeugt keinen zweiten Cacheeintrag.

### F-21 – Deployment ist nicht reproduzierbar und nicht atomar

**Priorität:** P2 / Operations
**Betroffene Stellen:** `deploy/deploy.sh:4-9`, `deploy/dashboard.service:10`, `package.json`

**Befund**

Lokal gilt `pnpm-lock.yaml`, remote läuft jedoch `npm install --omit=dev`; npm verwendet den
pnpm-Lock nicht. Produktion kann somit andere Dependency-Versionen als der getestete Build
erhalten. `npx tsx` kann bei fehlendem Binary einen Netzwerk-Fallback versuchen. Der Deploy-Befehl
führt den Build, aber nicht zwingend die Tests aus.

Rsync und Installation ändern das live bediente Verzeichnis in mehreren Schritten. Währenddessen
kann der alte Prozess bereits neue Assets ausliefern. Es gibt keinen Readiness-Check und keinen
Rollback; Unit-Änderungen werden nicht zuverlässig mit `daemon-reload` übernommen.

**Behebung**

1. `packageManager` und eine unterstützte Node-Version in `package.json` festlegen.
2. Vor Upload immer `pnpm test` und `pnpm build` ausführen.
3. Zielsystem über Corepack/pnpm provisionieren und
   `pnpm install --prod --frozen-lockfile` verwenden.
4. Service direkt über das lokale `node_modules/.bin/tsx` starten.
5. Vollständiges Release in ein Staging-/Release-Verzeichnis kopieren und dort installieren.
6. Erst nach erfolgreicher Vorbereitung atomar auf das neue Release umschalten.
7. Restart, `systemctl is-active`, statische Datei und `/api/health` prüfen; bei Fehler auf das
   vorherige Release zurückschalten.
8. Unit mitsynchronisieren und bei Änderung `daemon-reload` ausführen.

**Abnahme/Tests**

- Frische Produktionsinstallation nutzt exakt den pnpm-Lock.
- Absichtlich fehlschlagender Build/Install verändert das aktive Release nicht.
- Fehlgeschlagener Healthcheck stellt das vorherige Release wieder her.
- Deployment wird in diesem Fix-Auftrag nur ausgeführt, wenn der Benutzer es ausdrücklich
  beauftragt.

### F-22 – Dienstrechte und Environment-Validierung sind zu weit beziehungsweise zu spät

**Priorität:** P2 / Operations und Security
**Betroffene Stellen:** `deploy/provision.sh:13-15`, `deploy/dashboard.service:15-17`,
`server/env.ts:1-12`

**Befund**

`/opt/dashboard` gehört dem Dienstbenutzer und liegt vollständig in `ReadWritePaths`. Damit kann
der Prozess eigenen Code, Dependencies und CA dauerhaft verändern; `ProtectSystem=strict` verliert
für diesen Baum weitgehend seine Wirkung. Environment-Werte wie leerer/`NaN`-Port, leerer Pfad
oder nur teilweise gesetzte PVE-Konfiguration scheitern erst spät und unspezifisch.

**Behebung**

1. Release/Code/Dependencies root-owned und read-only halten.
2. Config und Backups in ein separates schreibbares State-Verzeichnis legen, z. B.
   `/var/lib/dashboard`; nur dieses in `ReadWritePaths` aufnehmen.
3. Sinnvolle Unit-Härtung ergänzen: `ProtectHome=true`, `PrivateDevices=true`, `LimitCORE=0` und
   eine minimale `CapabilityBoundingSet` für Port 80.
4. Eine reine `parseEnv(record)`-Funktion mit dem vorhandenen Zod erstellen:
   - Port `1..65535`,
   - nichtleere Pfade,
   - valide CIDRs,
   - PVE-Felder als All-or-none-Gruppe,
   - PVE-URL ausschließlich HTTPS.
5. Startup-Fehler nennen nur Variablennamen, niemals Werte oder Secrets.

**Abnahme/Tests**

- Synthetische Environments decken leeren, ungültigen und gültigen Fall ab.
- Tests laden keine echte `.env`.
- Laufender Prozess kann Release-Dateien nicht schreiben, Config/Backups aber weiterhin atomar.

### F-23 – Partielle Quellenfehler bleiben unsichtbar

**Priorität:** P2 / Observability und UX
**Betroffene Stellen:** `src/widgets/Agenda.tsx:17-33`, `src/widgets/News.tsx:12-27`

**Befund**

Wenn eine von mehreren Kalender-/Newsquellen fehlschlägt, werden erfolgreiche Ergebnisse
angezeigt und der Status bleibt grün. Benutzer sehen nicht, dass ein Kalender oder Feed fehlt.
Gerade bei Terminen ist ein stilles Teilergebnis riskanter als ein klarer Warnzustand.

**Behebung**

- Fetch-Ergebnis als `{items, failures}` modellieren.
- Erfolgreiche Daten weiterhin anzeigen; bei mindestens einem Fehler Status `warn` setzen.
- Eine knappe deutsche Diagnose mit Quellname, aber ohne sensible URL, anzeigen.
- Wenn alle Quellen scheitern, den vorhandenen Fehlerzustand verwenden.

**Abnahme/Tests**

- Eine Quelle erfolgreich, eine fehlerhaft: Daten sichtbar und Status warn.
- Alle Quellen fehlerhaft: Fehlerzustand.
- Keine Quelle konfiguriert: definierter leerer Zustand, kein Fehler.

### F-24 – Accessibility-Lücken in Settings, Dialogen und MONTH

**Priorität:** P2 / Accessibility
**Betroffene Stellen:** `src/shell/SettingsPane.tsx:45-53`,
`src/shell/SettingsPane.tsx:369-558`, `src/shell/KeymapOverlay.tsx:18-27`,
`src/App.tsx:270-445`, `src/widgets/Month.tsx:30-68`, `src/index.css:450-473`

**Befund**

- Layout-Checkboxen und Breiten-Comboboxen besitzen im Accessibility-Tree keinen Namen.
- Wiederholte Aktionen heißen nur „nach oben“, „nach unten“, „löschen“ und sind nicht einer Zeile
  zuzuordnen.
- `aria-modal` isoliert den Hintergrund nicht; die App bleibt für Assistive Technology sichtbar.
  KEYMAP besitzt keinen Focus-Trap.
- MONTH ist semantisch nur eine Folge generischer Zahlen. Heute und Termintage werden überwiegend
  über Farbe/Unterstreichung vermittelt.
- Kleine Row-Actions unterschreiten auf dem iPhone sinnvolle Touch-Zielgrößen.
- Custom-Checkboxen kommunizieren den Zustand visuell primär über Farbe.

**Behebung**

1. Echte Labels oder kontextspezifische `aria-label`s verwenden, z. B. „CLOCK sichtbar“ und
   „Breite von CLOCK“.
2. `RowActs` ein Kontextlabel übergeben: „Feed heise löschen“.
3. Während eines Dialogs die App `inert` und ergänzend `aria-hidden` setzen; Fokus beim
   Öffnen/Schließen sichern. KEYMAP mit zyklischem Fokus oder textuellem Schließen-Button versehen.
4. MONTH als echte Tabelle mit Caption, Spalten-/Zeilenheadern, vollständigem Datum,
   `aria-current="date"`, Feiertagsname und Terminanzahl auszeichnen.
5. Touch-Ziele mindestens 24×24 px, besser 36–44 px, ohne neue Icons vergrößern.
6. Checkboxzustand zusätzlich durch ein zulässiges Textzeichen und Accessible State vermitteln,
   nicht allein durch Farbe.

**Abnahme/Tests**

- Rollenabfragen finden jede Checkbox/Combobox mit eindeutigem Namen.
- Tab/Shift+Tab verlassen den offenen Dialog nicht; Fokus kehrt zum Auslöser zurück.
- Der heutige Tag besitzt `aria-current=date`; Termin- und Feiertagsinformation werden angesagt.
- Computed Bounding Boxes der Aktionen erfüllen die festgelegte Mindestgröße bei 500 px.

### F-25 – Code, PLAN und verbindliches Mockup sind auseinandergelaufen

**Priorität:** P2 / Governance
**Betroffene Stellen:** `mockup/index.html:345-348`, `src/App.tsx:270-323`,
`src/index.css:128-148`, `src/config/defaults.ts:68-77`, `AGENTS.md`

**Befund**

Die App enthält inzwischen ein bewusst hinzugefügtes MONTH-Pane und geänderte Spaltenbreiten.
Gleichzeitig bezeichnet `AGENTS.md` das alte Mockup weiterhin als verbindlich. Die sichtbare
Topline „dashboard / Datum / KW“ aus dem Mockup fehlt; WEATHER/LINKS-Spans und Grid sind ebenfalls
abweichend. Die Git-Historie zeigt, dass mindestens MONTH absichtlich ergänzt wurde. Luna kann
damit nicht gleichzeitig aktuelle Implementierung und kanonische Vorgabe befolgen.

**Behebung**

Dies ist ein Entscheidungspunkt, kein automatischer Refactor:

1. Benutzer bestätigt, ob das aktuelle MONTH-Layout der neue Sollstand ist.
2. Falls ja: Mockup, PLAN-Nachschlagewerk und AGENTS-Beschreibung auf Pane-Anzahl, Reihenfolge,
   Topline und Spans aktualisieren.
3. Falls nein: App gezielt auf das Mockup zurückführen. MONTH nicht blind entfernen, weil es laut
   Historie eine bewusste Produktänderung war.
4. Die Entscheidung bei 1280, 900 und 500 px manuell abnehmen und dokumentieren.

**Positiver Befund**

Das aktuelle responsive Grid zeigte in allen drei geprüften Breiten 3/2/1 Spalten und keinen
horizontalen Seiten-Overflow.

### F-26 – Kritische Servergrenzen fehlen in Tests

**Priorität:** P2 / Quality Engineering
**Betroffene Stellen:** `server/proxy.test.ts:7-10`, `server/index.test.ts`, `vite.config.ts:8-12`

**Befund**

- Ein Proxy-Test verwendet echtes öffentliches DNS/Internet und ist nicht hermetisch.
- `passWithNoTests: true` lässt auch null entdeckte Tests erfolgreich durchlaufen.
- Server-Tests laufen global in jsdom statt gezielt in Node.
- Der Import von `server/index.ts` kann `server/load-env.ts` und damit die echte lokale `.env`
  laden, obwohl Tests nur synthetische Werte benötigen.
- Produktions-Static-Routen liegen im `isMain`-Pfad und werden durch `app.request` nicht getestet.
- Es fehlen Grenztests für Redirect-Revalidierung, DNS-Pinning, Timeout/2-MiB-Limit,
  MIME-Härtung, Bodylimit, Reachability, PVE-Decoding, Config-CAS, lokale ICS, Import-E2E,
  CommandBar-Touchpfad, Recurrence-Exceptions und Cache-Decoding.

**Behebung**

1. Lookup, Fetch und Uhr minimal injizierbar machen beziehungsweise mit bestehenden Vitest-Mocks
   ersetzen; keine neue Test-Abhängigkeit hinzufügen.
2. App-Factory und ausführbaren Entry-Point trennen, damit Tests künstliche Env/Dependencies nutzen.
3. Server-Testdateien per Vitest-Environment-Kommentar oder Projektkonfiguration in Node ausführen.
4. `passWithNoTests` entfernen.
5. Produktionsrouten unabhängig von `isMain` montieren und über `app.request` testen.
6. Temp-Verzeichnisse in `afterEach` entfernen.

**Abnahme/Tests**

- Testsuite läuft ohne Internet, lokale `.env`, `config.json` oder PVE.
- Ein absichtlich falsches Testmuster ohne Tests schlägt fehl.
- Neue Tests aus F-01 bis F-24 sind deterministisch und parallel ausführbar.

### F-27 – Upstream-204 wird zu 502

**Priorität:** P3 / HTTP-Randfall
**Betroffene Stelle:** `server/index.ts:50-53`

**Befund und Behebung**

`new Response(new Uint8Array(), {status: 204})` wirft, weil 204 keinen Body besitzen darf. Für
Status 101, 204, 205 und 304 `null` statt eines Bytearrays übergeben.

**Test:** Gemockter Upstream-204 bleibt 204 und erzeugt keinen 502.

### F-28 – Unbekannte API-/Static-Routen liefern SPA-HTML mit 200

**Priorität:** P3 / HTTP-Semantik
**Betroffene Stelle:** `server/index.ts:81-83`

**Befund und Behebung**

Der SPA-Fallback beantwortet auch `/api/does-not-exist` und fehlende `/static/*.ics` mit
`index.html`. `/api/*` vor dem SPA-Fallback als JSON-404 abschließen, `/static/*` als 404 und den
SPA-Fallback nur für GET/HEAD auf Frontend-Routen verwenden.

**Tests:** unbekannte API liefert JSON-404; fehlende Static-Datei 404; Clientroute liefert weiter
`index.html`.

### F-29 – Ortssuche unterscheidet HTTP-Fehler nicht von „nicht gefunden“

**Priorität:** P3 / UX
**Betroffene Stelle:** `src/shell/SettingsPane.tsx:162-176`

**Befund und Behebung**

`res.ok` wird nicht geprüft. Ein 403/500-JSON ohne `results` erscheint als „Ort nicht gefunden“.
Vor dem Parsen HTTP-Status prüfen, Felder/Koordinaten validieren und Netzwerkfehler als
„Ortssuche fehlgeschlagen“ von einem echten leeren 200-Ergebnis unterscheiden.

**Tests:** 403/500, 200 ohne Treffer und 200 mit ungültigen Koordinaten getrennt abdecken.

### F-30 – Suchvorschau und Enter-Verhalten widersprechen sich

**Priorität:** P3 / UX
**Betroffene Stellen:** `src/lib/fuzzy.ts:20-25`, `src/shell/CommandBar.tsx:39-67`,
`src/shell/CommandBar.tsx:99-107`

**Befund und Behebung**

Whitespace wird für Anzeige und Ausführung unterschiedlich normalisiert. Jede Eingabe mit `!`
wird als Bang bezeichnet, obwohl unbekannte/unvollständige Bangs tatsächlich zur Standardsuche
fallen. Query einmal normalisieren und für Vorschau/Ausführung teilen; Bang-Text nur bei einem
vollständigen, vorhandenen Bang zeigen.

**Tests:** `" dat "` und `"dat"` zeigen denselben Treffer; unbekannter Bang wird als
Standardsuche bezeichnet.

### F-31 – „Nicht konfiguriert“ wird als „veraltet“ angesagt

**Priorität:** P3 / Accessibility
**Betroffene Stellen:** `src/App.tsx:407-410`, `src/shell/StatusLine.tsx:26-30`,
`src/shell/StatusLine.tsx:64`

**Befund und Behebung**

`configured:false` wird auf `warn` gemappt, dessen Accessible Name fest „veraltet“ lautet. Einen
eigenen semantischen Zustand `unconfigured` oder einen expliziten Beschreibungstext pro Quelle
zulassen. Die Warnfarbe darf bleiben; die angesagte Information muss korrekt sein.

### F-32 – Repo-Hygiene und Settings-Hotspot

**Priorität:** P3 / Wartbarkeit
**Betroffene Stellen:** `.claude/settings.local.json`, `deploy/provision-mpd.sh`,
`src/shell/SettingsPane.tsx`

**Befund**

- Eine lokale Claude-Settings-Datei mit absoluten Benutzerpfaden ist versioniert.
- `deploy/provision-mpd.sh` blieb nach dem vollständigen Musik-Rollback im Dashboard-Repo.
- `SettingsPane.tsx` ist mit rund 700 Zeilen ein Hotspot; Validierung ist teilweise dupliziert.
- `move` umgeht `noUncheckedIndexedAccess` per `as T`.

**Behebung**

- Dateien nicht blind löschen: erst klären, ob die Claude-Einstellung bewusst teamweit und das
  MPD-Skript als historische Referenz gewünscht ist; sonst untracken/archivieren und passend
  ignorieren.
- Fachliche Validierung in das zentrale Schema verschieben. UI-Helfer nur dort aufteilen, wo es
  klare, bestehende Abschnitte gibt; keine neue Architektur- oder Form-Library.
- Arrayelemente vor dem Swap explizit prüfen.

## 7. Empfohlene Umsetzungsreihenfolge für Luna Max

Luna Max soll nicht alle Findings in einem unprüfbaren Groß-Commit bearbeiten. Empfohlen sind
kleine, in sich testbare Pakete. Nach jedem Paket gelten zwingend `pnpm test` und `pnpm build`.

### Paket A – Sicherheits- und Datenintegritätsgrenzen

1. F-02 atomare Config-Transaktion und eindeutige Temp-Dateien.
2. F-03 saubere Config-Fehlersemantik.
3. F-04 konfliktfestes Settings-Verhalten.
4. F-05 funktionierender, weiterhin CAS-geschützter Import.
5. F-01 inerte Proxy-Antworten.

**Exit-Kriterium:** Parallel-PUT-Test, Recovery-Tests, Restore-E2E und Proxy-MIME-Test grün.

### Paket B – Config- und Netzwerkvalidierung

1. F-07 zentrale semantische Zod-Invarianten.
2. F-06 sicherer lokaler Kalenderpfad und getrennte Static-Route.
3. F-19 Host-/Origin-Härtung.
4. F-20 Body- und Ressourcengrenzen.
5. F-28 korrekte 404-Semantik.

**Exit-Kriterium:** Kein direkter Browser-Fremdrequest; Traversal, Oversize und fremde Origins sind
getestet abgewiesen.

### Paket C – Kalender- und Frontend-Korrektheit

1. F-08 Recurrence-Exceptions.
2. F-10 gemeinsamer Datumsbereich und Overlap.
3. F-09 Touch-/Maus-CommandBar.
4. F-11 sofortige Config-Revalidierung.
5. F-12 bis F-16 sowie F-23 nach Risikoreihenfolge.

**Exit-Kriterium:** Restore, Touch-Settings, Monatsende, verschobene/abgesagte Serie und
Over-Midnight-Termin sind automatisiert abgedeckt.

### Paket D – Homelab, Cache und externe Daten

1. F-17 revisionssensitiver Single-Flight-Cache.
2. F-18 fehlender Gast und geprüfte Backup-Task-Semantik.
3. F-14 Trust-Boundary- und Cache-Decoder.
4. Last-known-good nur ergänzen, wenn die einfache Variante stabil ist.

**Exit-Kriterium:** Parallele Requests erzeugen einen Fetch; fehlende Gäste alarmieren; malformed
200-/Cache-Daten crashen nicht.

### Paket E – Betrieb, Accessibility und Dokumentation

1. F-26 hermetische Tests als Voraussetzung für den Deploymentumbau.
2. F-21 reproduzierbares, atomares Deployment.
3. F-22 Service-/Env-Härtung.
4. F-24 Accessibility.
5. F-25 erst nach Produktentscheidung zu Mockup/MONTH.
6. P3-Punkte und Repo-Hygiene zum Schluss.

**Exit-Kriterium:** Tests benötigen keine echte Infrastruktur; Release kann sicher gerollt werden;
Dialoge und Layoutcontrols sind per Tastatur und Screenreader eindeutig bedienbar.

## 8. Arbeitsregeln für Luna Max

1. Vor Beginn `AGENTS.md` und den vollständigen relevanten Abschnitt aus `PLAN.md` lesen.
2. `.env`, `config.json` und `pve-ca.pem` weder lesen noch ausgeben.
3. Keine neuen Abhängigkeiten, Icons, Emojis, Farbwerte oder Frameworks ergänzen.
4. Jede Behebung zuerst mit einem reproduzierenden Test absichern, dann minimal implementieren.
5. Keine Architekturänderung, Datenbank oder neue Authentisierung einführen.
6. Nach jedem Paket:
   - `pnpm test`
   - `pnpm build`
   - `git diff --check`
7. Bestehende Benutzeränderungen und nicht zugehörige Dateien nicht anfassen.
8. Deployment nur nach ausdrücklicher Benutzerfreigabe ausführen.
9. Bei F-25 die Designentscheidung einholen; MONTH nicht eigenmächtig entfernen oder das Mockup
   still umdeuten.

## 9. Sinnvolle Feature-Erweiterungen – erst nach den Fixes

Die folgenden Erweiterungen bleiben innerhalb des ausdrücklich erlaubten Projektumfangs.

### 9.1 Konfigurierbare Agenda-Reichweite

Das Feld „Tage im Voraus“ existiert bereits im verbindlichen Mockup, im Code sind vier Tage fest
verdrahtet. Ein Configfeld mit Default 4 und sinnvoller Obergrenze behebt zugleich F-10.

**Akzeptanz:** Alt-Configs migrieren auf 4; Fetch- und Filterbereich folgen dem Feld; Monatsende- und
Obergrenzentests sind vorhanden.

### 9.2 Konfigurierbare Feiertagsregion

Diese Erweiterung behebt F-16 und macht den freien Ort fachlich konsistent. Ein kleines Enum reicht;
es ist keine externe Feiertagsbibliothek nötig.

### 9.3 Geheimnisfreier `/api/health`-Endpunkt

Liveness/Readiness für Uptime Kuma: Prozess läuft, Config ist lesbar, Zeitpunkt des letzten
erfolgreichen Homelab-Fetches. Keine URLs, Tokens, Config-Inhalte oder internen Fehlerdetails
ausgeben. Dieser Endpunkt ermöglicht F-21s Deployment-Healthcheck.

### 9.4 Last-known-good für Homelab

Bei kurzem PVE-Ausfall den letzten erfolgreichen Stand mit `stale: true` und `fetchedAt` anzeigen,
statt die gesamte Pane zu leeren. Der Status muss deutlich warnen; alte Daten nie als frisch
ausgeben.

### 9.5 Config-Backup-Restore

Die bereits vorhandenen `.1` bis `.7`-Backups könnten über die Settings wiederherstellbar werden.
Der Restore bleibt durch Write-Guard und `If-Match` geschützt und verlangt eine ausdrückliche
Bestätigung. Niemals Backup-Inhalte ungefragt über einen offenen Endpunkt listen.

### 9.6 Diagnoseansicht

Ein Kommando wie `:diagnostics` kann pro Quelle letzten Erfolg/Fehlerklasse, Cachealter und Dauer
anzeigen. Keine Ziel-URLs, IPs oder Secrets ausgeben. Dies hilft bei F-23 und Betriebssuche.

### 9.7 CommandBar als zugängliche Combobox

Treffer mit Pfeiltasten oder `j/k` auswählen, mit Enter öffnen und auch per Touch anklicken.
Semantik über `combobox`, `listbox` und `option`; keine UI-Library nötig. `cfg` kann zusätzlich eine
textuelle Settings-Schaltfläche werden.

## 10. Ausdrücklich nicht in diesen Fix-Zyklus aufnehmen

Gemäß `AGENTS.md`/`PLAN.md`: Pi-hole-Widget, Docker, HTTPS, externer Zugriff, Login,
Microsoft Graph/OAuth, Datenbank, To-dos, Notizen, Drag-and-drop, Multi-Profile,
Browser-Erweiterungen, SMART-Werte, Speedtest und Graphen pro Gast. Auch pauschale Major-Upgrades
von Zod/Tailwind sind nicht erlaubt; der Produktionsaudit zeigt aktuell keine bekannte
Schwachstelle, die dies rechtfertigen würde.

## 11. Verifizierte Stärken

- Klare Ein-Prozess-Architektur ohne unnötige Schichten.
- Gute SSRF-Grundlage: exakte Allowlist, private IPv4-/IPv6-Sperren, Redirect-Revalidierung und
  DNS-Pinning; kein bestätigter SSRF-Bypass.
- Proxmox-Token bleibt serverseitig; eigene CA und Servername werden geprüft.
- Keine getrackte `.env`, `config.json` oder PVE-CA und kein gefundener Secret-Leak.
- Strict TypeScript, zentrale Config-Typen und viele gut testbare reine Funktionen.
- `buildHomelab`, Parsergrundlagen, Keymap und Kontrastlogik sind breit getestet.
- Offline-Cache und explizite Date-Reviver sind konzeptionell sinnvoll.
- CSS-Tokens und automatisierte WCAG-AA-Prüfung entsprechen den Projektregeln.
- Responsive Darstellung bei 500/900/1280 px ohne horizontalen Seiten-Overflow.
- Keine bekannten Schwachstellen in Produktionsabhängigkeiten.

## 12. Definition of Done für den gesamten Fix-Auftrag

Der Fix-Auftrag ist erst abgeschlossen, wenn:

- alle P1-Findings automatisiert reproduziert und behoben sind,
- keine Config durch Parallelität, 409-Retry oder Import unbemerkt überschrieben werden kann,
- lokale/externe Kalender die Browser-Netzwerkregel einhalten,
- Recurrence-Ausnahmen, Monatsende und überlappende Termine korrekt sind,
- Proxy-Inhalte nicht als aktives Same-Origin-Dokument ausführbar sind,
- zentrale Config- und Trust-Boundary-Validierung direkte API-/Importpfade einschließt,
- die relevanten P2-Findings mindestens aus den Paketen B bis D behoben sind,
- `pnpm test`, `pnpm build` und `git diff --check` grün sind,
- die Abnahme bei 500, 900 und 1280 px wiederholt wurde,
- Luna Max eine kurze Zuordnung „Finding → Änderung → Test“ dokumentiert,
- und kein Deployment ohne ausdrückliche Freigabe erfolgt ist.
