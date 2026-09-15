import type { Config } from "../config/schema";
import { parseFeed, type NewsItem } from "../lib/rss";
import { shortAge, spokenAge } from "../lib/relativeTime";
import { safeHref } from "../lib/url";
import { z } from "zod";
import type { ProfileId } from "../config/schema";
import { profileApiUrl } from "../api/profileUrl";

export type { NewsItem };
export type NewsFetchResult = { items: NewsItem[]; failures: string[] };

const cachedNewsItemSchema = z.object({
  title: z.string(),
  url: z.string(),
  date: z.string().refine((value) => !Number.isNaN(new Date(value).getTime())).transform((value) => new Date(value)),
  source: z.string(),
});
const newsFetchResultSchema = z.object({
  items: z.array(cachedNewsItemSchema),
  failures: z.array(z.string()),
});

export function decodeNews(value: unknown): NewsFetchResult | undefined {
  const parsed = newsFetchResultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

type FeedSourceResult = { items: NewsItem[]; failure?: string };

export async function fetchNews(profileId: ProfileId, feeds: Config["feeds"]): Promise<NewsFetchResult> {
  const results = await Promise.all(feeds.map(async (feed): Promise<FeedSourceResult> => {
    try {
      const res = await fetch(profileApiUrl("/api/proxy", profileId, new URLSearchParams({ url: feed.url })));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseFeed(await res.text(), feed.label, feed.url)
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, feed.limit);
      return { items };
    } catch {
      return { items: [], failure: feed.label };   // ein kaputter Feed blockiert die anderen nicht
    }
  }));
  const failures = results.flatMap((result) => result.failure === undefined ? [] : [result.failure]);
  // Fällt jede Quelle aus, ist das ein Fehler und keine leere Liste — sonst meldet die
  // Statusline „in Ordnung", während nichts geladen wurde.
  if (feeds.length > 0 && failures.length === feeds.length) throw new Error("Kein Feed erreichbar");
  return {
    items: results.flatMap((result) => result.items)
      .sort((a, b) => b.date.getTime() - a.date.getTime()),
    failures,
  };
}

export function News({ items, failures = [], selIndex, feedCount }: {
  items?: NewsItem[];
  failures?: string[];
  selIndex: number;
  feedCount: number;
}) {
  const warning = failures.length > 0
    ? <div className="dim source-warning">Feeds nicht erreichbar: {failures.join(", ")}</div>
    : null;
  if (!items) return <div className="dim">noch keine Meldungen</div>;
  if (items.length === 0) {
    return <>{warning}<div className="dim">{feedCount === 0 ? "keine Feeds eingetragen" : "keine Meldungen geladen"}</div></>;
  }
  const now = new Date();
  return (
    <div className="news">
      {warning}
      {items.map((n, i) => {
        const href = safeHref(n.url);
        const cls = `news-row${i === selIndex ? " is-sel" : ""}`;
        const inner = (
          <>
            {/* Alter statt Uhrzeit: die Umschaltung lief über den Kalendertag, weshalb
                kurz nach Mitternacht jede Meldung des Vorabends „1 d" hieß — sieben
                gleiche Zellen, die nichts mehr aussagten. Vorgelesen wird ausgeschrieben,
                „12m" ist zum Hören zu knapp. */}
            <span className="dim" aria-hidden="true">{shortAge(n.date, now)}</span>
            <span className="sr-only">{spokenAge(n.date, now)}</span>
            <span className="src">{n.source}</span>
            <span className="headline">{n.title}</span>
          </>
        );
        // Eine Meldung ohne brauchbare Adresse bleibt Text — ein toter Link wäre schlimmer.
        return href === undefined
          ? <div key={`${n.url}-${i}`} className={cls} data-row>{inner}</div>
          : <a key={`${n.url}-${i}`} className={cls} href={href} data-row>{inner}</a>;
      })}
    </div>
  );
}
