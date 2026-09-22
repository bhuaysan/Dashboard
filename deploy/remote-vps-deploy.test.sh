#!/usr/bin/env bash
set -euo pipefail
test_root="$(mktemp -d "${TMPDIR:-/tmp}/dashboard-vps-test.XXXXXX")"
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/bin"
cat > "$test_root/bin/docker" <<'FAKE'
#!/usr/bin/env bash
if [[ "$*" == *'run --rm'* && "${INIT_FAIL:-0}" == 1 ]]; then exit 1; fi
exit 0
FAKE
cat > "$test_root/bin/sudo" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DASHBOARD_VPS_ROOT/service.log"
FAKE
cat > "$test_root/bin/curl" <<'FAKE'
#!/usr/bin/env bash
if [[ "${HEALTH_FAIL:-0}" == 1 && "$(readlink "$DASHBOARD_VPS_ROOT/current")" == */20260915000002 ]]; then exit 22; fi
if [[ "${!#}" == */api/health ]]; then printf '%s\n' '{"status":"ok"}'; else printf '%s\n' '<div id="root"></div>'; fi
FAKE
cat > "$test_root/bin/flock" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE
# macOS mv ne propose pas -T, contrairement au VPS Debian.
cat > "$test_root/bin/mv" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == -Tf ]]; then shift; /bin/rm -f "$2"; /bin/mv -f "$@"; else /bin/mv "$@"; fi
FAKE
chmod +x "$test_root/bin/"*
run_case() {
  local name="$1" old="$2" health_fail="$3" init_fail="$4" expected="$5"
  local root="$test_root/$name"
  mkdir -p "$root/releases/20260915000001" "$root/releases/20260915000002" "$root/state"
  printf 'preserve' > "$root/state/marker"
  printf 'uptime-preserve' > "$root/state/uptime.json"
  touch "$root/releases/20260915000002/compose.vps.yaml" "$root/releases/20260915000002/image.env"
  if [[ "$old" == 1 ]]; then ln -s "$root/releases/20260915000001" "$root/current"; fi
  local status=0
  PATH="$test_root/bin:$PATH" DASHBOARD_VPS_ROOT="$root" DASHBOARD_VPS_STATE="$root/state" DASHBOARD_HEALTH_ATTEMPTS=1 DASHBOARD_HEALTH_DELAY=0 HEALTH_FAIL="$health_fail" INIT_FAIL="$init_fail" bash deploy/remote-vps-deploy.sh 20260915000002 || status=$?
  if [[ "$expected" == success ]]; then
    [[ "$status" == 0 ]] || exit 1
    [[ "$(readlink "$root/current")" == "$root/releases/20260915000002" ]] || exit 1
  else
    [[ "$status" != 0 ]] || exit 1
    if [[ "$old" == 1 ]]; then [[ "$(readlink "$root/current")" == "$root/releases/20260915000001" ]] || exit 1; else [[ ! -e "$root/current" && ! -L "$root/current" ]] || exit 1; fi
  fi
  [[ "$(cat "$root/state/marker")" == preserve ]] || exit 1
  [[ "$(cat "$root/state/uptime.json")" == uptime-preserve ]] || exit 1
  [[ -f "$root/backups/20260915000002.tar.gz" ]] || exit 1
  tar -tzf "$root/backups/20260915000002.tar.gz" | grep -Fxq './uptime.json' || exit 1
  [[ ! -L "$root/current.next" ]] || exit 1
}
run_case first 0 0 0 success
run_case upgrade 1 0 0 success
run_case unhealthy 1 1 0 failure
run_case first_unhealthy 0 1 0 failure
run_case init_failure 1 0 1 failure
printf '%s\n' 'VPS-Deploy-Harness: erfolgreich'
