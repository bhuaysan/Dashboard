# Uptime-Widget: Design

**Datum:** 22. September 2026

**Status:** fachlich abgestimmt

## Ziel

Das Dashboard erhält eine eigenständige `UPTIME`-Pane für einen schnellen Überblick über
HTTP-/HTTPS-Dienste und TCP-Ports, einschließlich Minecraft-Servern auf frei wählbaren Ports.
Der Dashboard-Server prüft die Ziele alle 60 Sekunden, hält eine rollierende
24-Stunden-Historie vor und zeigt aktuellen Zustand, Antwortzeit und gemessene Verfügbarkeit.

Das Widget ist bewusst kleiner als Uptime Kuma. Es bietet keine Benachrichtigungen,
Wartungsfenster, Inhaltsprüfungen, Minecraft-Protokollabfragen oder Langzeitberichte.

## Leitlinien

- Die Messung läuft serverseitig und unabhängig von einem geöffneten Browser.
- Bestehende Profile bleiben die Konfigurationsgrenze. Jedes Profil hat eigene Ziele und
  eine eigene Historie.
- Heim-LXC und VPS führen getrennte Historien. Der VPS erhält weiterhin keinen Zugriff auf
  das Heimnetz.
- Es gibt keine neue Abhängigkeit und keine Datenbank.
- Zieladressen und Ports stehen in der normalen Profil-Config. Zugangsdaten sind dort nicht
  erlaubt.
- Die Laufzeithistorie liegt getrennt von `config.json` und wird nie mit einer Config
  exportiert oder importiert.
- Das vorhandene `homelab.reachability` bleibt aus Kompatibilitätsgründen unverändert. Es
  wird nicht automatisch in Uptime-Ziele migriert.

## Konfiguration

Die Profil-Config erhält einen Bereich `uptime`:

```ts
type UptimeConfig = {
  enabled: boolean;
  targets: Array<
    | { id: string; type: "http"; label: string; url: string }
    | { id: string; type: "tcp"; label: string; host: string; port: number }
  >;
};
```

Die Ziel-ID ist eine UUID und bleibt bei einer bloßen Umbenennung stabil. HTTP-URLs müssen
mit `http://` oder `https://` beginnen und dürfen weder Benutzername noch Passwort enthalten.
TCP-Hosts folgen der vorhandenen Hostnamenvalidierung; Ports liegen zwischen 1 und 65535.
Ein Profil darf höchstens 32 Uptime-Ziele enthalten, und Ziel-IDs dürfen innerhalb eines
Profils nicht doppelt vorkommen.

Bestehende Configs ohne `uptime` erhalten beim Parsen deterministisch
`{ enabled: false, targets: [] }`. `defaultConfig.layout` erhält eine sichtbare,
vollbreite `uptime`-Pane; solange `uptime.enabled` false ist, bleibt sie wie die
`HOMELAB`-Pane ausgeblendet. Das Ausblenden der Pane beendet die Messung nicht. Nur
`uptime.enabled` schaltet sie ab.

Beim Kopieren eines Profils werden dessen Ziele einschließlich ihrer IDs kopiert. Weil die
Historie zusätzlich mit der neuen Profil-ID adressiert wird, beginnt das kopierte Profil
trotzdem ohne Messhistorie.

## Serverarchitektur

Ein neuer Uptime-Monitor ist für Zeitplanung, Prüfungen, Zustandsübergänge und Persistenz
verantwortlich. `server/index.ts` erstellt einen gemeinsamen `ConfigStore`, initialisiert den
Monitor und übergibt beide an die Hono-App. Dadurch arbeiten API und Scheduler mit derselben
Config-Quelle, während Tests beide Komponenten durch Fakes ersetzen können.

Der `ConfigStore` erhält eine interne Lesemethode, die alle Profil-IDs und Configs mit einem
einzigen validierten Dokument-Lesevorgang liefert. Diese Methode wird nicht als HTTP-Endpunkt
veröffentlicht.

Der Monitor lädt beim Start zuerst die persistierte Historie. Danach beginnt er im
Hintergrund sofort mit einer Prüfrunde und plant weitere Runden alle 60 Sekunden. Pro Runde
liest er den aktuellen Profilstand neu ein. So werden gespeicherte Änderungen spätestens in
der nächsten Runde wirksam, ohne Config-Mutationen mit dem Scheduler zu koppeln.

Höchstens acht Ziele werden gleichzeitig geprüft. Läuft eine Runde beim nächsten Termin
noch, wird keine überlappende Runde gestartet. Ein überlasteter Monitor wird dadurch als
veraltet sichtbar, statt immer mehr Arbeit anzusammeln.

## Prüfungen

### HTTP und HTTPS

- Deadline: 5 Sekunden für die gesamte Prüfung.
- Erfolgreich ist der endgültige HTTP-Status `200` bis `399`.
- Es werden höchstens fünf Weiterleitungen verfolgt.
- Das Antwort-Body wird nicht eingelesen und bestmöglich abgebrochen, sobald die Header
  vorliegen.
- Die Antwortzeit umfasst Namensauflösung, Verbindungsaufbau, TLS und Zeit bis zu den
  Antwort-Headern.
- Die normale TLS-Prüfung bleibt aktiv. Ungültige oder selbst signierte Zertifikate gelten
  als Fehler; es gibt keinen Schalter zum Abschalten der Prüfung.

Private Ziele sind ausdrücklich erlaubt, weil genau dafür der Monitor unter anderem gedacht
ist. Der Monitor verwendet jedoch keine frei über den Request steuerbare Zieladresse. Er
prüft ausschließlich zuvor validierte Ziele aus der durch die vorhandenen Schreibregeln
geschützten Profil-Config und prüft auch Weiterleitungsziele erneut auf HTTP(S)-Schema und
fehlende Zugangsdaten. Das ändert die Proxy-Regel nicht: `/api/proxy` blockiert private
Adressen weiterhin ausnahmslos.

### TCP

- Deadline: 5 Sekunden.
- Ein erfolgreicher TCP-Verbindungsaufbau gilt als Erfolg; danach wird der Socket sofort
  geschlossen.
- Host und Port kommen ausschließlich aus der validierten Profil-Config.
- Es gibt keine protokollspezifische Abfrage. Ein Minecraft-Server wird daher wie jeder
  andere TCP-Dienst geprüft; `25565` ist nur der Vorschlagswert für einen neuen Eintrag und
  kein fest codierter Port.

### Fehlerklassifikation

Rohe Netzwerkfehler verlassen den Server nicht. Der Monitor bildet sie auf einen kleinen
Vertrag ab: Timeout, DNS-Fehler, Verbindung abgelehnt, TLS-Fehler, Weiterleitungsfehler,
HTTP-Fehlerstatus oder allgemeiner Netzwerkfehler. Beim HTTP-Fehler darf der Statuscode
mitgegeben werden. Der Browser übersetzt diese Codes in kurze deutsche Meldungen.

## Zustandsmodell

Ein Ziel hat für die Anzeige genau einen der folgenden Zustände:

- `unknown`: noch nie geprüft oder letzte abgeschlossene Prüfung älter als 150 Sekunden;
- `up`: die letzte Prüfung war erfolgreich;
- `degraded`: genau eine Prüfung in Folge ist fehlgeschlagen, auch wenn sie die erste
  Messung des Ziels war;
- `down`: mindestens zwei Prüfungen hintereinander sind fehlgeschlagen.

Ein Erfolg setzt `degraded` oder `down` sofort auf `up` zurück. Der Zeitpunkt des
Zustandswechsels wird gespeichert, damit die Oberfläche „seit …“ anzeigen kann. Jeder
fehlgeschlagene Check zählt bereits ab dem ersten Fehler gegen die 24-Stunden-Quote, auch
wenn die Anzeige erst beim zweiten Fehler `down` erreicht.

Messlücken während eines Dashboard-Ausfalls sind `unknown` und werden nicht als Ausfall des
Ziels gewertet. Das Dashboard kann andere Dienste überwachen, aber nicht zuverlässig sich
selbst. Nach einer längeren Lücke bleibt der Status bis zur nächsten echten Messung
`unknown`. Für einen wegen Alterung abgeleiteten `unknown`-Zustand beginnt `statusSince`
150 Sekunden nach `checkedAt`.

## Historie und Persistenz

Die Historie liegt unter dem Pfad aus `DASHBOARD_UPTIME`. Die Deployments setzen ihn auf:

- Heim-LXC: `/var/lib/dashboard/uptime.json`
- VPS-Container: `/data/uptime.json`
- lokale Entwicklung: `./uptime.json`

Systemd darf bereits nach `/var/lib/dashboard` schreiben, und der VPS bind-mountet
`/var/lib/dashboard` nach `/data`. Deployments ersetzen die Datei daher nicht.

Eine Historie wird mit Profil-ID und Ziel-ID adressiert. Pro Ziel speichert sie:

- einen Fingerprint aus Typ und normalisiertem Ziel;
- die Minute des jüngsten Samples;
- einen rollierenden Ring aus höchstens 1.440 Zeichen (`1` Erfolg, `0` Fehler,
  `?` Messlücke);
- letzten Prüfzeitpunkt, Antwortzeit der aktuellen erfolgreichen Messung und letzten
  Fehlercode;
- aktuellen Zustand, Beginn des Zustands und Zahl aufeinanderfolgender Fehler.

Vor dem Anhängen eines Ergebnisses ergänzt der Monitor ausgelassene Minuten als `?` und
kürzt den Ring auf die jüngsten 1.440 Minuten. Mehrere Ergebnisse für dieselbe Minute
erzeugen keinen zweiten Slot. Die 24-Stunden-Quote ist
`Erfolge / (Erfolge + Fehler)`; `?` wird aus Zähler und Nenner ausgeschlossen. Ohne echte
Messung ist die Quote nicht vorhanden und die Oberfläche zeigt `—`.

Die 24 Positionen der Verlaufsanzeige entstehen aus Gruppen von je 60 Ringslots:

- `━`: alle vorhandenen Messungen erfolgreich;
- `!`: Mischung aus erfolgreichen und fehlgeschlagenen Messungen;
- `○`: vorhandene Messungen ausschließlich fehlgeschlagen;
- `·`: keine Messung vorhanden.

Ein noch nicht gefüllter Ring wird für die Darstellung links mit `?` ergänzt. Die rechte
Position ist damit immer die jüngste Stunde, unabhängig vom Alter des Ziels.

Ändert sich nur `label`, bleibt der Fingerprint gleich und die Historie erhalten. Ändert
sich Typ, URL, Host oder Port, stimmt der Fingerprint nicht mehr und die Historie beginnt
neu. Gelöschte Ziele und Profile werden bei der nächsten Runde aus der Laufzeitdatei
entfernt. Deaktiviertes Monitoring behält seine Historie zunächst bei; beim erneuten
Aktivieren werden die dazwischenliegenden Minuten als `?` ergänzt und ältere Werte fallen
normal nach 24 Stunden aus dem Ring.

Nach jeder abgeschlossenen Runde wird das vollständige Zustandsdokument atomar über eine
temporäre Datei und `rename` geschrieben. Es ist auf 2 MiB begrenzt und wird beim Lesen
vollständig gegen sein Schema validiert. Eine zu große, syntaktisch oder semantisch
beschädigte Datei wird nach `uptime.json.bak` kopiert; anschließend startet eine leere
Historie. Schlägt ein Schreibzugriff fehl, arbeitet der Monitor im Speicher weiter und
kennzeichnet die Persistenz als gestört. Ein Neustart kann dann die seit dem letzten
erfolgreichen Schreiben angefallenen Messungen verlieren.

## HTTP-API

Der neue Endpunkt lautet:

```text
GET /api/uptime?profile=<id>
```

Die Profil-ID ist wie bei Config, Proxy und Homelab verpflichtend. Fehlend oder syntaktisch
ungültig ergibt `400`, ein unbekanntes Profil `404`. Bei deaktiviertem Uptime-Monitoring
antwortet der Endpunkt analog zu Homelab mit `404` und „Uptime deaktiviert“.

Der Endpunkt liest nur den letzten Snapshot. Er startet nie eine Prüfung und akzeptiert
weder URL noch Host oder Port. Seine validierte Antwort enthält:

```ts
type UptimeResponse = {
  updatedAt: string | null; // Abschluss der jüngsten Prüfrunde dieses Profils
  storageOk: boolean;
  targets: Array<{
    id: string;
    status: "unknown" | "up" | "degraded" | "down";
    statusSince: string | null;
    checkedAt: string | null;
    responseTimeMs: number | null; // nur wenn die jüngste Messung erfolgreich war
    uptime24h: number | null;
    measuredMinutes: number;
    history: Array<"ok" | "mixed" | "down" | "unknown">; // genau 24 Einträge
    error: {
      code: "timeout" | "dns" | "refused" | "tls" | "redirect" | "http" | "network";
      httpStatus?: number;
    } | null;
  }>;
};
```

Die Config bleibt die Quelle für Reihenfolge, Label und Zieladresse; Messergebnisse werden
im Browser über die stabile Ziel-ID zugeordnet. Dadurch erscheint ein neu gespeichertes Ziel
sofort als „noch keine Messdaten“, auch wenn die nächste Serverrunde noch aussteht.

`/api/health` bleibt unabhängig von den überwachten Zielen. Ein ausgefallener Dienst oder
eine verlorene Uptime-Historie darf weder den Dashboard-Healthcheck fehlschlagen lassen noch
einen Dienstneustart auslösen.

## Browser-Datenfluss

Der Browser verwendet einen gemeinsamen Zod-Vertrag für API-Antwort und Local-Storage-Cache.
Die Abfrage läuft über `useCachedQuery` mit einem Query- und Storage-Key pro Profil, einer
TTL von 60 Sekunden und einem Refetch-Intervall von 60 Sekunden. Wie bei den vorhandenen
Widgets pausiert nur das Browser-Refetching in unsichtbaren Tabs; die serverseitige Messung
läuft weiter.

Beim Profilwechsel wird die alte Abfrage abgebrochen. Späte Antworten können wegen der
getrennten Schlüssel nicht in das neue Profil gelangen. Da die Antwort nur JSON-Werte und
ISO-Strings enthält, muss der Decoder keine `Date`-Objekte rekonstruieren.

## UPTIME-Pane

`uptime` wird als neue Pane-ID an die bestehende Pane-Liste angehängt, damit die bisherigen
Zifferntasten unverändert bleiben. Die Pane ist wie `HOMELAB` immer vollbreit und erscheint
im Dokument nach ihr. Ist Homelab deaktiviert, ist Uptime die erste vollbreite Pane unter
den drei Hauptspalten.

Jede Zielzeile zeigt:

1. Zustandszeichen und kurze Zustandsdauer;
2. Label sowie Typ und Ziel;
3. letzte erfolgreiche Antwortzeit;
4. Verfügbarkeit der letzten 24 Stunden mit zwei Nachkommastellen;
5. die 24-stellige Stundenhistorie.

Die Zustandszeichen sind `●` für erreichbar, `!` für gestört, `○` für nicht erreichbar und
`?` für unbekannt. Nur vorhandene CSS-Farbvariablen werden verwendet. Der Zustand ist auch
ohne Farbe durch Zeichen und Text erkennbar.

HTTP-Zeilen öffnen ihre konfigurierte URL per Maus oder Enter. TCP-Zeilen bleiben mit
`j`/`k` auswählbar, haben aber keine Enter-Aktion. Auf schmalen Bildschirmen verteilt sich
eine Zielzeile auf zwei Darstellungszeilen; es entsteht kein horizontaler Seiten-Scroll.
Leere Konfiguration, ausstehende erste Messung und Speicherfehler erhalten deutsche
Leer- beziehungsweise Fehlermeldungen.

## Statusline und Alarme

Die Statusline erhält die Quelle `up`:

- `● up`: API-Daten frisch;
- `· up`: keine frische Serverrunde;
- `! up`: API-Fehler oder nicht dauerhaft speicherbare Historie;
- `○ up`: Uptime-Monitoring nicht konfiguriert.

Zielausfälle verändern nicht den Zustand der Datenquelle. Analog zu Homelab erscheinen sie
als Alarmzähler: `degraded` zählt als Warnung, `down` als kritisch. Sobald mindestens ein
Ziel `down` ist, ist der zusammengefasste Alarm kritisch. Die betroffenen Dienste sind in
der Uptime-Pane selbst sichtbar; eine zweite, duplizierte Alarmliste wird nicht eingeführt.

## Einstellungen

Die Settings erhalten einen Abschnitt „Uptime“ mit:

- „Uptime-Monitoring aktiv“;
- sortier- und löschbaren Zielzeilen;
- „+ HTTP“ für Label und URL;
- „+ TCP“ für Label, Host und Port.

Neue TCP-Ziele beginnen mit Port `25565`, der vor dem Speichern frei geändert werden kann.
Die vorhandene Layout-Tabelle zeigt `uptime` als immer vollbreit. Ihre Sichtbarkeit ist bei
deaktiviertem Monitoring gesperrt, genauso wie bei Homelab.

Es gibt keine Felder für Prüfintervall, Timeout, erwarteten Einzelstatus, Antwortinhalt,
Header, Zugangsdaten, unsichere TLS-Ausnahmen oder Wartungsfenster.

## Fehlerverhalten

- Config nicht lesbar: Die Runde wird ausgelassen; der bisherige Snapshot altert zu
  `unknown`.
- Neues Ziel: Die API liefert bis zum ersten Ergebnis einen leeren Messzustand, den der
  Browser als „noch keine Messdaten“ zeigt.
- Einzelner Probe-Fehler: Nur dieses Ziel wechselt den Zustand; andere Ergebnisse werden
  normal gespeichert.
- Historie beschädigt: Sicherung nach `.bak`, leere Historie, Monitoring läuft weiter.
- Historie nicht schreibbar: Ergebnisse bleiben im Speicher, `storageOk` ist false und die
  Statusline meldet einen Fehler.
- Server-Neustart während einer Probe: Es gilt der letzte atomar geschriebene Stand; die
  fehlenden Minuten werden nach dem Neustart als `?` ergänzt.
- Browser-Cache beschädigt: Der vorhandene `useCachedQuery`-Decoder verwirft den Eintrag und
  lädt neu.

## Tests und Abnahmekriterien

### Server

- HTTP: `200`, `3xx`, Fehlerstatus, mehr als fünf Weiterleitungen, TLS-/Netzwerkfehler und
  Timeout; der Body wird nicht konsumiert.
- TCP: erfolgreicher lokaler Testserver, abgelehnte Verbindung und Timeout.
- Maximal acht parallele Prüfungen und keine überlappenden Runden.
- Zustandsfolge `up → degraded → down → up` einschließlich Zeitpunkten und Fehlerzähler.
- `unknown` nach 150 Sekunden ohne abgeschlossene Messung.
- Exakte Quote aus `1` und `0`, Ausschluss von `?`, Begrenzung auf 1.440 Minuten und korrekte
  24-Stunden-Gruppierung.
- Messlücken nach Neustart, Beibehaltung bei Umbenennung und Reset bei geändertem Ziel.
- Trennung gleicher Ziel-IDs in unterschiedlichen Profilen.
- Atomares Schreiben, Größenlimit, beschädigte Datei und nicht schreibbarer Zustand.
- Profilparameter, deaktiviertes Monitoring, unbekanntes Profil und Snapshot-Antwort des
  API-Endpunkts.

### Config und Browser

- Default-Migration bestehender Einzel- und Profildokumente.
- Validierung von Zieltypen, UUIDs, URLs, Hosts, Ports, Duplikaten und dem Limit von 32
  Zielen.
- Settings: Aktivierung, Hinzufügen, Bearbeiten, Sortieren und Löschen beider Zieltypen.
- Pane: alle vier Zustände, Prozentformat, Verlauf, leere Zustände und Speicherfehler.
- Tastaturnavigation über HTTP- und TCP-Zeilen; Enter öffnet nur HTTP-Ziele.
- Profilwechsel trennt Query- und Local-Storage-Daten.
- Statusline unterscheidet Quellenfehler, Warnungen und kritische Zielalarme.
- Responsive Darstellung erzeugt keinen horizontalen Seiten-Scroll.

### Deployment

- `.env.example`, LXC-Deployment und VPS-Provisionierung dokumentieren beziehungsweise
  setzen `DASHBOARD_UPTIME`.
- Systemd- und Docker-Pfade bleiben über Releases erhalten und sind für den jeweiligen
  Prozessbenutzer schreibbar.
- Es wird weder ein Secret noch die Historie in ein Release-Paket aufgenommen.
- Die lokale `uptime.json` und ihre Sicherungs-/Temporärdateien stehen in `.gitignore`.

Die Änderung ist fertig, wenn `pnpm test` und `pnpm build` vollständig grün sind und eine
manuelle lokale Prüfung je eines HTTP- und TCP-Ziels den erwarteten Statuswechsel zeigt.

## Bewusst nicht enthalten

- E-Mail-, Push-, Slack- oder andere Benachrichtigungen
- Sieben-/30-/90-Tage-Historien und öffentliche Statusseiten
- Wartungsfenster und manuelles Pausieren einzelner Ziele
- HTTP-Body-, JSON- oder Zertifikatsablauf-Prüfungen
- Authentifizierte Checks, benutzerdefinierte Header oder Client-Zertifikate
- Deaktivierte TLS-Prüfung
- ICMP/Ping, UDP sowie Minecraft-MOTD, Spielerzahl oder Query-Protokoll
- mehrere Messstandorte oder Zusammenführung der LXC- und VPS-Historie
- automatische Migration oder Entfernung von `homelab.reachability`
