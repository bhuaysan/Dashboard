# VPS über NetBird: Umsetzungsplan

**Goal:** Das Dashboard auf dem VPS 5.252.224.168 in Docker betreiben, ausschließlich über NetBird, ohne Homelab-Anbindung.
**Spec:** Im Gespräch am 15.09.2026 freigegebener Entwurf (Docker, privater Port, persistenter State, Healthcheck/Rollback).
**Architecture:** NetBird bleibt Host-Dienst. Docker-Bridge mit Bindung 100.113.86.223:8080:7777. Eigene nftables-Tabelle filtert vor Docker-DNAT; nur MacBook 100.113.131.20 und Pixel 100.113.29.51 dürfen zugreifen. systemd wartet auf wt0 und kontrolliert Start/Stop. Keine Änderungen an Traefik oder Heimnetz.
**Tech Stack:** Vorhandenes TypeScript/Hono/React, Node 24, pnpm 11.20.0, Docker Compose, Debian systemd/nftables.

## Aufgaben
- [x] Dockerfile, .dockerignore, compose.vps.yaml, Initialisierung ohne Monitoring; persistentes Verzeichnis /var/lib/dashboard, Umgebungsdatei /etc/dashboard/dashboard.env. Produktionscode und deps ins Image, nicht-root, Healthcheck, read-only root.
- [x] Einmaliges Provisionierungsskript, eigener Firewall- und Startdienst. Keine fremden Regeln löschen. Fail-closed beim Start. Vorhandene Einstellungen nicht überschreiben.
- [x] Eigenes Deployment-Skript: lokale Tests/Build; explizite Build-Dateiliste ohne Secrets per SSH übertragen; Linux/x64-Abhängigkeiten lokal vorbereiten, auf VPS fertige Artefakte als Image verpacken; vor Wechsel State sichern, bei Fehler altes Image aktivieren.
- [x] Verhaltenstests für Release-Erfolg, fehlerhaften Healthcheck und Erstinstallation sowie Initialisierung ohne Überschreiben. pnpm test und pnpm build.
- [x] README, AGENTS.md, PLAN.md aktualisieren.
- [x] VPS provisionieren, privaten/öffentlichen Zugriff, PUT/Persistenz und Neustart prüfen. Nicht verfügbare sudo-Rechte und unabhängige Gegenproben ausdrücklich ausweisen, nicht umgehen.

## Ausführungsnotizen
- Baseline im Ausgangsverzeichnis: pnpm test erfolgreich, 1127 Tests (einschließlich dort vorhandener Worktrees).
- VPS: Docker 29.8.0 / Compose 5.5.1, NetBird 0.78.1; Ports 80/443 gehören NetBird-Traefik.
- ben ist Docker-Mitglied, sudo benötigt Passwort, root-SSH nicht erlaubt. Einmalige Host-Provisionierung durch Benutzer erforderlich, falls kein administrativer Zugang bereitgestellt wird.
- Keine .env gelesen; Proxmox bleibt deaktiviert, CA und Token werden nicht übertragen.

## Abnahme am 15.09.2026

- Aktiv: `dashboard-vps:20260915121456-67045`, Portbindung ausschließlich `100.113.86.223:8080->7777/tcp`, Container healthy.
- Privat vom Mac: Config GET 200, PUT mit unveränderter Config 200; fremde Origin 403.
- Öffentlich IPv4 und IPv6: keine HTTP-Verbindung an Port 8080 (je 5 Sekunden Timeout).
- Monitoring false, Pane false, `/api/homelab` 404. Wetter und News im Browser erfolgreich geladen.
- Absichtlich defektes Release führte zum Rückwechsel auf das ursprüngliche Image. Dessen Healthcheck danach healthy; zuvor gespeicherter Config-Zeitstempel unverändert.
- 361 Tests, beide Deployment-Harnesses und Produktionsbuild erfolgreich.
- systemd-Dienste aktiv/aktiviert. Ein kompletter VPS-Neustart wurde nicht durchgeführt. Pixel und ein anderer echter NetBird-Peer wurden nicht separat bedient; Firewall begrenzt auf MacBook und Pixel.
- Der erste parallele Build überlastete wahrscheinlich den VPS (963 MB RAM, kein Swap). Er wurde abgebrochen. Auch begrenzter Remote-Paketbuild war langsam. Endgültiger Betriebsweg verwendet `Dockerfile.vps` ohne RUN-Schritte und lokal vorbereitete Linux/x64-Abhängigkeiten; eigenständiges mehrstufiges Dockerfile bleibt optional.
- Laufzeitlimit 192 MB; gemessen rund 97 MB. Bestehende NetBird-Container laufen.
- Benutzer hat einmalig Provisionierung mit sudo ausgeführt. Keine NetBird-Management-Policy geändert (Verwaltungsoberfläche verlangt Anmeldung); vorhandene Peer-Verbindung plus eigene restriktive Firewall schützen den Dienst.

- Zugriff aus einem separaten Docker-Bridge-Netz auf den Dashboard-Port ebenfalls gesperrt. Traefik-Erkennung explizit deaktiviert; Docker-init aktiviert.
