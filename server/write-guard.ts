import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { env } from "./env.ts";

export const writeGuard: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "PUT" && c.req.method !== "DELETE") return next();
  let addr = "127.0.0.1";
  try {
    addr = getConnInfo(c).remote.address ?? "127.0.0.1";
  } catch { /* keine Verbindungsinfo (Test): lokal behandeln */ }
  if (addr.startsWith("::ffff:")) addr = addr.slice(7);
  if (addr === "::1") addr = "127.0.0.1";
  if (!env.writeAllow.includes(addr)) {
    return c.json({ error: "Schreiben von dieser Adresse nicht erlaubt" }, 403);
  }
  return next();
};
