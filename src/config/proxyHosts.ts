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

/** Ergänzt fehlende Quellhosts und lässt die von Hand gepflegten Einträge unangetastet. */
export function withRequiredProxyHosts(cfg: Config): Config {
  const vorhanden = new Set(
    cfg.proxyAllowlist.map((entry) => canonicalHostname(entry)).filter((h) => h !== undefined),
  );
  const fehlend = requiredProxyHosts(cfg).filter((host) => !vorhanden.has(host));
  if (fehlend.length === 0) return cfg;
  return { ...cfg, proxyAllowlist: [...cfg.proxyAllowlist, ...fehlend] };
}
