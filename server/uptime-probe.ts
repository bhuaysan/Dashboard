import net from "node:net";
import { performance } from "node:perf_hooks";
import { fetch as undiciFetch } from "undici";
import type { UptimeTarget } from "../src/config/schema";
import type { UptimeError } from "../src/lib/uptime";

const DEFAULT_TIMEOUT_MS = 5_000;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export type UptimeProbeResult =
  | { ok: true; responseTimeMs: number }
  | { ok: false; error: UptimeError };

export type UptimeProbe = (target: UptimeTarget) => Promise<UptimeProbeResult>;

type FetchInit = {
  method: "GET";
  redirect: "manual";
  signal: AbortSignal;
};

type FetchImpl = (url: string | URL, init: FetchInit) => Promise<Response>;

export type HttpProbeDependencies = {
  fetchImpl?: FetchImpl;
  now?: () => number;
  timeoutMs?: number;
};

type SocketLike = {
  once: (event: string, listener: (...args: unknown[]) => void) => unknown;
  setTimeout: (timeoutMs: number) => unknown;
  destroy: () => unknown;
};

export type TcpProbeDependencies = {
  connect?: (options: { host: string; port: number }) => SocketLike;
  now?: () => number;
  timeoutMs?: number;
};

function isSafeMonitorUrl(url: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" && url.password === "";
}

function nestedErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return nestedErrorCode(error.cause);
  return undefined;
}

function classifyNetworkError(error: unknown): UptimeError {
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return { code: "timeout" };
  }

  const code = nestedErrorCode(error);
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT") {
    return { code: "timeout" };
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { code: "dns" };
  if (code === "ECONNREFUSED") return { code: "refused" };
  if (code !== undefined && (
    code.includes("CERT") || code.includes("TLS") || code.includes("SSL") ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "SELF_SIGNED_CERT_IN_CHAIN"
  )) return { code: "tls" };
  return { code: "network" };
}

function elapsed(startedAt: number, now: () => number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

export async function probeHttp(
  target: Extract<UptimeTarget, { type: "http" }>,
  dependencies: HttpProbeDependencies = {},
): Promise<UptimeProbeResult> {
  const fetchImpl: FetchImpl = dependencies.fetchImpl ?? ((url, init) => undiciFetch(url, init));
  const now = dependencies.now ?? (() => performance.now());
  const signal = AbortSignal.timeout(dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const startedAt = now();
  let current = new URL(target.url);

  try {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const response = await fetchImpl(current, { method: "GET", redirect: "manual", signal });
      await response.body?.cancel().catch(() => undefined);

      if (redirectStatuses.has(response.status)) {
        if (redirects === 5) return { ok: false, error: { code: "redirect" } };
        const location = response.headers.get("location");
        if (location === null) return { ok: false, error: { code: "redirect" } };

        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return { ok: false, error: { code: "redirect" } };
        }
        if (!isSafeMonitorUrl(next)) return { ok: false, error: { code: "redirect" } };
        current = next;
        continue;
      }

      if (response.status >= 200 && response.status <= 399) {
        return { ok: true, responseTimeMs: elapsed(startedAt, now) };
      }
      return { ok: false, error: { code: "http", httpStatus: response.status } };
    }
  } catch (error) {
    return { ok: false, error: classifyNetworkError(error) };
  }

  return { ok: false, error: { code: "redirect" } };
}

export function probeTcp(
  target: Extract<UptimeTarget, { type: "tcp" }>,
  dependencies: TcpProbeDependencies = {},
): Promise<UptimeProbeResult> {
  const connect = dependencies.connect ?? ((options) => net.createConnection(options));
  const now = dependencies.now ?? (() => performance.now());
  const startedAt = now();
  const socket = connect({ host: target.host, port: target.port });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: UptimeProbeResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.once("connect", () => finish({ ok: true, responseTimeMs: elapsed(startedAt, now) }));
    socket.once("timeout", () => finish({ ok: false, error: { code: "timeout" } }));
    socket.once("error", (error) => finish({ ok: false, error: classifyNetworkError(error) }));
    socket.setTimeout(dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });
}

export function probeTarget(target: UptimeTarget): Promise<UptimeProbeResult> {
  return target.type === "http" ? probeHttp(target) : probeTcp(target);
}
