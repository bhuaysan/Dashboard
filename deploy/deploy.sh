#!/usr/bin/env bash
set -euo pipefail
HOST=root@10.0.10.20
pnpm build
rsync -a --delete dist/ "$HOST:/opt/dashboard/dist/"
rsync -a --delete server/ "$HOST:/opt/dashboard/server/"
rsync -a --delete --exclude "*.test.*" --exclude "test/" src/ "$HOST:/opt/dashboard/src/"
rsync -a package.json pnpm-lock.yaml "$HOST:/opt/dashboard/"
ssh "$HOST" 'cd /opt/dashboard && npm install --omit=dev && systemctl restart dashboard'
