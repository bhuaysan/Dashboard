# Codebase-Re-Audit: Pakete A–E

Stand: 8. August 2026
Geprüfter Bereich: `b533d46..9af4747`
Vorgängerbericht: [`CODEBASE_AUDIT.md`](CODEBASE_AUDIT.md)
Umsetzungsprotokoll von Paket E: [`PHASE_E.md`](PHASE_E.md)

## 1. Zweck und Arbeitsauftrag für Luna Max

Dieses Dokument prüft die Umsetzung der Pakete A bis E aus `CODEBASE_AUDIT.md`. Es ersetzt den
ursprünglichen Auditbericht nicht, sondern beschreibt ausschließlich den Zustand **nach** Lunas
erster Reparaturrunde.

Die Reparaturrunde hat große Teile des Audits korrekt umgesetzt, ist aber noch nicht vollständig
abnahmefähig. Luna Max soll die unten beschriebenen Restarbeiten in der angegebenen Reihenfolge
erledigen. Vor jeder Änderung gelten weiterhin `AGENTS.md`, der relevante vollständige Abschnitt
aus `PLAN.md` und die harten Projektregeln.

Wichtig:

- `.env`, `config.json` und `pve-ca.pem` nicht lesen, ausgeben oder committen.
- Kein Deployment ohne ausdrückliche Freigabe des Benutzers.
- Keine neuen Dependencies, Frameworks oder Architekturwechsel.
- Nach jedem abgeschlossenen Restpaket `pnpm test`, `pnpm build` und `git diff --check` ausführen.
- Jeden Bug zuerst mit einem reproduzierenden Test absichern.
- F-25 nicht ohne Produktentscheidung verändern.

## 2. Kurzfazit

**Gesamtbewertung: 7,8/10 – deutlich verbessert, aber noch keine vollständige Audit-Abnahme.**

Strenge Statusmatrix:

| Status | Anzahl | Findings |
| --- | ---: | --- |
| Behoben | 21 | F-01–F-06, F-09–F-13, F-15–F-18, F-23, F-27–F-31 |
| Teilweise behoben | 9 | F-07, F-08, F-14, F-19, F-20, F-21, F-24, F-26, F-32 |
| Bewusst offen | 1 | F-25 |
| Neue Regression innerhalb eines Findings | 1 | F-22: fehlendes PVE-Secret verhindert jetzt den Serverstart |

Vier P1-Blocker verhindern die Freigabe:

1. Ein fehlendes `PVE_TOKEN_SECRET` legt den gesamten Dienst still.
2. Eine minimale abgesagte `RECURRENCE-ID`-Exception kann die komplette Kalenderquelle zerstören.
3. Das Recurrence-Limit blockiert den Browser und liefert anschließend still unvollständige Daten.
4. `homelab.node` akzeptiert Pfad-, Query- und Traversalbestandteile.

## 3. Ausgeführte Verifikation

| Prüfung | Ergebnis |
| --- | --- |
| `pnpm test` | 34 Testdateien, 266/266 Tests grün |
| `pnpm build` | erfolgreich |
| `git diff --check` | erfolgreich |
| `bash -n deploy/deploy.sh deploy/provision.sh` | erfolgreich |
| Serverfokussierte Tests | 83/83 grün |
| Browserabnahme bei 500, 900 und 1280 px | durchgeführt |
| Browser-Konsole | keine Fehler oder Warnungen |
| Paralleler Hermetiktest | 9 von 34 Servertests fehlgeschlagen |
| Deployment | bewusst nicht ausgeführt |

Der grüne Standardlauf reicht nicht für die Abnahme: Mehrere Restfehler wurden mit gezielten
Grenzfällen reproduziert, die in der normalen Testsuite fehlen.

Der reproduzierbare Paralleltest lautet:

```bash
pnpm vitest run server/config-store.test.ts server/index.test.ts \
  --sequence.concurrent --sequence.shuffle.tests --sequence.seed=42
```

## 4. Paketbewertung

| Paket | Bewertung | Status | Begründung |
| --- | ---: | --- | --- |
| A – Sicherheit und Datenintegrität | 9,2/10 | Fachlich abgenommen | Config-CAS, atomare Tempdateien, Recovery, Konfliktverhalten, Importrevision und inerte Proxy-Antworten sind umgesetzt. Ein vollständiger Import-UI-Test fehlt noch unter F-26. |
| B – Config und Netzwerk | 6,8/10 | Nicht abgenommen | Lokale ICS und 404-Semantik funktionieren. Schema, echte Same-Origin-Prüfung und mehrere Proxy-Ressourcengrenzen bleiben unvollständig. |
| C – Kalender und Frontend | 7,4/10 | Nicht abgenommen | Die meisten Frontendfehler sind behoben. Zwei reproduzierbare Recurrence-Fehler bleiben P1. |
| D – Homelab und Trust Boundaries | 8,5/10 | Mit Nacharbeiten | Revisionscache, Single-Flight, fehlende Gäste und Upstream-Decoder sind gut umgesetzt. Client-Cache-Hygiene bleibt teilweise offen. |
| E – Betrieb, Accessibility und Dokumentation | 6,1/10 | Nicht abgenommen | Gute App-Fabrik und Service-Härtung, aber PVE-Startup-Regression, ungetesteter Rollback, fehlender Frontend-Healthcheck, nicht parallele Tests und A11y-Restfehler. |

## 5. P1-Blocker

### R-01 – Fehlendes PVE-Secret verhindert den Serverstart

**Zuordnung:** F-22, neue Regression
**Stellen:** `server/env.ts:108-126`, `server/env.test.ts`
**Auswirkung:** kompletter Dienst nicht verfügbar

`parseEnv` startet die PVE-Gruppenvalidierung, sobald irgendeines der Felder `PVE_URL`,
`PVE_TOKEN_ID`, `PVE_TOKEN_SECRET` oder `PVE_CA_PATH` gesetzt ist. In einer normalen
„nicht konfiguriert“-Situation bleiben URL, ID und CA-Pfad bestehen, während nur das Secret fehlt.
Der Server wirft dann beim Start einen `EnvironmentError`.

Das widerspricht `AGENTS.md`, `PLAN.md` und `README.md`: Ein fehlendes Secret muss den gültigen
Zustand `configured: false` erzeugen.

**Behebung**

1. `const secret = record.PVE_TOKEN_SECRET?.trim() ?? ""` separat bestimmen.
2. Wenn `secret === ""`, kein `pveEnvironmentSchema` ausführen und `pve` auf `undefined` lassen.
3. Nur wenn das Secret nichtleer ist, URL, Token-ID und CA-Pfad vollständig und semantisch prüfen.
4. In Fehlermeldungen weiterhin ausschließlich Variablennamen nennen.

**Pflichttests**

- Secret leer, andere PVE-Felder gesetzt → `parseEnv` ist erfolgreich und liefert kein `pve`.
- Alle PVE-Felder leer → erfolgreich, kein `pve`.
- Secret gesetzt, URL/ID/CA fehlt → klarer Startup-Fehler.
- Vollständige gültige Gruppe → `pve` vorhanden.
- Kein Test lädt die echte `.env`.

### R-02 – Minimale abgesagte Serienexception zerstört die Kalenderquelle

**Zuordnung:** F-08
**Stellen:** `src/lib/ics.ts:61-81`, `src/lib/ics.test.ts`
**Auswirkung:** alle Termine einer Quelle verschwinden

Eine gültige Exception kann nur `UID`, `RECURRENCE-ID` und `STATUS:CANCELLED` enthalten. Ohne
`DTSTART`/`DTEND` wirft ical.js in `getOccurrenceDetails()`, bevor der aktuelle Code
`isCancelled(item)` erreicht. `fetchEvents` behandelt daraufhin die gesamte Quelle als fehlerhaft.

**Behebung**

1. Exceptions einer UID vor dem Erzeugen des Master-Events in aktiv und abgesagt aufteilen.
2. Für abgesagte Exceptions die normalisierte `RECURRENCE-ID` in einem `Set` halten.
3. Nur aktive Exceptions an `new ICAL.Event(master, { exceptions })` übergeben.
4. Im Iterator vor `getOccurrenceDetails(next)` prüfen, ob `next` im Cancellation-Set liegt.
5. Nur diese Instanz überspringen; alle anderen Instanzen der Serie müssen erhalten bleiben.

**Pflichttests**

- Masterserie mit zwei Instanzen und minimaler abgesagter Exception ohne `DTSTART`/`DTEND`.
- Genau die abgesagte Instanz fehlt; die andere bleibt erhalten.
- Verschobene aktive Exception verwendet weiterhin Titel und Zeit der Exception.
- Verwaiste `RECURRENCE-ID` ohne Master bleibt ignoriert.

### R-03 – Recurrence-Budget liefert still falsche Ergebnisse

**Zuordnung:** F-08
**Stellen:** `src/lib/ics.ts:30`, `src/lib/ics.ts:68-85`, `src/lib/ics.test.ts`
**Auswirkung:** Main-Thread-Blockade und fehlende Termine ohne Warnung

Die Expansion beginnt am Serienanfang und läuft synchron bis `MAX_OCCURRENCES = 100_000`. Eine
alte minütliche, stündliche oder sekündliche Serie kann das Limit erreichen, bevor der aktuelle
Abfragezeitraum erreicht ist. Der Code gibt dann einfach eine leere oder partielle Liste zurück;
die Quelle bleibt fälschlich grün.

Reproduziert wurden sowohl eine alte stündliche Serie mit mehreren Sekunden Laufzeit als auch eine
sekündliche Serie mit deutlich wahrnehmbarer Main-Thread-Blockade und null aktuellen Ergebnissen.

**Behebung**

1. Nie still partielle Daten zurückgeben, wenn das Budget vor `expansionTo` erschöpft ist.
2. Ein kleines Operationsbudget mit einem Zeitbudget kombinieren.
3. Bei Budgetüberschreitung einen spezifischen Parse-/Expansionfehler werfen.
4. Diesen Fehler über `fetchEvents` als Quellenfehler beziehungsweise Warnstatus anzeigen.
5. Eine mögliche Seek-Optimierung nur verwenden, wenn Tests beweisen, dass Serienanker,
   Zeitzone, Uhrzeit und Exceptions erhalten bleiben. `event.iterator(from)` darf nicht ungeprüft
   eingesetzt werden, weil ical.js damit den Serienanker verändern kann.

**Pflichttests**

- Alte `SECONDLY`-/`MINUTELY`-Serie überschreitet das Budget deterministisch und sichtbar.
- Alte `HOURLY`-Serie darf keine still leere Erfolgsantwort liefern.
- Alte tägliche Serie funktioniert weiterhin.
- Eine Exception mit ursprünglicher Instanz außerhalb, aber verschobenem Termin innerhalb des
  Fensters wird weiterhin gefunden.
- Test besitzt keine fragile absolute Millisekunden-Schranke; das Operationsbudget selbst muss
  deterministisch prüfbar sein.

### R-04 – `homelab.node` kann PVE-API-Pfade verändern

**Zuordnung:** F-07
**Stellen:** `src/config/schema.ts:145-147`, `server/pve.ts:257-266`
**Auswirkung:** Homelab-Endpunkt liefert 502 oder fragt falsche PVE-Pfade ab

Das Schema behandelt den Node-Namen als allgemeinen Text. Werte wie `../cluster`, `pve?x=1` oder
`pve/../../nodes` sind schema-valide und werden direkt in mehrere PVE-Pfade eingesetzt.

**Behebung**

1. Eine enge Node-Namensregel im zentralen Schema definieren, beispielsweise DNS-/Proxmox-Label
   ohne Slash, Backslash, Punktsegmente, Query oder Fragment.
2. Beim Pfadbau zusätzlich `encodeURIComponent(node)` verwenden. Schema und Encoding erfüllen
   unterschiedliche Schutzaufgaben und sollen beide bestehen bleiben.
3. Direkten API-PUT und Config-Import mit ungültigen Node-Namen ablehnen.

**Pflichttests**

- Gültig: `pve`, ein fachlich erlaubter Hostname mit Bindestrich.
- Ungültig: `/`, `..`, `../cluster`, `pve?x=1`, `pve#x`, Backslash und Leerzeichen.
- Der erzeugte PVE-Pfad enthält ausschließlich das kodierte Node-Segment.

## 6. P2-Restarbeiten

### R-05 – Proxy-Ressourcensteuerung ist nur teilweise umgesetzt

**Zuordnung:** F-20 und F-26
**Stellen:** `server/proxy.ts:48-55`, `server/proxy.ts:104-117`, `server/proxy.ts:147-192`

Bestätigte Restpunkte:

- Gleiche parallele Cache-Misses erzeugen mehrere Upstream-Requests.
- Die Semaphore gibt ein Permit nicht atomar an einen Wartenden weiter. Ein neuer Request kann sich
  zwischen `inFlight -= 1` und dem Wiederanlauf des Wartenden einschieben; das Maximum kann dadurch
  überschritten werden.
- Die Warteschlange ist unbegrenzt.
- DNS-Auflösung liegt außerhalb der 5-Sekunden-Fetch-Deadline.
- Ein zu großer oder ungültiger `Content-Length` wirft, ohne den Response-Body zu canceln.
- Tests für Redirect-Revalidierung, Redirectlimit, DNS-Pinning, Timeout, gestreamte
  Größenüberschreitung und Parallelitätsmaximum fehlen.

**Behebung**

1. Nach URL-Normalisierung und Allowlist-Prüfung eine `Map<string, Promise<ProxyResult>>` führen.
2. Gleiche laufende URL-Promises teilen und den Eintrag in `finally` entfernen.
3. Semaphore als direkte Permit-Übergabe implementieren: Wenn ein Wartender existiert, bleibt das
   Permit belegt und wird direkt übergeben; sonst erst `inFlight` reduzieren.
4. Warteschlange begrenzen und bei Überlast eine definierte 503-Antwort liefern.
5. Eine Gesamtablaufzeit um DNS, Redirects und Fetch legen.
6. Vor frühem Throw den Body best-effort canceln.

**Pflichttests**

- 20 gleiche parallele URLs → exakt ein Upstream-Fetch.
- Unterschiedliche URLs → maximal acht aktive Operationen.
- Ein später eintreffender Request kann keinen wartenden Request überholen und das Limit sprengen.
- Hängendes DNS endet definiert.
- Zu großer deklarierter und gestreamter Body wird abgebrochen und gecancelt.
- Jede Redirect-Stufe wird erneut gegen Allowlist und private Ziele geprüft.

### R-06 – Config-Bodylimit und Dateilimit widersprechen sich

**Zuordnung:** F-20
**Stellen:** `server/app.ts:111-130`, `server/config-store.ts:157-165`

Eine gültige kompakte Config kann knapp unter dem 512-KiB-Bodylimit liegen, durch eingerückte
Serialisierung aber über das Store-Limit wachsen. Reproduziert: kompakt 514.669 Bytes, eingerückt
526.015 Bytes. Der Store rotiert Backups vor der abschließenden Größenablehnung und die API meldet
irreführend 503.

**Behebung**

1. Die endgültig zu speichernde Darstellung vor jeder Backup-Rotation serialisieren.
2. Ihre Byteanzahl vor jeder Dateimutierung prüfen.
3. Alternativ kompakt speichern, wenn Lesbarkeit der Produktionsdatei nicht gefordert ist.
4. Eine Größenüberschreitung als Clientfehler 413 oder 400 modellieren, nicht als 503.
5. Bei Ablehnung weder Config noch Backups verändern.

### R-07 – Write-Guard prüft keine vollständige Origin

**Zuordnung:** F-19
**Stellen:** `server/write-guard.ts:39-69`, `server/write-guard.test.ts:38-44`

Scheme und Port werden verworfen. Dadurch gelten beispielsweise verschiedene Ports oder HTTP und
HTTPS desselben Hostnamens als Same-Origin. Ein fehlender `Host` wird für Schreibrequests ebenfalls
nicht abgelehnt.

**Behebung**

1. Für Produktion Scheme, normalisierten Host und effektiven Port vergleichen.
2. Erlaubte Vite-Dev-Origin ausdrücklich und eng modellieren, statt jeden Port zu akzeptieren.
3. Schreibrequest ohne `Host` ablehnen; ein CLI-Request ohne `Origin` bleibt bei gültigem `Host`
   und erlaubter Socket-IP möglich.
4. Cross-Port-, Cross-Scheme-, fehlender-Host- und legitime Dev-/Produktionsfälle testen.

### R-08 – Deployment ist nicht funktional abgenommen

**Zuordnung:** F-21, F-22 und F-26
**Stellen:** `deploy/deploy.sh:54-125`, `deploy/provision.sh:11-17`

Bestätigte Restpunkte:

- Healthcheck prüft systemd und `/api/health`, aber kein Frontend.
- Alte und fehlgeschlagene Releases werden nie bereinigt.
- Rollback entfernt die fehlgeschlagene Temp-Unit und das neue Release nicht zuverlässig.
- Provisioning installiert Node 22 nur, wenn überhaupt kein Node vorhanden ist; ein vorhandenes
  Node 18 bleibt bestehen.
- `rsync -a` garantiert ohne `--chown` beziehungsweise nachträgliches `chown` keine root-owned
  Release-Dateien.
- Rollback und fehlgeschlagener Install wurden nur statisch, nicht funktional getestet.

**Behebung**

1. Zusätzlich `/` oder `/index.html` abrufen und einen erwarteten HTML-/Build-Marker prüfen.
2. Nach erfolgreicher Aktivierung nur aktuelles Release plus ein bis zwei Rollback-Releases
   behalten. Ziele vor Löschung exakt auflösen und validieren.
3. Im Rollback fehlgeschlagenes Release, `.next`-/`.rollback`-Links und Temp-Unit entfernen.
4. Node-Major prüfen und bei falscher Version gezielt auf die unterstützte Version aktualisieren.
5. Release nach Upload/Installation auf `root:root` setzen und group/world-writable Dateien
   ablehnen.
6. Release-Ablauf mit lokalen Fakes für `systemctl`, `curl`, Symlinks und Installfehler testen.

Kein echter Deploy gehört zur Behebung, solange der Benutzer ihn nicht ausdrücklich beauftragt.

### R-09 – Servertests sind nicht parallel hermetisch

**Zuordnung:** F-26
**Stellen:** `server/config-store.test.ts:9-20`, `server/index.test.ts:10-33`

Die Dateien verwenden jeweils ein gemeinsames Temp-Verzeichnis und einen gemeinsamen Store
beziehungsweise eine gemeinsame App aus `beforeAll`. Bei concurrent/shuffle verändern Tests
denselben Zustand; 9 von 34 Tests schlagen fehl.

**Behebung**

1. Pro Test in `beforeEach` ein neues Temp-Verzeichnis und eine neue App beziehungsweise einen
   neuen Store erzeugen.
2. In `afterEach` ausschließlich dieses Verzeichnis entfernen.
3. Keine globale veränderliche Config zwischen Tests teilen.
4. Den oben dokumentierten concurrent/shuffle-Befehl als regelmäßige Abnahme aufnehmen.

Weitere F-26-Testlücken:

- kein integrierter Proxy-Test für Redirect, Timeout, DNS-Pinning und Streaming-Limit,
- kein `server/reachability.test.ts`,
- keine expliziten `EACCES`-/`EIO`-Storetests,
- kein funktionaler Deploy-/Rollbacktest,
- kein vollständiger Import-UI-Test für Erfolg, 409 und 5xx,
- kein positiver Test, dass eine gültige SPA-Clientroute weiterhin `index.html` liefert,
- kein App-Test für partiellen Kalender-/News-Ausfall in Pane und Statusline.

### R-10 – Mobile Settings und Focus-Trap bleiben fehlerhaft

**Zuordnung:** F-24
**Stellen:** `src/index.css:437-453`, `src/shell/SettingsPane.tsx:159-177`,
`src/shell/SettingsPane.tsx:427-458`

Bei 500 px besitzen drei Row-Actions zusammen etwa 7,45 rem Mindestbreite, ihre Grid-Spalte aber
nur `7ch`. Im Browser überdecken die ersten beiden Buttons die URL-Eingabe. Es besteht zwar kein
Dokument-Overflow, aber eine echte geometrische Überlagerung.

Der Focus-Trap selektiert außerdem `button:not([disabled])` unabhängig von `tabIndex=-1`. Nach dem
Wechsel auf einen späteren Settings-Tab kann seine berechnete Fokusreihenfolge von der echten
Tabreihenfolge abweichen. Wiederholte Zeileneingaben heißen weiterhin nur „Kürzel“, „Name“ oder
„URL“ und sind für Screenreader nicht eindeutig.

**Behebung**

1. Action-Spalten auf mindestens `7.5rem`/`max-content` verbreitern oder Actions am schmalen
   Breakpoint in eine eigene Zeile verschieben.
2. Focusable-Liste zusätzlich auf `element.tabIndex >= 0` und tatsächliche Sichtbarkeit filtern.
3. Eingaben mit Zeilenkontext benennen, beispielsweise „URL von Datasphere“.
4. Focus-Trap nach Wechsel auf einen nicht ersten Tab testen.
5. Browser-Geometrietest bei 500 px: Buttons mindestens 36 × 36 px, keine Überlappung, kein
   horizontaler Dokument-Overflow.

### R-11 – Client-Cache-Hygiene ist unvollständig

**Zuordnung:** F-14
**Stellen:** `src/api/useCachedQuery.ts:20-30`, `src/api/useCachedQuery.ts:60-63`

- Ein gültiger Envelope mit einem Zeitstempel weit in der Zukunft gilt als frisch.
- Alte Query-Key-Varianten durch andere Kalenderbereiche, Feeds oder Orte werden nicht begrenzt
  entfernt und sammeln sich dauerhaft in `localStorage`.

**Behebung**

1. Timestamps oberhalb `Date.now()` plus kleiner Uhrtoleranz ablehnen und den Eintrag löschen.
2. Nur Keys mit dem eigenen `dashboard:cache:`-Präfix nach Alter und/oder Höchstanzahl bereinigen.
3. Fremde Local-Storage-Einträge niemals verändern.
4. Tests für Zukunftstimestamp, mehrere alte Dashboard-Keys und einen fremden Key ergänzen.

### R-12 – Weitere Schema-Invarianten

**Zuordnung:** F-07
**Stellen:** `src/config/schema.ts:69-92`, `src/config/schema.ts:144`

- Link-Hints erlauben ein oder zwei beliebige alphanumerische Zeichen. Die Keymap kann fachlich
  nur `g` plus ein Zeichen auslösen.
- Das Hostschema akzeptiert Großschreibung und sogar `-`. `URL.hostname` normalisiert dagegen auf
  lowercase, während der Proxy exakt gegen die Allowlist vergleicht. Eine schema-valide Allowlist
  kann daher zur Laufzeit abgelehnt werden.

**Behebung**

1. Hint zentral auf `^g[A-Za-z0-9]$` begrenzen.
2. DNS-Labels korrekt validieren: keine leeren Labels, keine führenden/abschließenden Bindestriche,
   Gesamtlänge und Labellängen begrenzen.
3. Allowlist-Hosts zentral lowercase kanonisieren oder nichtkanonische Eingaben klar ablehnen.
4. Schema-, Import-, Direkt-PUT- und Proxyvergleichstests ergänzen.

### R-13 – Dokumentation und harte TypeScript-Regel

**Zuordnung:** F-06, F-26 und F-32

- `PLAN.md:869-873` nennt für lokale ICS noch `/opt/dashboard/static`, während Produktion
  `/var/lib/dashboard/static` verwendet. Wer der kanonischen Anleitung folgt, legt Dateien erneut
  am falschen Ort ab.
- `src/shell/SettingsPane.test.tsx:15-17` verwendet `as unknown as SaveConfig` und verstößt damit
  gegen die harte Regel, Typfehler nicht per Assertion wegzudrücken.
- `SettingsPane.tsx` ist auf 791 Zeilen angewachsen.

**Behebung**

1. Alle Dokumentationsstellen auf `/var/lib/dashboard/static` vereinheitlichen.
2. `SaveConfig` in `SettingsPane.tsx` als minimales, tatsächlich benötigtes Interface aus
   `mutate` und `isPending` definieren. Der Testfake kann es danach ohne Doppel-Cast erfüllen.
3. `SettingsPane` nur entlang bereits vorhandener fachlicher Abschnitte aufteilen und nur dann,
   wenn dies die verbleibenden Fixes vereinfacht. Keine Form-Library oder neue Architektur.

## 7. Bewusst offene Entscheidungen

### F-25 – Mockup gegenüber aktuellem MONTH/Layout

`PHASE_E.md` dokumentiert korrekt, dass die Entscheidung weiterhin fehlt. Das verbindliche Mockup
und die aktuelle App unterscheiden sich bei Topline, MONTH und Spaltenlayout.

Luna Max darf ohne Benutzerentscheidung weder MONTH entfernen noch Mockup, PLAN und AGENTS still
auf den aktuellen Zustand umdeuten.

Benötigte Entscheidung:

- Entweder das Mockup bleibt Sollzustand und die App wird daran angeglichen.
- Oder das aktuelle Layout wird bestätigt; dann müssen Mockup, PLAN-Nachschlagewerk und AGENTS
  gemeinsam aktualisiert werden.

### F-32 – Historische Dateien

`.claude/settings.local.json` und `deploy/provision-mpd.sh` bleiben versioniert. Nicht blind
löschen. Erst klären, ob sie bewusst als Teamkonfiguration beziehungsweise historische Referenz
erhalten bleiben sollen. Der sichere Array-Swap aus F-32 ist bereits behoben.

## 8. Empfohlene Restpakete für Luna Max

### Restpaket 1 – P1-Regressionen

1. R-01 PVE-Secret als Aktivierungsschalter.
2. R-02 minimale Cancellation-Exception.
3. R-03 begrenzte, sichtbare Recurrence-Expansion.
4. R-04 sicheres Node-Segment.

**Exit-Kriterium:** Alle vier reproduzierenden Tests grün; keine stillen Kalenderteildaten; Server
startet im Zustand „PVE nicht konfiguriert“.

### Restpaket 2 – Schema und Netzwerkgrenzen

1. R-12 Hint-/Hostname-Normalisierung.
2. R-07 vollständige Origin-Prüfung.
3. R-05 Proxy-Single-Flight, Semaphore, Queue und Deadline.
4. R-06 Config-Größenprüfung vor jeder Mutation.

**Exit-Kriterium:** Ungültige Direkt-PUTs und Imports werden zentral abgelehnt; zehn gleiche
Proxy-Requests erzeugen einen Fetch; Parallelitätsmaximum und Größenlimits sind getestet.

### Restpaket 3 – Testhermetik

1. R-09 isolierte Testfixtures.
2. Fehlende Proxy-/Store-/SPA-/Import-Grenztests.
3. Concurrent/shuffle-Lauf wiederholen.

**Exit-Kriterium:** Standardlauf und dokumentierter Paralleltest vollständig grün.

### Restpaket 4 – Betrieb

1. R-08 Frontend-Healthcheck.
2. Release- und Rollback-Cleanup.
3. Node-Major- und Ownership-Prüfung.
4. Funktionaler lokaler Deploy-/Rollback-Harness.

**Exit-Kriterium:** Simulierter Install- oder Healthcheckfehler stellt Link und Unit nachweislich
wieder her; ein Release ohne Frontend wird nicht aktiviert. Kein echter Deploy erforderlich.

### Restpaket 5 – UI, Cache und Dokumentation

1. R-10 Mobile-Geometrie, Focus-Trap und eindeutige Namen.
2. R-11 Cache-Zeit und begrenztes Key-Cleanup.
3. R-13 Pfaddokumentation und TypeScript-Regel.
4. F-25/F-32 nur nach Benutzerentscheidung.

**Exit-Kriterium:** Browserabnahme bei 500, 900 und 1280 px; keine Überlagerung; Focus-Traps
bleiben in beiden Dialogen; Cachetests und Dokumentation sind konsistent.

## 9. Abschlussprüfung

Vor der Abschlussmeldung müssen mindestens folgende Befehle grün sein:

```bash
pnpm test
pnpm build
git diff --check
pnpm vitest run server/config-store.test.ts server/index.test.ts \
  --sequence.concurrent --sequence.shuffle.tests --sequence.seed=42
bash -n deploy/deploy.sh deploy/provision.sh
```

Zusätzlich manuell beziehungsweise im Browser prüfen:

- Settings und KEYMAP bei 500, 900 und 1280 px,
- Tab und Shift+Tab nach Wechsel jedes Settings-Tabs,
- keine Überlappung von Row-Actions und Eingaben,
- Touch-/Mauseingabe von `:settings`,
- partielle Kalender-/News-Fehler sichtbar,
- keine Browser-Requests an Fremddomains,
- keine Console-Fehler.

## 10. Definition of Done

Die Reparaturrunde ist erst abgeschlossen, wenn:

- R-01 bis R-04 behoben und automatisiert reproduziert sind,
- keine Recurrence-Quelle still partielle Daten liefert,
- Config-Schema, Import und Direkt-PUT dieselben semantischen Grenzen durchsetzen,
- Proxy-Single-Flight, Parallelität, Redirects, Größenlimits und Deadlines getestet sind,
- der parallele Hermetiktest grün ist,
- der simulierte Deployment-Rollback funktioniert und das Frontend geprüft wird,
- Settings bei 500 px keine Überlagerung haben und die Focus-Traps korrekt sind,
- `pnpm test`, `pnpm build`, `git diff --check` und `bash -n` grün sind,
- keine harte Regel aus `AGENTS.md` verletzt wird,
- F-25 und die historischen F-32-Dateien nur nach Benutzerentscheidung verändert werden,
- und kein echtes Deployment ohne ausdrückliche Freigabe erfolgt.
