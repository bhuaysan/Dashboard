import { canonicalHostname, type Config } from "./schema";

/**
 * Die Hosts, die der Proxy für die eingetragenen Quellen erreichen können muss.
 *
 * Einen Feed oder Kalender einzutragen ist die Erlaubnis für seinen Host — die Allowlist
 * ein zweites Mal von Hand zu pflegen ist Doppelarbeit, und wer sie vergisst, bekommt eine
 * Quelle, die still fehlschlägt. Genau so ist der Zeit-Feed monatelang nicht geladen worden.
 *
 * Das ist kein Loch im Proxy: private Adressen bleiben unabhängig von der Allowlist
 * gesperrt, und wer Feeds ändern darf, darf ohnehin auch die Allowlist ändern.
 */
export function requiredProxyHosts(cfg: Config): string[] {
  const hosts: string[] = [];
  const seen = new Set<string>();
  const add = (url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;                                   // Kalender dürfen ein lokaler Pfad sein
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    // hostname, nicht host: der Proxy vergleicht ohne Port (server/proxy.ts).
    const name = canonicalHostname(parsed.hostname);
    if (name === undefined || seen.has(name)) return;
    seen.add(name);
    hosts.push(name);
  };
  for (const feed of cfg.feeds) add(feed.url);
  for (const calendar of cfg.calendars) add(calendar.url);
  return hosts;
}

/**
 * Effektive Policy des Proxys. Abgeleitete Quellhosts werden bewusst nicht in config.json
 * persistiert: Dort gilt die Obergrenze für die vom Menschen gepflegte Allowlist, während
 * maximal 64 weitere Hosts aus Feeds und Kalendern folgen können.
 */
export function effectiveProxyHosts(cfg: Config): string[] {
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const entry of [...cfg.proxyAllowlist, ...requiredProxyHosts(cfg)]) {
    const host = canonicalHostname(entry);
    if (host === undefined || seen.has(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}
