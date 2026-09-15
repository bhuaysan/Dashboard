FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN NODE_OPTIONS=--max-old-space-size=128 pnpm install --frozen-lockfile --network-concurrency=2 --child-concurrency=1
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json postcss.config.js tailwind.config.js ./
COPY src ./src
COPY server ./server
COPY public ./public
RUN NODE_OPTIONS=--max-old-space-size=128 pnpm build

# Abhängigkeit vom Builder erzwingt sequenziellen Build auf dem kleinen VPS.
FROM builder AS dependencies
RUN NODE_OPTIONS=--max-old-space-size=128 pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production PORT=7777 DASHBOARD_CONFIG=/data/config.json DASHBOARD_STATIC=/data/static
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/server ./server
COPY deploy/init-vps.ts ./deploy/init-vps.ts
USER 1000:1000
EXPOSE 7777
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:7777/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node_modules/.bin/tsx", "server/index.ts"]
