#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/dashboard-package-vps-test.XXXXXX")"
sentinel_untracked="$repo_root/server/.package-vps-untracked-${RANDOM}.ts"
sentinel_ignored="$repo_root/src/.package-vps-ignored-${RANDOM}.local"
created_dist=false

cleanup() {
  rm -f -- "$sentinel_untracked" "$sentinel_ignored"
  if [[ "$created_dist" == true ]]; then
    rm -rf -- "$repo_root/dist"
  fi
  rm -rf -- "$test_root"
}
trap cleanup EXIT

printf '%s\n' 'export const leaked = true;' > "$sentinel_untracked"
printf '%s\n' 'export const ignored = true;' > "$sentinel_ignored"
git -C "$repo_root" check-ignore --quiet -- "$sentinel_ignored"

if [[ ! -f "$repo_root/dist/index.html" ]]; then
  mkdir -p -- "$repo_root/dist"
  printf '%s\n' '<div id="root"></div>' > "$repo_root/dist/index.html"
  created_dist=true
fi

mkdir -p -- "$test_root/bin" "$test_root/bundle"
cat > "$test_root/bin/pnpm" <<'FAKE'
#!/usr/bin/env bash
if [[ -n "${DASHBOARD_TEST_PNPM_MARKER:-}" ]]; then
  : > "$DASHBOARD_TEST_PNPM_MARKER"
fi
exit 0
FAKE
chmod +x "$test_root/bin/pnpm"

PATH="$test_root/bin:$PATH" bash "$repo_root/deploy/package-vps.sh" "$test_root/bundle"

[[ -f "$test_root/bundle/dist/index.html" ]] || { echo 'Gebautes dist fehlt.' >&2; exit 1; }
[[ -f "$test_root/bundle/src/App.tsx" ]] || { echo 'Committed src fehlt.' >&2; exit 1; }
[[ -f "$test_root/bundle/server/index.ts" ]] || { echo 'Committed server fehlt.' >&2; exit 1; }
[[ ! -e "$test_root/bundle/server/$(basename -- "$sentinel_untracked")" ]] || {
  echo 'Untracked server file wurde paketiert.' >&2
  exit 1
}
[[ ! -e "$test_root/bundle/src/$(basename -- "$sentinel_ignored")" ]] || {
  echo 'Ignored src file wurde paketiert.' >&2
  exit 1
}
if find "$test_root/bundle/src" "$test_root/bundle/server" -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) -print -quit | grep -q .; then
  echo 'Testdatei wurde paketiert.' >&2
  exit 1
fi
if find "$test_root/bundle/src" "$test_root/bundle/server" -type f -path '*/test/*' -print -quit | grep -q .; then
  echo 'Testunterstützung wurde paketiert.' >&2
  exit 1
fi

real_git="$(command -v git)"
cat > "$test_root/bin/git" <<GIT
#!/usr/bin/env bash
if [[ "\${1:-}" == diff && "\${2:-}" == --quiet ]]; then
  exit 1
fi
exec "$real_git" "\$@"
GIT
chmod +x "$test_root/bin/git"
cat > "$test_root/bin/ssh" <<'FAKE'
#!/usr/bin/env bash
: > "${DASHBOARD_TEST_SSH_MARKER:?}"
exit 99
FAKE
chmod +x "$test_root/bin/ssh"
pnpm_marker="$test_root/pnpm-called"
ssh_marker="$test_root/ssh-called"
deploy_status=0
PATH="$test_root/bin:$PATH" DASHBOARD_TEST_PNPM_MARKER="$pnpm_marker" DASHBOARD_TEST_SSH_MARKER="$ssh_marker" bash "$repo_root/deploy/deploy-vps.sh" > "$test_root/deploy.log" 2>&1 || deploy_status=$?
[[ "$deploy_status" != 0 ]] || { echo 'Deployment akzeptiert schmutzige Build-Eingaben.' >&2; exit 1; }
[[ ! -e "$pnpm_marker" ]] || {
  echo 'pnpm wurde trotz schmutziger Build-Eingaben ausgeführt.' >&2
  exit 1
}
[[ ! -e "$ssh_marker" ]] || {
  echo 'SSH wurde trotz schmutziger Build-Eingaben ausgeführt.' >&2
  exit 1
}
if ! grep -Fq 'Build-Eingaben' "$test_root/deploy.log"; then
  echo 'Fehlermeldung für schmutzige Build-Eingaben fehlt.' >&2
  exit 1
fi

printf '%s\n' 'VPS-Package-Harness: erfolgreich'
