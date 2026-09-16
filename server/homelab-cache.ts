import type { Config, ProfileId } from "../src/config/schema.ts";
import type { HomelabData } from "../src/lib/homelab.ts";

export type HomelabFetcher = (config: Config) => Promise<HomelabData>;

type CacheEntry = {
  key: string;
  fetchedAt: number;
  data: HomelabData;
};

type FailureEntry = {
  key: string;
  retryAt: number;
};

type Flight = {
  key: string;
  promise: Promise<HomelabData>;
};

export type HomelabCacheOptions = {
  ttlMs?: number;
  errorBackoffMs?: number;
  now?: () => number;
};

/**
 * Teilt Homelab-Abfragen pro Profil und Config-Revision und verhindert nach einem Fehler
 * einen kurzen Request-Sturm. Die Revision gehört zur Config und nicht zur Uhrzeit allein:
 * neue Schwellwerte müssen sofort eine neue Auswertung auslösen.
 */
export function createHomelabCache(
  fetcher: HomelabFetcher,
  options: HomelabCacheOptions = {},
) {
  const ttlMs = options.ttlMs ?? 60_000;
  const errorBackoffMs = options.errorBackoffMs ?? 5_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const failures = new Map<string, FailureEntry>();
  const flights = new Map<string, Flight>();

  async function get(profileId: ProfileId, config: Config): Promise<HomelabData> {
    const key = `${profileId}:${config.updatedAt}`;
    const timestamp = now();

    const cached = cache.get(key);
    if (cached !== undefined && timestamp - cached.fetchedAt < ttlMs) {
      return cached.data;
    }
    const failure = failures.get(key);
    if (failure !== undefined && timestamp < failure.retryAt) {
      throw new Error("Homelab nicht erreichbar");
    }
    const flight = flights.get(key);
    if (flight !== undefined) {
      return flight.promise;
    }

    // Promise.resolve macht auch einen synchron geworfenen Fehler des Fetchers zu einer
    // normalen, gemeinsam nutzbaren Ablehnung.
    const request = Promise.resolve().then(() => fetcher(config));
    const promise = request.then(
      (data) => {
        // Wenn inzwischen ein anderer Profilstand angefragt wurde, darf ein später
        // eintreffender alter Stand den neueren Cache nicht überschreiben.
        if (flights.get(key)?.promise === promise) {
          cache.set(key, { key, fetchedAt: now(), data });
          failures.delete(key);
        }
        return data;
      },
      (error: unknown) => {
        if (flights.get(key)?.promise === promise) {
          failures.set(key, { key, retryAt: now() + errorBackoffMs });
        }
        throw error;
      },
    );
    flights.set(key, { key, promise });

    // Die abgeleitete Promise behandelt die Ablehnung ausdrücklich, damit der
    // Aufräumpfad selbst kein unhandled-rejection erzeugt.
    void promise.then(
      () => {
        if (flights.get(key)?.promise === promise) flights.delete(key);
      },
      () => {
        if (flights.get(key)?.promise === promise) flights.delete(key);
      },
    );
    return promise;
  }

  return { get };
}
