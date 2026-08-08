import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { env, type DashboardEnvironment } from "./env.ts";

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

type HostEndpoint = { hostname: string; port: number; hasPort: boolean };

function defaultPort(protocol: string): number | undefined {
  if (protocol === "http:") return 80;
  if (protocol === "https:") return 443;
  return undefined;
}

function hasExplicitPort(value: string): boolean {
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    return close !== -1 && /^:\d+$/.test(value.slice(close + 1));
  }
  return /:\d+$/.test(value);
}

function parseHost(value: string, protocol = "http:"): HostEndpoint | undefined {
  const trimmed = value.trim();
  if (trimmed === "" || /[\u0000-\u0020]/.test(trimmed)) return undefined;
  try {
    const parsed = new URL(`${protocol}//${trimmed}`);
    if (parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
      return undefined;
    }
    const port = parsed.port === "" ? defaultPort(protocol) : Number(parsed.port);
    if (port === undefined || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
    return {
      hostname: parsed.hostname.toLowerCase().replace(/\.$/, ""),
      port,
      hasPort: hasExplicitPort(trimmed),
    };
  } catch {
    return undefined;
  }
}

export function hostAllowed(host: string, allow: string[]): boolean {
  const actual = parseHost(host);
  if (actual === undefined) return false;
  return allow.some((entry) => {
    const allowed = parseHost(entry);
    return allowed !== undefined && allowed.hostname === actual.hostname &&
      (!allowed.hasPort || allowed.port === actual.port);
  });
}

const VITE_DEV_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);

export function originAllowed(
  origin: string,
  requestHost: string | undefined,
  allow: string[],
  requestProtocol = "http:",
  devApiPort = 7777,
): boolean {
  if (origin === "null") return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (requestHost === undefined || !hostAllowed(requestHost, allow)) return false;

  const request = parseHost(requestHost, requestProtocol);
  const originEndpoint = parseHost(parsed.host, parsed.protocol);
  if (request === undefined || originEndpoint === undefined) return false;
  if (parsed.protocol === requestProtocol && request.hostname === originEndpoint.hostname &&
      request.port === originEndpoint.port) return true;

  // Vite serves the UI from 5173 while the API stays on the configured dev port.
  // This is deliberately an exact allowlist, not a general cross-port exception.
  return requestProtocol === "http:" && request.port === devApiPort &&
    VITE_DEV_ORIGINS.has(parsed.origin) && request.hostname === originEndpoint.hostname;
}

export function createWriteGuard(runtimeEnv: Pick<DashboardEnvironment, "port" | "writeAllow" | "writeHosts">): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== "PUT" && c.req.method !== "DELETE") return next();
    const requestHost = c.req.header("host");
    if (requestHost === undefined || !hostAllowed(requestHost, runtimeEnv.writeHosts)) {
      return c.json({ error: "Host für Schreibzugriff nicht erlaubt" }, 403);
    }
    const origin = c.req.header("origin");
    let requestProtocol = "http:";
    try { requestProtocol = new URL(c.req.url).protocol; } catch { /* Hono liefert normalerweise eine gültige URL */ }
    if (origin !== undefined && !originAllowed(origin, requestHost, runtimeEnv.writeHosts, requestProtocol, runtimeEnv.port)) {
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
    if (!ipAllowed(addr, runtimeEnv.writeAllow)) {
      return c.json({ error: "Schreiben von dieser Adresse nicht erlaubt" }, 403);
    }
    return next();
  };
}

export const writeGuard = createWriteGuard(env);
