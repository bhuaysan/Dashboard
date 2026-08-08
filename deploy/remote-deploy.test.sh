#!/usr/bin/env bash
set -euo pipefail

test_root="$(mktemp -d "${TMPDIR:-/tmp}/dashboard-deploy-test.XXXXXX")"
trap 'rm -rf -- "$test_root"' EXIT
fake_bin="$test_root/bin"
mkdir -p "$fake_bin"

cat > "$fake_bin/corepack" <<'FAKE'
#!/usr/bin/env bash
if [[ "${DASHBOARD_INSTALL_FAIL:-0}" == "1" && "${1:-}" == "pnpm" ]]; then exit 1; fi
exit 0
FAKE
cat > "$fake_bin/chown" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${DASHBOARD_TEST_ROOT}/chown.log"
exit 0
FAKE
cat > "$fake_bin/install" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
after=false
source=""
target=""
while (($# > 0)); do
  case "$1" in
    --) after=true; shift ;;
    -o|-g|-m) shift 2 ;;
    *)
      if [[ "$after" == true ]]; then
        if [[ -z "$source" ]]; then source="$1"; else target="$1"; fi
      fi
      shift
      ;;
  esac
done
if [[ -z "$source" || -z "$target" ]]; then exit 2; fi
cp -- "$source" "$target"
chmod 0644 "$target"
FAKE
cat > "$fake_bin/systemctl" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  is-active|daemon-reload|restart|stop) exit 0 ;;
  *) exit 0 ;;
esac
FAKE
cat > "$fake_bin/curl" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
url="${!#}"
if [[ "$url" == */api/health ]]; then
  printf '%s\n' '{"status":"ok"}'
elif [[ "${DASHBOARD_FRONTEND_FAIL:-0}" == "1" ]]; then
  printf '%s\n' '<html>broken</html>'
else
  printf '%s\n' '<html><body><div id="root"></div></body></html>'
fi
FAKE
cat > "$fake_bin/mv" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-Tf" ]]; then
  shift
  [[ "${1:-}" == "--" ]] && shift
  /bin/mv -f -- "$@"
else
  /bin/mv "$@"
fi
FAKE
cat > "$fake_bin/find" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *" -perm /022 "* ]]; then exit 1; fi
root="$1"
for path in "$root"/*; do
  [[ -d "$path" ]] && basename "$path"
done
FAKE
chmod +x "$fake_bin"/*

prepare_case() {
  local root="$1"
  local old_id="20260808000000-1"
  local new_id="20260808010000-2"
  mkdir -p "$root/remote/releases/$old_id/node_modules/.bin"
  mkdir -p "$root/remote/releases/$new_id/node_modules/.bin"
  for id in 20260807000000-1 20260806000000-1 20260805000000-1; do
    mkdir -p "$root/remote/releases/$id"
  done
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$root/remote/releases/$new_id/node_modules/.bin/tsx"
  chmod +x "$root/remote/releases/$new_id/node_modules/.bin/tsx"
  printf '%s\n' 'old unit' > "$root/unit"
  printf '%s\n' 'new unit' > "$root/unit-source"
  ln -s "$root/remote/releases/$old_id" "$root/remote/current"
}

run_release() {
  local root="$1"
  local id="$2"
  PATH="$fake_bin:$PATH" \
    DASHBOARD_REMOTE_ROOT="$root/remote" \
    DASHBOARD_CURRENT_LINK="$root/remote/current" \
    DASHBOARD_UNIT_PATH="$root/unit" \
    DASHBOARD_UNIT_SOURCE="$root/unit-source" \
    DASHBOARD_TEST_ROOT="$root" \
    DASHBOARD_HEALTH_ATTEMPTS=1 \
    DASHBOARD_HEALTH_DELAY=0 \
    "$PWD/deploy/remote-deploy.sh" "$id"
}

success_root="$test_root/success"
mkdir -p "$success_root"
prepare_case "$success_root"
run_release "$success_root" "20260808010000-2"
[[ "$(readlink "$success_root/remote/current")" == "$success_root/remote/releases/20260808010000-2" ]]
[[ ! -e "$success_root/unit-source" ]]
grep -q 'root:root' "$success_root/chown.log"
[[ "$(find "$success_root/remote/releases" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" == 3 ]]

failure_root="$test_root/failure"
mkdir -p "$failure_root"
prepare_case "$failure_root"
if DASHBOARD_FRONTEND_FAIL=1 run_release "$failure_root" "20260808010000-2"; then
  echo "Ein fehlerhafter Frontend-Healthcheck wurde akzeptiert." >&2
  exit 1
fi
[[ "$(readlink "$failure_root/remote/current")" == "$failure_root/remote/releases/20260808000000-1" ]]
[[ ! -e "$failure_root/remote/releases/20260808010000-2" ]]
[[ ! -e "$failure_root/remote/current.next" ]]
[[ ! -e "$failure_root/remote/current.rollback" ]]
[[ ! -e "$failure_root/unit-source" ]]
[[ "$(<"$failure_root/unit")" == "old unit" ]]

install_failure_root="$test_root/install-failure"
mkdir -p "$install_failure_root"
prepare_case "$install_failure_root"
if DASHBOARD_INSTALL_FAIL=1 run_release "$install_failure_root" "20260808010000-2"; then
  echo "Ein fehlgeschlagener Installationsschritt wurde akzeptiert." >&2
  exit 1
fi
[[ "$(readlink "$install_failure_root/remote/current")" == "$install_failure_root/remote/releases/20260808000000-1" ]]
[[ ! -e "$install_failure_root/remote/releases/20260808010000-2" ]]
[[ ! -e "$install_failure_root/unit-source" ]]
[[ "$(<"$install_failure_root/unit")" == "old unit" ]]

echo "Remote-Deploy-Harness: erfolgreich"
