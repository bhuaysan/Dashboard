#!/usr/bin/env bash
# Einmalige Einrichtung von go-librespot im Dashboard-Container (10.0.10.20).
# go-librespot ist ein headless Spotify-Connect-Gerät („Homelab"): es schreibt
# rohes PCM in eine FIFO, der Dashboard-Server streamt sie als /api/music/stream.
# Aufruf aus dem Projektverzeichnis:  ./deploy/provision-librespot.sh
set -euo pipefail
HOST=root@10.0.10.20
VERSION=0.8.0

ssh "$HOST" 'bash -se' <<REMOTE
set -euo pipefail

# Auch mit Pipe-Backend ist das Binary gegen ALSA gelinkt — libasound muss da sein.
apt update && apt install -y libasound2t64

if ! command -v go-librespot >/dev/null; then
  curl -fsSL "https://github.com/devgianlu/go-librespot/releases/download/v${VERSION}/go-librespot_linux_x86_64.tar.gz" \
    -o /tmp/go-librespot.tar.gz
  tar -xzf /tmp/go-librespot.tar.gz -C /tmp
  install -m 0755 /tmp/go-librespot /usr/local/bin/go-librespot
  rm /tmp/go-librespot.tar.gz /tmp/go-librespot
fi

id librespot &>/dev/null || useradd -r -s /usr/sbin/nologin -d /var/lib/go-librespot librespot
mkdir -p /var/lib/go-librespot

cat > /var/lib/go-librespot/config.yml <<'CONF'
device_name: "Homelab"
device_type: "speaker"
audio_backend: "pipe"
audio_output_pipe: "/run/go-librespot/spotify.pcm"
audio_output_pipe_format: "s16le"
bitrate: 320
zeroconf_enabled: true
volume_steps: 100
credentials:
  type: zeroconf
  zeroconf:
    persist_credentials: true
CONF

# Das config_dir muss dem Dienst gehören: dort landet auch die credentials.json
# aus der Zeroconf-Kopplung.
chown -R librespot:librespot /var/lib/go-librespot
# Der Dashboard-User liest die FIFO — O_RDWR braucht Schreibrecht, deshalb
# Gruppenmitgliedschaft statt Welt-Lesbarkeit.
usermod -aG librespot dashboard

cat > /etc/systemd/system/go-librespot.service <<'UNIT'
[Unit]
Description=go-librespot Spotify Connect (Homelab)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=librespot
WorkingDirectory=/var/lib/go-librespot
RuntimeDirectory=go-librespot
ExecStartPre=/bin/sh -c 'test -p /run/go-librespot/spotify.pcm || mkfifo -m 0660 /run/go-librespot/spotify.pcm'
ExecStart=/usr/local/bin/go-librespot --config_dir /var/lib/go-librespot
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now go-librespot
REMOTE

echo "--- Dienst ---"
ssh "$HOST" 'systemctl is-active go-librespot; journalctl -u go-librespot --no-pager -n 8'
echo
echo "Fertig. Einmalig koppeln: Spotify-App im LAN öffnen → Geräte → «Homelab» wählen."
echo "Danach bleibt das Gerät dauerhaft autorisiert (credentials.json im Container)."
