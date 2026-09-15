# Dashboard

Persönliche Browser-Startseite im Stil eines Terminal-Multiplexers. Ein einziger Node-Prozess
(Hono) im LXC `start` (10.0.10.20) liefert die App, die Config und alle Daten (Wetter, Feeds,
ICS, Proxmox-Zustand) aus; der Browser redet ausschließlich mit `/api/...`.

## Entwicklung

```bash
pnpm install
pnpm dev:server   # API auf :7777, liest .env
pnpm dev          # Vite auf :5173, proxyt /api nach :7777
pnpm test
pnpm build
```

## Deployment

```bash
pnpm deploy       # testet, baut, staged ein Release, prüft /api/health und rollt bei Fehlern zurück
```

Deployment ist eine manuelle Operation. Profilwechsel, Profilmutationen sowie Config-Speichern ändern nur den
Server-State und lösen keinen automatischen Deploy aus.

Einmalige Einrichtung eines neuen Containers: `./deploy/provision.sh` (Pakete, Node 22, Benutzer
`dashboard`, Corepack/pnpm, root-owned Releases und getrenntes State-Verzeichnis).
Der Dienst läuft als `dashboard.service` (systemd) auf Port 80.

## Profile und config.json

`config.json` liegt nur auf dem Server (`/var/lib/dashboard/config.json`) und ist die einzige Quelle der Wahrheit für
die Profile. Das persistierte Format ist ein Version-2-Dokument:

```ts
type ProfileDocument = {
  version: 2;
  profilesUpdatedAt: string;
  profiles: Array<{
    id: string;
    name: string;
    config: Config; // vollständige bisherige Version-1-Config
  }>;
};
```

Profil-IDs erzeugt der Server als UUID; nur das reservierte `default` wird bei der Legacy-Migration verwendet. Namen
werden getrimmt, sind 1 bis 64 Zeichen lang und ohne Beachtung der Groß-/Kleinschreibung eindeutig. Der Katalog hat
mindestens ein und höchstens 16 Profile. `profilesUpdatedAt` schützt Katalogmutationen, `config.updatedAt` schützt
Änderungen an genau einem Profil.

Eine gültige alte Einzel-Config wird beim Lesen automatisch und verlustfrei im Speicher zu `{ id: "default", name:
"Standard" }` migriert. Das reine Lesen schreibt die Datei nicht um; der erste erfolgreiche Profil- oder
Config-Schreibvorgang persistiert Version 2. Unbekannte Panes werden pro Profil entfernt, fehlende Panes pro Profil
aus den Defaults ergänzt. Eine syntaktisch oder semantisch unlesbare Datei wird als `config.json.bak` gesichert und
durch ein einzelnes Standardprofil ersetzt. Eine zu große oder ungültige Mutation wird vor der Backup-Rotation
abgelehnt. Jede erfolgreiche Mutation sichert das vollständige Profildokument in der Rotation `config.json.1` bis
`config.json.7` und schreibt anschließend atomar.

Der Profilkatalog und die profilabhängigen Daten sind getrennt:

```text
GET    /api/profiles                         # nur profilesUpdatedAt sowie id/name-Paare
POST   /api/profiles                         # { name, sourceProfileId }
PATCH  /api/profiles/:id                     # { name }
DELETE /api/profiles/:id
GET    /api/config?profile=<id>
PUT    /api/config?profile=<id>
GET    /api/proxy?profile=<id>&url=<url>
GET    /api/homelab?profile=<id>
```

Bei allen profilabhängigen Endpunkten ist `profile` verpflichtend. Fehlende oder syntaktisch ungültige IDs liefern
400, unbekannte Profile 404. Katalogmutationen verlangen `If-Match: <profilesUpdatedAt>`; `PUT /api/config` verlangt
`If-Match: <config.updatedAt>`. Konflikte liefern 409, das letzte Profil kann nicht gelöscht werden, und ein zu
großes Gesamtdokument liefert 413. Katalog- und Config-Schreibzugriffe bleiben durch Host-, Origin- und
`DASHBOARD_WRITE_ALLOW`-Prüfungen geschützt. `GET /api/health` validiert das vollständige Dokument, gibt aber nur
einen Status zurück.

`.env` bleibt global für den Serverprozess. Alle Secrets, insbesondere PVE-Token, stehen weder in einem Profil noch
in `config.json`, werden nie in einer HTTP-Antwort oder einem Log ausgegeben und werden durch Profilwechsel nicht
verändert.

## Auswahl auf dem Gerät

Welches Profil aktiv ist, entscheidet jedes Gerät ausschließlich lokal. Die aktive ID steht im Browser unter
`dashboard:active-profile`; der Katalog wird unter `dashboard:profiles` und die letzte gültige Config getrennt unter
`dashboard:config:<profile-id>` gecacht. Der alte Einzel-Config-Cache `dashboard:config` wird einmalig als Cache für
`default` übernommen. Beim Start wird zuerst ein lokales Profil gewählt und sofort dessen lokale Config angezeigt;
Katalog und Config werden danach im Hintergrund vom Server aktualisiert. Datenquellen-Caches tragen ebenfalls den
Präfix `profile:<profile-id>:`.

`:profile` öffnet das Settings-Overlay direkt im Abschnitt `PROFILE`. Mit `:profile <name>` wird ein Profil nur auf
diesem Gerät gewechselt; der Name wird exakt und ohne Beachtung der Groß-/Kleinschreibung verglichen, Teiltreffer
gelten nicht. Ein unbekannter Name erzeugt eine deutsche Fehlermeldung. Das Overlay bietet Duplizieren des aktiven
Profils, Umbenennen (die ID bleibt erhalten) und Löschen mit zweistufiger Bestätigung. Das letzte Profil kann nicht
gelöscht werden. Ein neues Profil ist immer eine Kopie des aktiven Profils und wird nur auf dem Gerät des Vorgangs
aktiviert.

Ungespeicherte Settings-Entwürfe werden bei Profilwechsel oder beim Löschen des aktiven Profils nicht stillschweigend
verworfen, sondern brauchen eine ausdrückliche Bestätigung. Bei einem 409 bleibt der Entwurf erhalten und der
Serverstand kann im Overlay neu geladen werden. Wird das aktive Profil auf einem anderen Gerät gelöscht, wechselt
dieses Gerät beim nächsten Katalogabgleich zum ersten verbleibenden Profil und zeigt `Profil wurde entfernt —
Standardprofil aktiv.`; ein Serverfehler ändert die lokale Auswahl nicht.

`:export` exportiert weiterhin nur die Config des aktiven Profils. Der Dateiname enthält den bereinigten Profilnamen.
`:import` ersetzt nur die Config des aktiven Profils und verwendet dessen aktuelle `updatedAt`-Revision für den
optimistischen Schreibschutz; Profil-ID, Profilname und alle anderen Profile bleiben unverändert. Einen Gesamtimport
oder Gesamtexport des Katalogs gibt es nicht. Die serverseitige Backup-Rotation umfasst trotzdem immer das vollständige
Profildokument.

## config.json (weitere Betriebsdetails)

Der Aufbau wird durch `src/config/schema.ts` (Zod) auf Server und Browser validiert. Der Proxy verwendet nur die
Allowlist des angeforderten Profils plus die Hosts von dessen Feeds und Kalendern; private Ziele bleiben unabhängig
von der Allowlist gesperrt. Proxmox-Daten laufen ausschließlich über den aggregierten
`/api/homelab?profile=<id>`-Endpunkt. Bei deaktiviertem `homelab.enabled` des aktiven Profils gibt es dafür keine
PVE-Anfrage und keine Status- oder Alarmanzeige. Fehlt `PVE_TOKEN_SECRET`, bleibt der Zustand unabhängig davon
`configured: false` („nicht konfiguriert“).

Lokale Kalender werden als `/static/name.ics` eingetragen. Sie liegen im separaten Verzeichnis aus
`DASHBOARD_STATIC` (Standard: `./static`), nicht unter `dist/` und werden deshalb nicht durch das
Deployment gelöscht. Fehlende oder unsichere Static-Pfade liefern 404.

`GET /api/health` prüft ausschließlich, ob der Prozess läuft und die Config lesbar ist; der
Endpunkt gibt keine Config-, URL- oder Secretwerte aus und wird vom Deployment als Readiness-Check verwendet.

`homelab.enabled` des aktiven Profils steuert das Proxmox-Monitoring und den Zugriff auf
`/api/homelab?profile=<id>`.
`layout.homelab.visible` steuert nur die HOMELAB-Pane; bei aktiviertem Monitoring läuft die
Überwachung auch bei ausgeblendeter Pane weiter. Bei deaktiviertem Monitoring gibt es keine
PVE-Requests und keine PVE-Status- oder Alarmanzeige. Fehlt `PVE_TOKEN_SECRET`, bleibt davon
unabhängig `configured: false` („nicht konfiguriert“).

Jedes Speichern hebt den vorherigen Stand auf: `config.json.1` ist der jüngste, `config.json.7`
der älteste. Einen davon zurückholen:

```bash
ssh root@10.0.10.20 'cp /var/lib/dashboard/config.json.1 /var/lib/dashboard/config.json && chown dashboard:dashboard /var/lib/dashboard/config.json && systemctl restart dashboard'
```

## .env

Nur auf dem Server als `/etc/dashboard/dashboard.env`, `chmod 600`, nicht in Git. Variablen siehe `.env.example`:
`PVE_URL`, `PVE_TOKEN_ID`, `PVE_TOKEN_SECRET`, `PVE_CA_PATH`, `PORT`, `DASHBOARD_CONFIG`,
`DASHBOARD_WRITE_ALLOW`, `DASHBOARD_WRITE_HOSTS` und `DASHBOARD_STATIC`. Leeres `PVE_TOKEN_SECRET`
ergibt unabhängig vom Monitoring-Schalter den Zustand `configured: false` („nicht konfiguriert“);
für diesen Zustand bleiben die übrigen PVE-Felder ebenfalls leer.

### Proxmox-Token erneuern

1. Proxmox-UI → Datacenter → Permissions → API Tokens → Token `startpage` für `dashboard@pve`
   neu erzeugen (Privilege Separation an, Rolle `PVEAuditor` auf `/` für Benutzer und Token)
2. Neues Secret in `/etc/dashboard/dashboard.env` als `PVE_TOKEN_SECRET=` eintragen
3. `systemctl restart dashboard` im Container

### pve-ca.pem neu kopieren

Falls die PVE-CA neu erzeugt wird:

```bash
scp root@10.0.10.10:/etc/pve/pve-root-ca.pem ./pve-ca.pem   # lokal
scp pve-ca.pem root@10.0.10.20:/etc/dashboard/pve-ca.pem   # in den Container
ssh root@10.0.10.20 'chown root:dashboard /etc/dashboard/pve-ca.pem && chmod 640 /etc/dashboard/pve-ca.pem && systemctl restart dashboard'
```

## Restore

Snapshot von CT 113 in der Proxmox-UI zurückspielen (Snapshots → auswählen → Rollback).
Der Dienst startet per `enabled`-Unit von allein; danach einmal `./deploy/deploy.sh`, falls der
Code-Stand neuer sein soll als der Snapshot. Komplett neu: Container anlegen (Schritt 7 in
`PLAN.md`), `provision.sh`, `deploy.sh`, `config.json`/`.env`/`pve-ca.pem` aus dem Backup zurück.
