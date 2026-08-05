#!/usr/bin/env bash
# Einmalige Einrichtung des Containers 10.0.10.20.
# Aufruf aus dem Projektverzeichnis:  ./deploy/provision.sh
set -euo pipefail
HOST=root@10.0.10.20

ssh "$HOST" 'bash -se' <<'REMOTE'
apt update && apt install -y curl rsync
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
fi
id dashboard &>/dev/null || useradd -r -s /usr/sbin/nologin -d /opt/dashboard dashboard
mkdir -p /opt/dashboard
chown dashboard:dashboard /opt/dashboard
REMOTE

scp deploy/dashboard.service "$HOST:/etc/systemd/system/dashboard.service"
scp config.json .env pve-ca.pem "$HOST:/opt/dashboard/"

# Server-Kopie der .env auf Produktionswerte umstellen (Secret bleibt unangetastet)
ssh "$HOST" "bash -se" <<'REMOTE'
cd /opt/dashboard
sed -i \
  -e 's|^PORT=.*|PORT=80|' \
  -e 's|^DASHBOARD_CONFIG=.*|DASHBOARD_CONFIG=/opt/dashboard/config.json|' \
  -e 's|^PVE_CA_PATH=.*|PVE_CA_PATH=/opt/dashboard/pve-ca.pem|' \
  -e 's|^DASHBOARD_WRITE_ALLOW=.*|DASHBOARD_WRITE_ALLOW=10.0.10.0/24|' \
  .env
chown dashboard:dashboard /opt/dashboard/{config.json,.env,pve-ca.pem}
chmod 600 /opt/dashboard/.env
systemctl daemon-reload
systemctl enable dashboard
REMOTE

echo "Provisionierung fertig. Jetzt ./deploy/deploy.sh ausführen."
