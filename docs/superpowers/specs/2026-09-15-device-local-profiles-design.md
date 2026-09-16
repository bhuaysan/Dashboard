# Gerätebezogene Dashboard-Profile

## Ziel

Das Dashboard unterstützt mehrere vollständige Konfigurationsprofile wie `Arbeit` und `Privat`.
Die Profile werden zentral auf dem Server gespeichert. Welches Profil aktiv ist, entscheidet jedes
Gerät ausschließlich lokal im Browser. Ein Profilwechsel auf dem Arbeitsrechner darf deshalb weder
das private Gerät noch das iPhone umschalten.

Diese Erweiterung hebt ausschließlich den bisherigen Ausschluss von Multi-Profilen auf. Alle
anderen Regeln aus `AGENTS.md` bleiben bestehen. Insbesondere gibt es keine Datenbank, keine
Anmeldung, keine neuen Abhängigkeiten, keine Secrets in der Konfiguration und keinen direkten
Browserzugriff auf fremde Domains.

## Gewählte Architektur

Alle Profile liegen in derselben `config.json`. Gegenüber getrennten Dateien bewahrt das den
bestehenden atomaren Schreib-, Backup- und Recovery-Pfad. Gegenüber einer API, die immer alle
Profile mitsendet, bleiben Antworten klein und Konflikte auf das tatsächlich bearbeitete Profil
begrenzt.

Die äußere Datei erhält Version 2:

```ts
type ProfileDocument = {
  version: 2;
  profilesUpdatedAt: string;
  profiles: Array<{
    id: string;
    name: string;
    config: Config;
  }>;
};
```

`Config` bleibt die vorhandene vollständige Version-1-Konfiguration einschließlich Theme, Ort,
Zeitzonen, Links, Feeds, Kalendern, Suche, Layout, Proxy und Homelab. Es gibt absichtlich keine
globalen Konfigurationsfelder außerhalb eines Profils. Nur Profil-ID, Profilname und die Revision
des Profilkatalogs liegen darüber.

Profil-IDs sind unveränderliche, vom Server erzeugte UUIDs. Für die automatische Migration ist
zusätzlich die reservierte deterministische ID `default` gültig. Eine ID wird nie aus dem Namen
abgeleitet. Profilnamen sind getrimmt, 1 bis 64 Zeichen lang und ohne Beachtung der
Groß-/Kleinschreibung eindeutig. Das Dokument enthält mindestens ein und höchstens 16 Profile.
Zusätzlich gilt weiterhin die Größenobergrenze der gesamten `config.json` von 512 KiB.

## Migration und Recovery

Beim Lesen erkennt der Store sowohl die bisherige einzelne `Config` als auch das neue
`ProfileDocument`:

- Eine gültige alte Config wird im Speicher verlustfrei zum Profil `{ id: "default", name:
  "Standard", config: oldConfig }` migriert.
- Das reine Lesen schreibt die Datei nicht um. Der erste erfolgreiche Profil- oder
  Konfigurations-Schreibvorgang persistiert Version 2 über den vorhandenen atomaren Pfad.
- Die deterministische ID `default` stellt sicher, dass wiederholte Reads vor dem ersten Schreiben
  dasselbe Profil bezeichnen.
- Unbekannte Panes werden pro Profil entfernt; fehlende neue Panes werden pro Profil aus den
  Defaults ergänzt.
- Eine syntaktisch oder semantisch unlesbare Datei folgt weiterhin dem vorhandenen
  `.bak`-und-Defaults-Verhalten, jetzt mit einem einzelnen Profil `Standard`.
- Die Rotation `config.json.1` bis `config.json.7` sichert immer das vollständige Profildokument.

Es gibt keine Migration oder Speicherung von Secrets. `.env` bleibt unverändert und gilt für den
gesamten Serverprozess.

## Revisionen und Nebenläufigkeit

Es bestehen zwei getrennte optimistische Sperren:

- `profilesUpdatedAt` schützt das Anlegen, Umbenennen und Löschen von Profilen.
- `config.updatedAt` schützt Änderungen an genau einem Profil.

So können zwei Geräte gleichzeitig unterschiedliche Profile speichern. Zwei Änderungen am selben
Profil erzeugen weiterhin einen `409`. Auch konkurrierende Änderungen am Profilkatalog erzeugen
einen `409`. Alle Mutationen laufen durch die vorhandene Store-Schreibqueue und schreiben das
gesamte Dokument atomar. Eine Größenüberschreitung oder Validierungsverletzung verändert weder die
aktive Datei noch die Backups.

## Server-API

### Profilkatalog

```text
GET    /api/profiles
POST   /api/profiles
PATCH  /api/profiles/:id
DELETE /api/profiles/:id
```

`GET` liefert ausschließlich `profilesUpdatedAt` und die Paare aus `id` und `name`. Es enthält
keine Profilkonfiguration. `POST` erhält `{ name, sourceProfileId }`, dupliziert das Quellprofil und
gibt den aktualisierten Katalog samt neuer Profil-ID zurück. `PATCH` erhält `{ name }`. `DELETE`
verweigert das letzte verbleibende Profil.

Alle drei schreibenden Operationen verwenden `If-Match: <profilesUpdatedAt>` und den bestehenden
Write Guard. Ungültige IDs oder Namen liefern `400`, unbekannte Profile `404`, Konflikte `409` und
ein zu großes Gesamtdokument `413`.

### Profilabhängige Daten

```text
GET /api/config?profile=<id>
PUT /api/config?profile=<id>
GET /api/proxy?profile=<id>&url=<url>
GET /api/homelab?profile=<id>
```

Die Profil-ID ist bei diesen Endpunkten verpflichtend. Ein fehlender Parameter liefert `400`, ein
unbekanntes Profil `404`. `PUT /api/config` verwendet weiterhin die Revision der bearbeiteten
Config als `If-Match` und den bestehenden Write Guard.

Der Proxy berechnet seine effektive Allowlist ausschließlich aus dem angegebenen Profil. Der
Homelab-Endpunkt verwendet ausschließlich dessen `homelab`-Konfiguration. Damit kann ein Profil
Homelab deaktivieren oder andere Schwellen setzen, ohne ein anderes Profil zu beeinflussen. Die
private-address-Sperre des Proxys bleibt unverändert.

`GET /api/health` liest und validiert das vollständige Profildokument, gibt aber weiterhin keine
Konfiguration oder Profilnamen zurück.

## Servercaches

Der Homelab-Cache wird nach Profil-ID und Config-Revision getrennt. Sein logischer Schlüssel ist
`<profileId>:<config.updatedAt>`. Dadurch können identische Revisionstimestamps verschiedener
Profile niemals Ergebnisse teilen. Deaktiviertes Monitoring löst für das betreffende Profil
weiterhin keine PVE-Anfrage aus.

Der Proxycache bleibt URL-basiert. Bevor ein Cachetreffer verwendet wird, muss die URL wie bisher
gegen die effektive Allowlist des angeforderten Profils zugelassen sein. Die Profilwahl darf daher
keine Allowlist-Prüfung umgehen.

## Auswahl und Offlineverhalten im Browser

Der Browser speichert die aktive ID unter einem eigenen lokalen Schlüssel, beispielsweise
`dashboard.activeProfileId`. Der Profilkatalog und die letzte gültige Config jedes bereits
verwendeten Profils werden ebenfalls lokal gecacht. Config-Schlüssel enthalten immer die Profil-ID.

Beim Start gilt folgende Reihenfolge:

1. Lokalen Profilkatalog lesen.
2. Lokal aktive ID wählen, sofern sie im Katalog existiert.
3. Sonst das erste Profil wählen und diese ID lokal speichern.
4. Die zugehörige lokal gecachte Config sofort anzeigen.
5. Katalog und aktive Config im Hintergrund vom Server aktualisieren.

Der alte einzelne Local-Storage-Configeintrag wird einmalig als Cache für das migrierte Profil
`default` übernommen. Das erhält die bisherige Sofortanzeige nach dem Upgrade.

Der Profilkatalog wird wie die Config regelmäßig und bei Fokus aktualisiert. Wird das auf diesem
Gerät aktive Profil auf einem anderen Gerät gelöscht, wechselt das Gerät auf das erste vorhandene
Profil, speichert dessen ID lokal und zeigt die Meldung `Profil wurde entfernt — Standardprofil
aktiv.`. Ein Serverfehler ändert die lokale Auswahl nicht.

## React- und Datenfluss

Die Config-Abfrage wird von `useConfig()` auf `useConfig(profileId)` umgestellt. Der Katalog erhält
einen eigenen Query- und Mutationspfad. Query Keys enthalten die Profil-ID, zum Beispiel
`["config", profileId]`. Auch die persistenten Schlüssel von Wetter, Kalender, News und Homelab
werden mit der Profil-ID präfixiert.

Beim Profilwechsel:

1. neue ID lokal speichern,
2. laufende profilabhängige Abfragen des vorherigen Profils abbrechen,
3. sofort eine vorhandene lokale Config des Zielprofils anzeigen,
4. Zielconfig und Datenquellen laden,
5. Theme, sichtbare Panes, Auswahl und Statusline an das Zielprofil anpassen.

Späte Antworten des vorherigen Profils dürfen weder den sichtbaren React-Query-Cache noch dessen
Local-Storage-Eintrag überschreiben. Getrennte Query Keys sind die primäre Isolation; Abbruch beim
Wechsel reduziert zusätzlich unnötige Arbeit.

Jeder Browseraufruf an Config, Proxy und Homelab übermittelt die aktive Profil-ID. Die Ziel-URL
eines Proxyaufrufs bleibt weiterhin mit `encodeURIComponent` kodiert.

## Einstellungen

Das Settings-Overlay erhält als ersten Abschnitt `PROFILE`. Er zeigt:

- das aktive Profil,
- alle vorhandenen Profile mit einer Aktion `wechseln`,
- `Profil duplizieren`,
- Umbenennen,
- Löschen mit zweistufiger Bestätigung.

Ein neues Profil ist immer eine Kopie des aktuell aktiven Profils. Nach erfolgreichem Anlegen wird
es nur auf diesem Gerät aktiv. Ein leeres Profil und Profilvorlagen sind nicht Teil dieser
Version.

Profilmutationen werden unabhängig vom Config-Entwurf gespeichert. Enthält das Settings-Overlay
ungespeicherte Änderungen, muss ein Profilwechsel oder das Löschen des aktiven Profils zuerst
zweistufig bestätigen, dass dieser Entwurf verworfen wird. Das letzte Profil kann nicht gelöscht
werden. Wird ein inaktives Profil gelöscht, bleibt die lokale Auswahl unverändert.

Nach einem `409` bleibt der aktuelle UI-Entwurf erhalten. Der Benutzer erhält wie beim bestehenden
Config-Konflikt die Möglichkeit, den Serverstand neu zu laden.

## Kommandos und Statusline

Die Kommandozeile unterstützt:

```text
:profile
:profile <name>
```

`:profile` öffnet das Settings-Overlay direkt im Abschnitt `PROFILE`. `:profile <name>` wechselt
nur dieses Gerät. Der Vergleich ist ohne Beachtung der Groß-/Kleinschreibung exakt; Teiltreffer
werden nicht verwendet. Ein unbekannter Name erzeugt eine deutsche Fehlermeldung.

Die Statusline zeigt das aktive Profil als `profile:<name>` in einer gekürzten, aber zugänglichen
Darstellung. Der vollständige Name steht im zugänglichen Label beziehungsweise Tooltip. Die
Keymap-Hilfe dokumentiert beide Varianten des Befehls. Es werden keine Icons oder Emoji ergänzt.

## Import und Export

`:export` exportiert weiterhin eine einzelne `Config`, nun die des aktiven Profils. Der Dateiname
enthält einen für Dateinamen bereinigten Profilnamen. `:import` ersetzt ausschließlich die Config
des aktiven Profils und übernimmt weiterhin dessen aktuelle `updatedAt`-Revision für den
optimistischen Schreibschutz. Profil-ID, Profilname und andere Profile werden nicht verändert.

Ein Gesamtexport oder Gesamtimport des Profilkatalogs ist nicht Teil dieser Version. Die
serverseitige Rotation sichert trotzdem immer alle Profile gemeinsam.

## Fehlerverhalten

- Fehlende Profil-ID an einem profilabhängigen Endpunkt: `400`.
- Syntaktisch ungültige Profil-ID: `400`.
- Unbekannte oder zwischenzeitlich gelöschte Profil-ID: `404`.
- Config- oder Katalogkonflikt: `409`, Entwurf bleibt erhalten.
- Gesamtdokument größer als 512 KiB: `413`, keine Änderung.
- Letztes Profil löschen: `409` mit deutscher fachlicher Meldung.
- Netzwerkfehler beim Wechsel: lokal gecachte Zielconfig bleibt sichtbar und die Statusline zeigt
  den bestehenden Config-Fehlerzustand.
- Fehler eines Profils beeinträchtigen keine gecachten Daten eines anderen Profils.

## Tests und Abnahme

### Schema und Store

- Legacy-Config wird ohne Feldverlust nach `default` migriert.
- Wiederholte Legacy-Reads liefern dieselbe ID und schreiben nicht.
- Der erste Schreibvorgang persistiert Version 2 atomar.
- Profile haben eindeutige IDs und Namen; Grenzen 1 und 16 werden geprüft.
- Unbekannte und fehlende Panes werden je Profil bereinigt beziehungsweise ergänzt.
- Config-Revisionen und Katalogrevision funktionieren unabhängig.
- Gleichzeitige Änderungen verschiedener Profile sind erfolgreich.
- Gleichzeitige Änderungen desselben Profils beziehungsweise Katalogs liefern Konflikte.
- Duplizieren, Umbenennen, Löschen des letzten Profils und Größenüberschreitung sind abgedeckt.
- Backup und Recovery umfassen das vollständige Dokument.

### API und Sicherheit

- Jede profilabhängige Route prüft fehlende, ungültige und unbekannte IDs.
- Alle Schreiboperationen behalten Host-, Origin-, CIDR- und Bodylimit-Schutz.
- Proxy-Allowlist und abgeleitete Feed-/Kalenderhosts stammen aus dem gewählten Profil.
- Private Ziele bleiben in jedem Profil gesperrt.
- Homelab-Konfiguration und Cache sind je Profil getrennt.
- Kein Endpunkt gibt `.env`-Werte oder PVE-Tokens aus.

### Frontend

- Geräte behalten unabhängig voneinander ihre lokale Auswahl.
- Settings und `:profile <name>` wechseln korrekt.
- Anlegen aktiviert das neue Profil nur lokal; Umbenennen erhält die ID.
- Löschen des lokal aktiven Profils auf einem anderen Gerät löst den definierten Fallback aus.
- Ungespeicherte Settings werden nicht ohne Bestätigung verworfen.
- Wetter-, Kalender-, News- und Homelab-Caches vermischen sich nicht.
- Späte Antworten des vorherigen Profils verändern das neue Profil nicht.
- Theme, Layout, Statusline, Hilfe, Import und Export folgen dem aktiven Profil.
- Offline wird die zuletzt gültige Config des lokal aktiven Profils sofort gerendert.

Zum Abschluss müssen `pnpm test`, `pnpm build` und `git diff --check` erfolgreich sein. Ein
Deployment ist nicht Bestandteil der Implementierung und erfolgt nur nach einer gesonderten
ausdrücklichen Anweisung.

## Nicht-Ziele

- automatische Profilwahl nach Uhrzeit, Netzwerk oder Standort,
- ein global aktives Serverprofil,
- Profile mit Vererbung oder gemeinsam genutzten Teilbereichen,
- leere Profile oder Vorlagen,
- profilspezifische Secrets,
- Gesamtimport und Gesamtexport aller Profile,
- Authentifizierung oder Profile pro Benutzer,
- neue externe Dienste oder Abhängigkeiten,
- Deployment.
