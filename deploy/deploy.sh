#!/usr/bin/env bash
set -euo pipefail

HOST=root@10.0.10.20
REMOTE_ROOT=/opt/dashboard
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)-$$"
REMOTE_RELEASE="$REMOTE_ROOT/releases/$RELEASE_ID"

# Ein Release darf den aktiven Stand erst erreichen, wenn genau derselbe Quellstand lokal
# getestet und gebaut wurde.
pnpm test
pnpm build
git diff --check

# State und alte Installationen einmalig aus dem bisherigen Layout übernehmen. Die Schritte
# sind idempotent und fassen weder .env-Inhalte noch Configwerte im lokalen Prozess an.
ssh "$HOST" 'bash -se' <<'REMOTE'
set -euo pipefail
install -d -o root -g root -m 0755 /opt/dashboard /opt/dashboard/releases
install -d -o dashboard -g dashboard -m 0750 /var/lib/dashboard /var/lib/dashboard/static
install -d -o root -g root -m 0755 /etc/dashboard

if [[ ! -e /var/lib/dashboard/config.json && -f /opt/dashboard/config.json ]]; then
  install -o dashboard -g dashboard -m 0600 /opt/dashboard/config.json /var/lib/dashboard/config.json
fi
if [[ ! -e /etc/dashboard/dashboard.env && -f /opt/dashboard/.env ]]; then
  install -o root -g root -m 0600 /opt/dashboard/.env /etc/dashboard/dashboard.env
fi
if [[ ! -e /etc/dashboard/pve-ca.pem && -f /opt/dashboard/pve-ca.pem ]]; then
  install -o root -g dashboard -m 0640 /opt/dashboard/pve-ca.pem /etc/dashboard/pve-ca.pem
fi
if [[ -d /opt/dashboard/static ]]; then
  rsync -a /opt/dashboard/static/ /var/lib/dashboard/static/
fi

set_env() {
  local name="$1"
  local value="$2"
  if grep -q "^${name}=" /etc/dashboard/dashboard.env; then
    sed -i "s|^${name}=.*|${name}=${value}|" /etc/dashboard/dashboard.env
  else
    printf '%s=%s\n' "$name" "$value" >> /etc/dashboard/dashboard.env
  fi
}

set_env DASHBOARD_CONFIG /var/lib/dashboard/config.json
set_env DASHBOARD_STATIC /var/lib/dashboard/static
set_env PVE_CA_PATH /etc/dashboard/pve-ca.pem
chown root:root /etc/dashboard/dashboard.env
chmod 0600 /etc/dashboard/dashboard.env
chown dashboard:dashboard /var/lib/dashboard
REMOTE

ssh "$HOST" "install -d -o root -g root -m 0755 '$REMOTE_RELEASE'"
rsync -a --delete dist/ "$HOST:$REMOTE_RELEASE/dist/"
rsync -a --delete server/ "$HOST:$REMOTE_RELEASE/server/"
rsync -a --delete --exclude '*.test.*' --exclude 'test/' src/ "$HOST:$REMOTE_RELEASE/src/"
rsync -a package.json pnpm-lock.yaml pnpm-workspace.yaml "$HOST:$REMOTE_RELEASE/"
rsync -a deploy/dashboard.service "$HOST:/tmp/dashboard.service.$RELEASE_ID"
rsync -a deploy/remote-deploy.sh "$HOST:/tmp/dashboard.remote-deploy.$RELEASE_ID"

ssh "$HOST" bash -se -- "$RELEASE_ID" <<'REMOTE'
set -euo pipefail
release_id="$1"
script="/tmp/dashboard.remote-deploy.$release_id"
trap 'rm -f -- "$script"' EXIT
bash "$script" "$release_id"
REMOTE
