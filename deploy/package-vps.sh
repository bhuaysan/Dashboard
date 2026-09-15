#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
bundle="${1:?Leeres Zielverzeichnis angeben}"
[[ -d "$bundle" && -z "$(ls -A "$bundle")" ]] || { echo 'Zielverzeichnis muss leer sein.' >&2; exit 2; }
[[ -f dist/index.html ]] || { echo 'Zuerst pnpm build ausführen.' >&2; exit 2; }
cp package.json pnpm-lock.yaml pnpm-workspace.yaml "$bundle/"
# Nur Linux/x64 wird ausgeliefert. Keine fremden Installationsskripte auf macOS ausführen.
# Die einzige native Runtime-Abhängigkeit ist das vorgebaute @esbuild/linux-x64-Binary.
pnpm --dir "$bundle" install --prod --frozen-lockfile --ignore-scripts --cpu=x64 --os=linux --libc=glibc --package-import-method=copy --network-concurrency=4 --child-concurrency=1
cp Dockerfile.vps "$bundle/Dockerfile"
cp compose.vps.yaml "$bundle/"
mkdir -p "$bundle/deploy"
cp deploy/init-vps.ts deploy/remote-vps-deploy.sh "$bundle/deploy/"
# Explizite Liste statt Repository-Upload. .env, Config und Zertifikate bleiben lokal.
tar --exclude='*.test.ts' --exclude='*.test.tsx' -cf - dist src server | tar -xf - -C "$bundle"
cat > "$bundle/.dockerignore" <<'IGNORE'
**/.env
**/.env.*
**/config.json
**/pve-ca.pem
IGNORE
