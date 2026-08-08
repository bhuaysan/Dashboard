#!/usr/bin/env bash
# Einmalige Einrichtung des Containers 10.0.10.20.
# Aufruf aus dem Projektverzeichnis:  ./deploy/provision.sh
set -euo pipefail
HOST=root@10.0.10.20

ssh "$HOST" 'bash -se' <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt update && apt install -y curl rsync
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [[ "$node_major" != "22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
fi
corepack enable
corepack install --global pnpm@11.20.0

id dashboard >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d /opt/dashboard dashboard

# Code und Dependencies liegen in root-owned Releases. Nur der Laufzeit-State bleibt für
# den Dienst beschreibbar; dadurch kann der Prozess seinen eigenen Code nicht ersetzen.
install -d -o root -g root -m 0755 /opt/dashboard /opt/dashboard/releases
install -d -o dashboard -g dashboard -m 0750 /var/lib/dashboard /var/lib/dashboard/static
install -d -o root -g root -m 0755 /etc/dashboard
REMOTE

scp deploy/dashboard.service "$HOST:/etc/systemd/system/dashboard.service"
scp config.json "$HOST:/var/lib/dashboard/config.json"
scp .env "$HOST:/etc/dashboard/dashboard.env"
scp pve-ca.pem "$HOST:/etc/dashboard/pve-ca.pem"

# Serverkopie der Umgebungsdatei auf Produktionswerte umstellen (Secrets bleiben unangetastet).
ssh "$HOST" 'bash -se' <<'REMOTE'
set -euo pipefail

set_env() {
  local name="$1"
  local value="$2"
  if grep -q "^${name}=" /etc/dashboard/dashboard.env; then
    sed -i "s|^${name}=.*|${name}=${value}|" /etc/dashboard/dashboard.env
  else
    printf '%s=%s\n' "$name" "$value" >> /etc/dashboard/dashboard.env
  fi
}

set_env PORT 80
set_env DASHBOARD_CONFIG /var/lib/dashboard/config.json
set_env DASHBOARD_STATIC /var/lib/dashboard/static
set_env PVE_CA_PATH /etc/dashboard/pve-ca.pem
set_env DASHBOARD_WRITE_ALLOW 10.0.10.0/24

chown dashboard:dashboard /var/lib/dashboard/config.json
chmod 600 /var/lib/dashboard/config.json
chown root:root /etc/dashboard/dashboard.env
chmod 600 /etc/dashboard/dashboard.env
chown root:dashboard /etc/dashboard/pve-ca.pem
chmod 0640 /etc/dashboard/pve-ca.pem
systemctl daemon-reload
systemctl enable dashboard
REMOTE

echo "Provisionierung fertig. Jetzt ./deploy/deploy.sh ausführen."
