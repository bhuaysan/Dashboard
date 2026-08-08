import type { Config } from "../src/config/schema.ts";
import type { HomelabData } from "./pve.ts";

export type HomelabFetcher = (config: Config) => Promise<HomelabData>;

type CacheEntry = {
  revision: string;
  fetchedAt: number;
  data: HomelabData;
};

type FailureEntry = {
  revision: string;
  retryAt: number;
};

type Flight = {
  revision: string;
  promise: Promise<HomelabData>;
};

export type HomelabCacheOptions = {
  ttlMs?: number;
  errorBackoffMs?: number;
  now?: () => number;
};

/**
 * Teilt Homelab-Abfragen pro Config-Revision und verhindert nach einem Fehler einen
 * kurzen Request-Sturm. Die Revision gehört zur Config und nicht zur Uhrzeit allein:
 * neue Schwellwerte müssen sofort eine neue Auswertung auslösen.
 */
export function createHomelabCache(
  fetcher: HomelabFetcher,
  options: HomelabCacheOptions = {},
) {
  const ttlMs = options.ttlMs ?? 60_000;
  const errorBackoffMs = options.errorBackoffMs ?? 5_000;
  const now = options.now ?? Date.now;
  let cache: CacheEntry | undefined;
  let failure: FailureEntry | undefined;
  let flight: Flight | undefined;

  async function get(config: Config): Promise<HomelabData> {
    const revision = config.updatedAt;
    const timestamp = now();

    if (cache?.revision === revision && timestamp - cache.fetchedAt < ttlMs) {
      return cache.data;
    }
    if (failure?.revision === revision && timestamp < failure.retryAt) {
      throw new Error("Homelab nicht erreichbar");
    }
    if (flight?.revision === revision) {
      return flight.promise;
    }

    // Promise.resolve macht auch einen synchron geworfenen Fehler des Fetchers zu einer
    // normalen, gemeinsam nutzbaren Ablehnung.
    const request = Promise.resolve().then(() => fetcher(config));
    const promise = request.then(
      (data) => {
        // Wenn inzwischen eine neuere Revision angefragt wurde, darf ein später
        // eintreffender alter Stand den neueren Cache nicht überschreiben.
        if (flight?.promise === promise) {
          cache = { revision, fetchedAt: now(), data };
          failure = undefined;
        }
        return data;
      },
      (error: unknown) => {
        if (flight?.promise === promise) {
          failure = { revision, retryAt: now() + errorBackoffMs };
        }
        throw error;
      },
    );
    flight = { revision, promise };

    // Die abgeleitete Promise behandelt die Ablehnung ausdrücklich, damit der
    // Aufräumpfad selbst kein unhandled-rejection erzeugt.
    void promise.then(
      () => {
        if (flight?.promise === promise) flight = undefined;
      },
      () => {
        if (flight?.promise === promise) flight = undefined;
      },
    );
    return promise;
  }

  function clear(): void {
    cache = undefined;
    failure = undefined;
    flight = undefined;
  }

  return { get, clear };
}
