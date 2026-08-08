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

ssh "$HOST" bash -se -- "$RELEASE_ID" <<'REMOTE'
set -euo pipefail
release_id="$1"
release_dir="/opt/dashboard/releases/$release_id"
current="/opt/dashboard/current"
previous_target=""
previous_unit="/tmp/dashboard.service.previous.$$"

if [[ -L "$current" ]]; then
  previous_target="$(readlink "$current")"
fi
if [[ -f /etc/systemd/system/dashboard.service ]]; then
  cp /etc/systemd/system/dashboard.service "$previous_unit"
fi

rollback() {
  trap - ERR
  set +e
  if [[ -n "$previous_target" ]]; then
    ln -sfn "$previous_target" "${current}.rollback"
    mv -Tf "${current}.rollback" "$current"
  else
    rm -f "$current"
  fi
  if [[ -f "$previous_unit" ]]; then
    install -o root -g root -m 0644 "$previous_unit" /etc/systemd/system/dashboard.service
  fi
  systemctl daemon-reload
  systemctl restart dashboard
  rm -f "$previous_unit"
  exit 1
}
trap rollback ERR

cd "$release_dir"
corepack enable
corepack install --global pnpm@11.20.0
corepack pnpm install --prod --frozen-lockfile
test -x node_modules/.bin/tsx
node_modules/.bin/tsx --version >/dev/null

install -o root -g root -m 0644 "/tmp/dashboard.service.$release_id" /etc/systemd/system/dashboard.service
systemctl daemon-reload
ln -sfn "$release_dir" "${current}.next"
mv -Tf "${current}.next" "$current"
systemctl restart dashboard
systemctl is-active --quiet dashboard
curl --fail --silent --show-error --max-time 10 http://127.0.0.1/api/health >/dev/null

trap - ERR
rm -f "/tmp/dashboard.service.$release_id" "$previous_unit"
echo "Release $release_id ist aktiv."
REMOTE
