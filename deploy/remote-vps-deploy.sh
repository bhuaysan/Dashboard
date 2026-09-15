#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
release_id="${1:-}"
[[ "$release_id" =~ ^[0-9]{14}(-[0-9]+)?$ ]] || { echo 'Ungültige Release-ID.' >&2; exit 2; }
root="${DASHBOARD_VPS_ROOT:-/opt/dashboard}"
state="${DASHBOARD_VPS_STATE:-/var/lib/dashboard}"
release="$root/releases/$release_id"
[[ -f "$release/compose.vps.yaml" && -f "$release/image.env" ]] || exit 2
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'Ein Deployment läuft bereits.' >&2; exit 1; }
previous=""
if [[ -L "$root/current" ]]; then previous="$(readlink "$root/current")"; fi
if [[ -n "$previous" && "$previous" != "$root/releases/"* ]]; then
  echo 'Unerwartetes aktuelles Release.' >&2; exit 2
fi
if [[ "$previous" == "$release" ]]; then echo 'Release ist bereits aktiv.'; exit 0; fi
healthcheck() {
  local attempt
  for ((attempt=0; attempt<${DASHBOARD_HEALTH_ATTEMPTS:-30}; attempt++)); do
    if curl --noproxy '*' -fsS --max-time 3 http://100.113.86.223:8080/api/health | grep -q '"status":"ok"' &&
       curl --noproxy '*' -fsS --max-time 3 http://100.113.86.223:8080/ | grep -q 'id="root"'; then return 0; fi
    sleep "${DASHBOARD_HEALTH_DELAY:-2}"
  done
  return 1
}
rollback() {
  trap - ERR
  echo 'Deployment fehlgeschlagen; vorheriges Release wird wiederhergestellt.' >&2
  sudo -n /usr/bin/systemctl stop dashboard-vps.service || true
  rm -f -- "$root/current.next"
  if [[ -n "$previous" ]]; then
    ln -s "$previous" "$root/current.next"
    mv -Tf "$root/current.next" "$root/current"
    if sudo -n /usr/bin/systemctl restart dashboard-vps.service && healthcheck; then
      echo 'Vorheriges Release ist wieder erreichbar.' >&2
    else
      echo 'Auch das vorherige Release ist nicht erreichbar; Dienst prüfen.' >&2
    fi
  else
    rm -f -- "$root/current"
    echo 'Erstinstallation gestoppt; kein Dashboard-Port veröffentlicht.' >&2
  fi
  exit 1
}
trap rollback ERR
# Konsistentes Backup ohne gleichzeitigen Config-Schreiber.
sudo -n /usr/bin/systemctl stop dashboard-vps.service
mkdir -p "$root/backups"
tar -czf "$root/backups/$release_id.tar.gz" -C "$state" .
cd "$release"
docker compose --project-name personal-dashboard --env-file image.env -f compose.vps.yaml run --rm --no-deps dashboard node --import tsx deploy/init-vps.ts
ln -s "$release" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
sudo -n /usr/bin/systemctl restart dashboard-vps.service
healthcheck
trap - ERR
echo "VPS-Release $release_id ist aktiv."
