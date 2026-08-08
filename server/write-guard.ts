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

function hostnameFromHeader(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "" || /[\u0000-\u0020]/.test(trimmed)) return undefined;
  try {
    const parsed = new URL(`http://${trimmed}`);
    if (parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
      return undefined;
    }
    return parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
}

export function hostAllowed(host: string, allow: string[]): boolean {
  const actual = hostnameFromHeader(host);
  if (actual === undefined) return false;
  return allow.some((entry) => hostnameFromHeader(entry) === actual);
}

export function originAllowed(origin: string, requestHost: string | undefined, allow: string[]): boolean {
  if (origin === "null") return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") return false;
  if (parsed.username !== "" || parsed.password !== "" || !hostAllowed(parsed.host, allow)) return false;
  return requestHost === undefined || hostnameFromHeader(requestHost) === hostnameFromHeader(parsed.host);
}

export const writeGuard: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "PUT" && c.req.method !== "DELETE") return next();
  const requestHost = c.req.header("host");
  if (requestHost !== undefined && !hostAllowed(requestHost, env.writeHosts)) {
    return c.json({ error: "Host für Schreibzugriff nicht erlaubt" }, 403);
  }
  const origin = c.req.header("origin");
  if (origin !== undefined && !originAllowed(origin, requestHost, env.writeHosts)) {
    return c.json({ error: "Origin für Schreibzugriff nicht erlaubt" }, 403);
  }
  let addr: string | undefined;
  try {
    addr = getConnInfo(c).remote.address;
  } catch { /* keine Verbindungsinfo: unten abgelehnt */ }
  if (addr === undefined) {
    // Ohne bekannte Absenderadresse lässt sich die Freigabe nicht prüfen — dann nicht schreiben.
    return c.json({ error: "Absenderadresse unbekannt — Schreiben abgelehnt" }, 403);
  }
  if (addr.startsWith("::ffff:")) addr = addr.slice(7);
  if (addr === "::1") addr = "127.0.0.1";
  if (!ipAllowed(addr, env.writeAllow)) {
    return c.json({ error: "Schreiben von dieser Adresse nicht erlaubt" }, 403);
  }
  return next();
};
