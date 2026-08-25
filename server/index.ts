// Diese Datei ist ausschließlich der ausführbare Einstiegspunkt. Die App-Fabrik liegt in
// app.ts, damit Tests eine synthetische Umgebung verwenden können, ohne load-env.ts auszuführen.
import "./load-env.ts";

import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { env } from "./env.ts";
import { createApp } from "./app.ts";

const distRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "dist");
const app = createApp({ env, distRoot });

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
  serve({ fetch: app.fetch, port: env.port }, (info) => {
    console.log(`dashboard-server auf Port ${info.port}`);
  });
}
