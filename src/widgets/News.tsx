import type { Config } from "../config/schema";
import { parseFeed, type NewsItem } from "../lib/rss";
import { isSameDay } from "../lib/relativeTime";

export type { NewsItem };

export function reviveNews(items: NewsItem[]): NewsItem[] {
  return items.map((n) => ({ ...n, date: new Date(n.date) }));
}

export async function fetchNews(feeds: Config["feeds"]): Promise<NewsItem[]> {
  const all: NewsItem[] = [];
  await Promise.all(feeds.map(async (feed) => {
    try {
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(feed.url)}`);
      if (!res.ok) return;
      all.push(...parseFeed(await res.text(), feed.label).slice(0, feed.limit));
    } catch { /* ein kaputter Feed blockiert die anderen nicht */ }
  }));
  return all.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function News({ items, selIndex }: { items?: NewsItem[]; selIndex: number }) {
  if (!items) return <div className="dim">noch keine Meldungen</div>;
  if (items.length === 0) return <div className="dim">keine Feeds eingetragen</div>;
  const now = new Date();
  const fmtTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
  const stamp = (d: Date) => {
    if (isSameDay(d, now)) return fmtTime.format(d);
    const days = Math.max(1, Math.round((now.getTime() - d.getTime()) / 86400000));
    return `${days} d`;
  };
  return (
    <>
      {items.map((n, i) => (
        <div key={`${n.url}-${i}`} className={`news-row${i === selIndex ? " is-sel" : ""}`} data-row>
          <span className="dim">{stamp(n.date)}</span>
          <span className="src">{n.source}</span>
          <span className="headline">{n.title}</span>
        </div>
      ))}
    </>
  );
}
