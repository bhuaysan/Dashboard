import { z } from "zod";

export const uptimeStatusSchema = z.enum(["unknown", "up", "degraded", "down"]);
export const uptimeHistoryStateSchema = z.enum(["ok", "mixed", "down", "unknown"]);
export const uptimeErrorSchema = z.object({
  code: z.enum(["timeout", "dns", "refused", "tls", "redirect", "http", "network"]),
  httpStatus: z.number().int().min(100).max(599).optional(),
}).strict();

export const uptimeTargetResultSchema = z.object({
  id: z.string().uuid(),
  status: uptimeStatusSchema,
  statusSince: z.string().datetime({ offset: true }).nullable(),
  checkedAt: z.string().datetime({ offset: true }).nullable(),
  responseTimeMs: z.number().int().nonnegative().nullable(),
  uptime24h: z.number().finite().min(0).max(100).nullable(),
  measuredMinutes: z.number().int().min(0).max(1440),
  history: z.array(uptimeHistoryStateSchema).length(24),
  error: uptimeErrorSchema.nullable(),
}).strict().superRefine((result, ctx) => {
  if (result.status === "up" && (result.responseTimeMs === null || result.error !== null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Erreichbares Ziel braucht Antwortzeit ohne Fehler",
    });
  }
  if ((result.status === "degraded" || result.status === "down") &&
      (result.responseTimeMs !== null || result.error === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Fehlgeschlagenes Ziel braucht Fehler ohne Antwortzeit",
    });
  }
});

export const uptimeResponseSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }).nullable(),
  storageOk: z.boolean(),
  targets: z.array(uptimeTargetResultSchema).max(32),
}).strict();

export type UptimeStatus = z.infer<typeof uptimeStatusSchema>;
export type UptimeHistoryState = z.infer<typeof uptimeHistoryStateSchema>;
export type UptimeError = z.infer<typeof uptimeErrorSchema>;
export type UptimeTargetResult = z.infer<typeof uptimeTargetResultSchema>;
export type UptimeResponse = z.infer<typeof uptimeResponseSchema>;
