export type NewsItem = { title: string; url: string; date: Date; source: string };

function text(parent: Element, tag: string): string {
  return parent.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
}

function safeUrl(raw: string, baseUrl?: string): string {
  if (raw === "") return "";
  try {
    const url = baseUrl === undefined ? new URL(raw) : new URL(raw, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function atomLink(entry: Element): string {
  const links = Array.from(entry.getElementsByTagName("link"));
  const isArticleLink = (link: Element) => {
    const type = link.getAttribute("type");
    return type === null || type === "" || type === "text/html" || type === "application/xhtml+xml";
  };
  const alternate = links.find((link) => link.getAttribute("rel") === "alternate" && isArticleLink(link));
  const withoutRelation = links.find((link) => {
    const rel = link.getAttribute("rel");
    return (rel === null || rel === "") && isArticleLink(link);
  });
  const link = alternate ?? withoutRelation;
  return link?.getAttribute("href") ?? link?.textContent?.trim() ?? "";
}

export function parseFeed(xml: string, source: string, feedUrl?: string): NewsItem[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  // Kaputtes XML ergibt sonst stillschweigend null Meldungen statt eines Fehlers.
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`Feed ${source} ist kein gültiges XML`);
  }
  const out: NewsItem[] = [];

  for (const item of Array.from(doc.getElementsByTagName("item"))) {
    const title = text(item, "title");
    const url = safeUrl(text(item, "link"), feedUrl);
    const date = new Date(text(item, "pubDate"));
    if (title && !Number.isNaN(date.getTime())) out.push({ title, url, date, source });
  }

  for (const entry of Array.from(doc.getElementsByTagName("entry"))) {
    const title = text(entry, "title");
    const url = safeUrl(atomLink(entry), feedUrl);
    const dateRaw = text(entry, "updated") || text(entry, "published");
    const date = new Date(dateRaw);
    if (title && !Number.isNaN(date.getTime())) out.push({ title, url, date, source });
  }

  return out;
}
