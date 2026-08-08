#!/usr/bin/env bash
set -euo pipefail

release_id="${1:?Release-ID fehlt}"
remote_root="$(readlink -f -- "${DASHBOARD_REMOTE_ROOT:-/opt/dashboard}")"
release_root="$remote_root/releases"
release_dir="$release_root/$release_id"
current="${DASHBOARD_CURRENT_LINK:-$remote_root/current}"
unit_path="${DASHBOARD_UNIT_PATH:-/etc/systemd/system/dashboard.service}"
unit_source="${DASHBOARD_UNIT_SOURCE:-/tmp/dashboard.service.$release_id}"
previous_unit="/tmp/dashboard.service.previous.$$"
previous_target=""
previous_unit_exists=false

is_release_name() {
  [[ "$1" =~ ^[0-9]{14}-[0-9]+$ ]]
}

if ! is_release_name "$release_id" || [[ ! -d "$release_dir" ]]; then
  echo "Ungültiges oder fehlendes Release: $release_id" >&2
  exit 1
fi

if [[ -L "$current" ]]; then
  resolved_current="$(readlink -f -- "$current" || true)"
  if [[ "$resolved_current" == "$release_root/"* ]] &&
     is_release_name "${resolved_current##*/}" && [[ -d "$resolved_current" ]]; then
    previous_target="$resolved_current"
  fi
fi
if [[ -f "$unit_path" ]]; then
  cp -- "$unit_path" "$previous_unit"
  previous_unit_exists=true
fi

rollback() {
  trap - ERR
  set +e
  rm -f -- "${current}.next" "${current}.rollback"
  if [[ -n "$previous_target" ]]; then
    ln -s -- "$previous_target" "${current}.rollback"
    mv -Tf -- "${current}.rollback" "$current"
  else
    rm -f -- "$current"
  fi
  if [[ "$previous_unit_exists" == true ]]; then
    install -o root -g root -m 0644 -- "$previous_unit" "$unit_path"
  else
    rm -f -- "$unit_path"
  fi
  systemctl daemon-reload
  if [[ "$previous_unit_exists" == true ]]; then
    systemctl restart dashboard
  else
    systemctl stop dashboard
  fi
  rm -f -- "$unit_source" "$previous_unit"
  if [[ -d "$release_dir" && ! -L "$release_dir" ]]; then
    rm -rf -- "$release_dir"
  fi
  exit 1
}
trap rollback ERR

cd -- "$release_dir"
corepack enable
corepack install --global pnpm@11.20.0
corepack pnpm install --prod --frozen-lockfile
test -x node_modules/.bin/tsx
node_modules/.bin/tsx --version >/dev/null

# Upload und pnpm dürfen keine schreibbaren Produktionsdateien hinterlassen. Die Prüfung
# umfasst auch Verzeichnisse, damit der Dienst weder Code noch Dependencies ersetzen kann.
chown -R root:root -- "$release_dir"
if find "$release_dir" -xdev \( -type f -o -type d \) -perm /022 -print -quit | grep -q .; then
  echo "Release enthält group/world-writable Dateien oder Verzeichnisse." >&2
  false
fi

install -o root -g root -m 0644 -- "$unit_source" "$unit_path"
systemctl daemon-reload
rm -f -- "${current}.next"
ln -s -- "$release_dir" "${current}.next"
mv -Tf -- "${current}.next" "$current"
systemctl restart dashboard

health_ok=false
health_attempts="${DASHBOARD_HEALTH_ATTEMPTS:-30}"
health_delay="${DASHBOARD_HEALTH_DELAY:-1}"
for ((attempt = 1; attempt <= health_attempts; attempt += 1)); do
  if systemctl is-active --quiet dashboard \
    && curl --fail --silent --max-time 2 http://127.0.0.1/api/health >/dev/null \
    && curl --fail --silent --max-time 2 http://127.0.0.1/ | grep -Fq '<div id="root">'; then
    health_ok=true
    break
  fi
  sleep "$health_delay"
done
if [[ "$health_ok" != true ]]; then
  echo "Healthcheck für dashboard.service oder Frontend fehlgeschlagen." >&2
  false
fi

cleanup_releases() {
  local active name path kept=0
  active="$(readlink -f -- "$current")"
  if [[ "$active" != "$release_root/"* ]] || ! is_release_name "${active##*/}"; then
    echo "Aktiver Release-Link zeigt auf ein unerwartetes Ziel." >&2
    return 1
  fi
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    is_release_name "$name" || continue
    [[ "$name" == "${active##*/}" ]] && continue
    if (( kept < 2 )); then
      kept=$((kept + 1))
      continue
    fi
    path="$release_root/$name"
    if [[ -d "$path" && ! -L "$path" ]]; then
      rm -rf -- "$path"
    fi
  done < <(find "$release_root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
}

cleanup_releases
trap - ERR
rm -f -- "$unit_source" "$previous_unit"
echo "Release $release_id ist aktiv."
