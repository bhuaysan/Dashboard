import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { env } from "./env.ts";

function ipToInt(ip: string): number | undefined {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return undefined;
  return parts.reduce((acc, p) => (acc << 8) + p, 0) >>> 0;
}

export function ipAllowed(addr: string, allow: string[]): boolean {
  return allow.some((entry) => {
    if (!entry.includes("/")) return entry === addr;
    const [base, bitsRaw] = entry.split("/");
    const bits = Number(bitsRaw);
    if (!base || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const a = ipToInt(addr);
    const b = ipToInt(base);
    if (a === undefined || b === undefined) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (a & mask) === (b & mask);
  });
}

export const writeGuard: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "PUT" && c.req.method !== "DELETE") return next();
  let addr = "127.0.0.1";
  try {
    addr = getConnInfo(c).remote.address ?? "127.0.0.1";
  } catch { /* keine Verbindungsinfo (Test): lokal behandeln */ }
  if (addr.startsWith("::ffff:")) addr = addr.slice(7);
  if (addr === "::1") addr = "127.0.0.1";
  if (!ipAllowed(addr, env.writeAllow)) {
    return c.json({ error: "Schreiben von dieser Adresse nicht erlaubt" }, 403);
  }
  return next();
};
