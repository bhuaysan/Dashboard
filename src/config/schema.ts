import { z } from "zod";

// Die Panes in Lesereihenfolge. Diese Liste bestimmt das Layout-Schema und die
// Zifferntasten (src/lib/useKeymap.ts). Fehlt eine Pane in einer älteren config.json,
// ergänzt der Server sie beim Lesen aus defaultConfig (server/config-store.ts).
export const PANE_IDS = ["clock", "weather", "month", "links", "news", "agenda", "homelab"] as const;
export type PaneId = (typeof PANE_IDS)[number];
export const HOLIDAY_REGIONS = ["BW", "NRW"] as const;
export type HolidayRegion = (typeof HOLIDAY_REGIONS)[number];

const MAX_URL_LENGTH = 2048;
const MAX_TEXT_LENGTH = 256;

function text(max: number): z.ZodType<string> {
  return z.string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, "Darf nicht leer sein")
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Enthält ein Steuerzeichen");
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function isSearchTemplate(value: string): boolean {
  const matches = value.match(/%s/g);
  return matches?.length === 1 && isHttpUrl(value.replace("%s", "dashboard"));
}

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/** Lokale Kalender dürfen ausschließlich aus dem erhaltenen Static-Root kommen. */
export function isSafeLocalCalendarPath(value: string): boolean {
  if (!value.startsWith("/static/") || value.startsWith("//") || value.includes("\\") || value.includes("\u0000")) {
    return false;
  }
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (decoded !== value || decoded.includes("//")) return false;
  const parts = decoded.split("/");
  const filename = parts.at(-1);
  return parts[0] === "" && parts[1] === "static" &&
    parts.slice(2).every((part) => part !== "" && part !== "." && part !== "..") &&
    filename?.toLowerCase().endsWith(".ics") === true;
}

function isCalendarUrl(value: string): boolean {
  return isSafeLocalCalendarPath(value) || isHttpUrl(value);
}

const dnsLabel = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** Liefert die eine Schreibweise, die auch URL.hostname verwendet: lowercase ohne Punktsegmente. */
export function canonicalHostname(value: string): string | undefined {
  if (value !== value.trim() || value.length === 0 || value.length > 253 || value.includes("\\") ||
      value.includes("/") || value.includes(":")) return undefined;
  const labels = value.split(".");
  if (labels.some((label) => label.length === 0 || label.length > 63 || !dnsLabel.test(label))) return undefined;
  return value.toLowerCase();
}

function isHostname(value: string): boolean {
  return canonicalHostname(value) !== undefined;
}

function isPveNodeName(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(value);
}

const isoDateTime = z.string().datetime({ offset: true });
const httpUrl = text(MAX_URL_LENGTH).refine(isHttpUrl, "Keine gültige Adresse (muss mit http:// oder https:// beginnen)");
const searchTemplate = text(MAX_URL_LENGTH).refine(isSearchTemplate, "Muss genau ein %s und eine HTTP(S)-Adresse enthalten");
const hostname = text(253)
  .transform((value) => value.toLowerCase())
  .refine(isHostname, "Ungültiger Hostname");
const pveNodeName = text(63).refine(isPveNodeName, "Ungültiger Proxmox-Node-Name");
const timezone = text(100).refine(isTimezone, "Ungültige Zeitzone");
const percent = z.number().finite().min(0).max(100);
const port = z.number().int().min(1).max(65535);
const paneId = z.enum(PANE_IDS);

const linkSchema = z.object({
  label: text(MAX_TEXT_LENGTH),
  url: httpUrl,
  hint: z.string().regex(/^g[A-Za-z0-9]$/).optional(),
});

const layoutSchema = z.array(z.object({
  id: paneId,
  visible: z.boolean(),
  span: z.union([z.literal(1), z.literal(2)]),
})).max(PANE_IDS.length).superRefine((layout, ctx) => {
  const seen = new Set<PaneId>();
  layout.forEach((entry, index) => {
    if (seen.has(entry.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: "Pane darf nur einmal vorkommen" });
    }
    seen.add(entry.id);
  });
});

const baseConfigSchema = z.object({
  version: z.literal(1),
  updatedAt: isoDateTime,                  // ISO-8601, wird vom Server gesetzt
  theme: z.enum(["dark", "light", "system"]).default("system"),
  clock: z.object({
    secondary: z.array(z.object({ label: text(MAX_TEXT_LENGTH), tz: timezone })).max(8).default([]),
  }),
  location: z.object({
    label: text(MAX_TEXT_LENGTH),
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180),
  }),
  // Bestehende Configs ohne Feld werden deterministisch für diese Installation
  // auf Baden-Württemberg ergänzt.
  holidayRegion: z.enum(HOLIDAY_REGIONS).default("BW"),
  linkGroups: z.array(z.object({
    title: text(MAX_TEXT_LENGTH),
    links: z.array(linkSchema).max(100),
  })).max(32),
  feeds: z.array(z.object({
    label: text(MAX_TEXT_LENGTH),
    url: httpUrl,
    limit: z.number().int().min(1).max(50).default(5),
  })).max(32),
  calendars: z.array(z.object({
    label: text(MAX_TEXT_LENGTH),
    url: text(MAX_URL_LENGTH).refine(isCalendarUrl, "Nur ein sicherer /static/*.ics-Pfad oder HTTP(S) ist erlaubt"),
  })).max(32),
  search: z.object({
    default: searchTemplate,
    bangs: z.record(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/), searchTemplate).refine(
      (bangs) => Object.keys(bangs).length <= 64,
      "Zu viele Suchkürzel",
    ),
  }),
  layout: layoutSchema,
  proxyAllowlist: z.array(hostname).max(128),
  homelab: z.object({
    node: pveNodeName.default("pve"),
    uiUrl: httpUrl.default("https://10.0.10.10:8006"),   // Ziel der Konsolen-Links
    expectRunning: z.array(z.number().int().positive().max(999999)).max(128).default([]),
    thresholds: z.object({
      cpu: percent.default(90),
      mem: percent.default(85),
      storage: percent.default(80),
      backupAgeHours: z.number().finite().positive().max(8760).default(36),
    }),
    reachability: z.array(z.object({
      label: text(MAX_TEXT_LENGTH),
      host: hostname,
      port,
    })).max(64).default([]),
  }),
});

export const configSchema = baseConfigSchema.superRefine((config, ctx) => {
  const vmids = new Set<number>();
  config.homelab.expectRunning.forEach((vmid, index) => {
    if (vmids.has(vmid)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["homelab", "expectRunning", index], message: "VMID darf nur einmal vorkommen" });
    }
    vmids.add(vmid);
  });

  const hints = new Set<string>();
  config.linkGroups.forEach((group, groupIndex) => {
    group.links.forEach((link, linkIndex) => {
      if (link.hint && hints.has(link.hint)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["linkGroups", groupIndex, "links", linkIndex, "hint"],
          message: "Kürzel darf nur einmal vorkommen",
        });
      }
      if (link.hint) hints.add(link.hint);
    });
  });
});

export type Config = z.infer<typeof configSchema>;
