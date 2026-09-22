// Diese Datei ist ausschließlich der ausführbare Einstiegspunkt. Die App-Fabrik liegt in
// app.ts, damit Tests eine synthetische Umgebung verwenden können, ohne load-env.ts auszuführen.
import "./load-env.ts";

import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { env } from "./env.ts";
import { createApp } from "./app.ts";
import { createConfigStore } from "./config-store.ts";
import { createUptimeMonitor } from "./uptime-monitor.ts";
import { createUptimeStateStore } from "./uptime-store.ts";
import { probeTarget } from "./uptime-probe.ts";

const distRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "dist");
const configStore = createConfigStore(env.configPath);
const uptimeMonitor = createUptimeMonitor({
  configStore,
  stateStore: createUptimeStateStore(env.uptimePath),
  probe: probeTarget,
});
const app = createApp({ env, distRoot, configStore, uptimeReader: uptimeMonitor });

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
  await uptimeMonitor.initialize();
  uptimeMonitor.start();
  serve({ fetch: app.fetch, port: env.port }, (info) => {
    console.log(`dashboard-server auf Port ${info.port}`);
  });
}
