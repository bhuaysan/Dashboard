import type { ProfileId, UptimeTarget } from "../config/schema";
import {
  uptimeResponseSchema,
  type UptimeError,
  type UptimeHistoryState,
  type UptimeResponse,
  type UptimeStatus,
  type UptimeTargetResult,
} from "../lib/uptime";
import { profileApiUrl } from "../api/profileUrl";
import { shortAge } from "../lib/relativeTime";
import { safeHref } from "../lib/url";

const percentage = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const STATUS: Record<UptimeStatus, { glyph: string; label: string; className: string }> = {
  up: { glyph: "●", label: "erreichbar", className: "ok" },
  degraded: { glyph: "!", label: "gestört", className: "warn" },
  down: { glyph: "○", label: "nicht erreichbar", className: "crit" },
  unknown: { glyph: "?", label: "unbekannt", className: "dim" },
};

const HISTORY_GLYPH: Record<UptimeHistoryState, string> = {
  ok: "━",
  mixed: "!",
  down: "○",
  unknown: "·",
};

export function decodeUptime(value: unknown): UptimeResponse | undefined {
  const parsed = uptimeResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export async function fetchUptime(profileId: ProfileId, signal?: AbortSignal): Promise<UptimeResponse> {
  const url = profileApiUrl("/api/uptime", profileId);
  const response = signal === undefined ? await fetch(url) : await fetch(url, { signal });
  if (!response.ok) throw new Error(`Uptime nicht ladbar (${response.status})`);
  const decoded = decodeUptime(await response.json());
  if (decoded === undefined) throw new Error("Uptimeantwort ungültig");
  return decoded;
}

function describeError(error: UptimeError | null): string | undefined {
  if (error === null) return undefined;
  if (error.code === "timeout") return "Zeitüberschreitung";
  if (error.code === "dns") return "DNS-Fehler";
  if (error.code === "refused") return "Verbindung abgelehnt";
  if (error.code === "tls") return "TLS-Fehler";
  if (error.code === "redirect") return "Weiterleitungsfehler";
  if (error.code === "http") return error.httpStatus === undefined ? "HTTP-Fehler" : `HTTP ${error.httpStatus}`;
  return "Netzwerkfehler";
}

function historyLabel(history: UptimeHistoryState[]): string {
  const count = (state: UptimeHistoryState) => history.filter((entry) => entry === state).length;
  return `24-Stunden-Verlauf: ${count("ok")} erreichbar, ${count("mixed")} gemischt, ` +
    `${count("down")} ausgefallen, ${count("unknown")} unbekannt`;
}

function emptyResult(id: string): UptimeTargetResult {
  return {
    id,
    status: "unknown",
    statusSince: null,
    checkedAt: null,
    responseTimeMs: null,
    uptime24h: null,
    measuredMinutes: 0,
    history: Array.from({ length: 24 }, () => "unknown"),
    error: null,
  };
}

function UptimeRow({
  target,
  result,
  selected,
  now,
}: {
  target: UptimeTarget;
  result: UptimeTargetResult | undefined;
  selected: boolean;
  now: Date;
}): React.JSX.Element {
  const measured = result ?? emptyResult(target.id);
  const state = STATUS[measured.status];
  const endpoint = target.type === "http" ? target.url : `${target.host}:${target.port}`;
  const error = result === undefined ? "noch keine Messdaten" : describeError(measured.error);
  const href = target.type === "http" ? safeHref(target.url) : undefined;
  const className = `uptime-row uptime-row--responsive${selected ? " is-sel" : ""}`;
  const content = (
    <>
      <span className={`uptime-mark ${state.className}`} aria-hidden="true">{state.glyph}</span>
      <span className="uptime-status">
        <span>{state.label}</span>
        {measured.statusSince !== null && (
          <span className="dim">seit {shortAge(new Date(measured.statusSince), now)}</span>
        )}
        {error !== undefined && <span className={measured.status === "down" ? "crit" : "dim"}>{error}</span>}
      </span>
      <span className="uptime-target">
        <span className="uptime-name">{target.label}</span>
        <span className="uptime-endpoint dim">{endpoint}</span>
      </span>
      <span className="uptime-latency">{measured.responseTimeMs === null ? "—" : `${measured.responseTimeMs} ms`}</span>
      <span className="uptime-percent">{measured.uptime24h === null ? "—" : `${percentage.format(measured.uptime24h)} %`}</span>
      <span className="uptime-history" aria-label={historyLabel(measured.history)}>
        {measured.history.map((historyState, index) => (
          <span key={index} className={`uptime-history-${historyState}`} aria-hidden="true">
            {HISTORY_GLYPH[historyState]}
          </span>
        ))}
      </span>
    </>
  );

  return href === undefined
    ? <div className={className} data-row>{content}</div>
    : <a className={className} href={href} data-row>{content}</a>;
}

export function Uptime({
  targets,
  data,
  selIndex,
  now,
}: {
  targets: UptimeTarget[];
  data?: UptimeResponse;
  selIndex: number;
  now: Date;
}): React.JSX.Element {
  if (targets.length === 0) return <div className="dim">keine Uptime-Ziele eingetragen</div>;
  if (data === undefined) return <div className="dim">noch keine Uptime-Daten</div>;
  const results = new Map(data.targets.map((result) => [result.id, result]));
  return (
    <div className="uptime">
      {!data.storageOk && <div className="crit source-warning">Uptime-Historie nicht speicherbar</div>}
      {targets.map((target, index) => (
        <UptimeRow
          key={target.id}
          target={target}
          result={results.get(target.id)}
          selected={index === selIndex}
          now={now}
        />
      ))}
    </div>
  );
}
