#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
host=ben@5.252.224.168
release_id="$(date -u +%Y%m%d%H%M%S)-$$"
image="dashboard-vps:$release_id"
release="/opt/dashboard/releases/$release_id"
build_inputs=(
  .dockerignore
  Dockerfile.vps
  compose.vps.yaml
  index.html
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  postcss.config.js
  public
  server
  src
  tailwind.config.js
  tsconfig.app.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
  deploy/deploy-vps.sh
  deploy/init-vps.ts
  deploy/package-vps.sh
  deploy/remote-vps-deploy.sh
)
if ! git diff --quiet HEAD -- "${build_inputs[@]}"; then
  echo 'Build-Eingaben sind nicht auf HEAD committed; Deployment abgebrochen.' >&2
  git diff --name-only HEAD -- "${build_inputs[@]}" >&2
  exit 1
fi
untracked_inputs="$(git status --porcelain=v1 --untracked-files=all --ignored -- "${build_inputs[@]}")"
if [[ -n "$untracked_inputs" ]]; then
  echo 'Build-Eingaben enthalten untracked oder ignorierte Dateien; Deployment abgebrochen.' >&2
  printf '%s\n' "$untracked_inputs" >&2
  exit 1
fi
pnpm test
pnpm build
git diff --check
ssh -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o BatchMode=yes "$host" 'test -d /opt/dashboard/releases && test -r /etc/dashboard/dashboard.env && systemctl is-active --quiet dashboard-vps-firewall.service' || {
  echo 'Zuerst deploy/provision-vps.sh einmalig mit sudo auf dem VPS ausführen.' >&2
  exit 1
}
bundle="$(mktemp -d "${TMPDIR:-/tmp}/dashboard-vps-bundle.XXXXXX")"
trap 'rm -rf -- "$bundle"' EXIT
bash deploy/package-vps.sh "$bundle"
ssh -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 "$host" "umask 077; mkdir '$release'"
COPYFILE_DISABLE=1 tar --no-xattrs -czf - -C "$bundle" . |
  ssh -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 "$host" "tar -xzf - -C '$release'"
ssh -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 "$host" bash -s -- "$release_id" "$image" <<'REMOTE'
set -euo pipefail
release="/opt/dashboard/releases/$1"
cd "$release"
docker build --resource memory=256m --resource memory-swap=256m --resource cpu-quota=50000 --pull -t "$2" .
printf 'DASHBOARD_IMAGE=%s\n' "$2" > image.env
bash deploy/remote-vps-deploy.sh "$1"
REMOTE
printf 'Dashboard: http://100.113.86.223:8080 (NetBird erforderlich)\n'
