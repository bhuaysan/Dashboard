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
pnpm deploy       # baut, rsynct dist/ server/ src/ nach /opt/dashboard, startet den Dienst neu
```

Einmalige Einrichtung eines neuen Containers: `./deploy/provision.sh` (Pakete, Node 22, Benutzer
`dashboard`, systemd-Unit, `.env` wird dabei auf die Server-Pfade umgeschrieben).
Der Dienst läuft als `dashboard.service` (systemd) auf Port 80.

## config.json

Liegt nur auf dem Server (`/opt/dashboard/config.json`), ist die einzige Quelle der Wahrheit und
enthält keine Secrets. Aufbau: `src/config/schema.ts` (Zod). `GET /api/config` ist offen im LAN,
`PUT` verlangt `If-Match: <updatedAt>` (409 bei Konflikt) und eine Adresse aus
`DASHBOARD_WRITE_ALLOW`. Kaputte Dateien landen als `config.json.bak`, es wird auf die Defaults
zurückgefallen (`src/config/defaults.ts`). Export/Import geht auch über `:export` / `:import`.

## .env

Nur auf dem Server, `chmod 600`, nicht in Git. Variablen siehe `.env.example`:
`PVE_URL`, `PVE_TOKEN_ID`, `PVE_TOKEN_SECRET`, `PVE_CA_PATH`, `PORT`, `DASHBOARD_CONFIG`,
`DASHBOARD_WRITE_ALLOW`. Leeres `PVE_TOKEN_SECRET` schaltet die Homelab-Pane ab
(„nicht konfiguriert"), der Rest läuft weiter.

### Proxmox-Token erneuern

1. Proxmox-UI → Datacenter → Permissions → API Tokens → Token `startpage` für `dashboard@pve`
   neu erzeugen (Privilege Separation an, Rolle `PVEAuditor` auf `/` für Benutzer und Token)
2. Neues Secret in `/opt/dashboard/.env` als `PVE_TOKEN_SECRET=` eintragen
3. `systemctl restart dashboard` im Container

### pve-ca.pem neu kopieren

Falls die PVE-CA neu erzeugt wird:

```bash
scp root@10.0.10.10:/etc/pve/pve-root-ca.pem ./pve-ca.pem   # lokal
scp pve-ca.pem root@10.0.10.20:/opt/dashboard/              # in den Container
ssh root@10.0.10.20 'chown dashboard:dashboard /opt/dashboard/pve-ca.pem && systemctl restart dashboard'
```

## Restore

Snapshot von CT 113 in der Proxmox-UI zurückspielen (Snapshots → auswählen → Rollback).
Der Dienst startet per `enabled`-Unit von allein; danach einmal `./deploy/deploy.sh`, falls der
Code-Stand neuer sein soll als der Snapshot. Komplett neu: Container anlegen (Schritt 7 in
`PLAN.md`), `provision.sh`, `deploy.sh`, `config.json`/`.env`/`pve-ca.pem` aus dem Backup zurück.
