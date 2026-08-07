import { z } from "zod";

// Die Panes in Lesereihenfolge. Diese Liste bestimmt das Layout-Schema und die
// Zifferntasten (src/lib/useKeymap.ts). Fehlt eine Pane in einer älteren config.json,
// ergänzt der Server sie beim Lesen aus defaultConfig (server/config-store.ts).
export const PANE_IDS = ["clock", "weather", "month", "links", "news", "agenda", "homelab"] as const;
export type PaneId = (typeof PANE_IDS)[number];

export const configSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),                       // ISO-8601, wird vom Server gesetzt
  theme: z.enum(["dark", "light", "system"]).default("system"),
  clock: z.object({
    secondary: z.array(z.object({ label: z.string(), tz: z.string() })).default([]),
  }),
  location: z.object({ label: z.string(), lat: z.number(), lon: z.number() }),
  linkGroups: z.array(z.object({
    title: z.string(),
    links: z.array(z.object({
      label: z.string(),
      url: z.string().url(),
      hint: z.string().max(2).optional(),
    })),
  })),
  feeds: z.array(z.object({
    label: z.string(), url: z.string().url(), limit: z.number().int().min(1).default(5),
  })),
  calendars: z.array(z.object({ label: z.string(), url: z.string() })),
  search: z.object({
    default: z.string(),                       // "https://duckduckgo.com/?q=%s"
    bangs: z.record(z.string()),               // { "g": "https://www.google.com/search?q=%s" }
  }),
  layout: z.array(z.object({
    id: z.enum(PANE_IDS),
    visible: z.boolean(),
    span: z.union([z.literal(1), z.literal(2)]),
  })),
  proxyAllowlist: z.array(z.string()),         // Hostnamen, z.B. "api.open-meteo.com"
  homelab: z.object({
    node: z.string().default("pve"),
    uiUrl: z.string().default("https://10.0.10.10:8006"),   // Ziel der Konsolen-Links

    expectRunning: z.array(z.number().int()).default([]),   // VMIDs, die laufen sollen
    thresholds: z.object({
      cpu: z.number().default(90), mem: z.number().default(85),
      storage: z.number().default(80), backupAgeHours: z.number().default(36),
    }),
    reachability: z.array(z.object({
      label: z.string(), host: z.string(), port: z.number().int(),
    })).default([]),
  }),
});

export type Config = z.infer<typeof configSchema>;
