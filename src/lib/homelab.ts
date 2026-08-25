import { z } from "zod";

export const MAX_HOMELAB_TEXT_LENGTH = 256;

export const levelSchema = z.enum(["ok", "warn", "crit"]);
const percentage = z.number().finite().min(0).max(100);
const nonNegative = z.number().finite().min(0);
const text = z.string().min(1).max(MAX_HOMELAB_TEXT_LENGTH);

/** Gemeinsamer Laufzeitvertrag für Serverantwort, HTTP-Grenze und Browser-Cache. */
export const homelabDataSchema = z.object({
  configured: z.boolean(),
  node: z.object({
    cpu: percentage, mem: percentage, root: percentage,
    uptimeDays: nonNegative, cpuSpark: z.array(percentage).max(1000),
    memSpark: z.array(percentage).max(1000), cpuLevel: levelSchema,
    memLevel: levelSchema, rootLevel: levelSchema,
  }),
  guests: z.array(z.object({
    vmid: z.number().int().positive().max(999999), name: text, running: z.boolean(),
    cpu: percentage, mem: percentage, cpuLevel: levelSchema,
    memLevel: levelSchema,
  })).max(10000),
  storage: z.array(z.object({
    name: text, pct: percentage, level: levelSchema,
  })).max(1000),
  alerts: z.array(z.object({ level: z.enum(["warn", "crit"]), text })).max(20000),
});

export type Level = z.infer<typeof levelSchema>;
export type HomelabData = z.infer<typeof homelabDataSchema>;
