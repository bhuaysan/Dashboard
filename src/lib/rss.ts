export type NewsItem = { title: string; url: string; date: Date; source: string };

function text(parent: Element, tag: string): string {
  return parent.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
}

export function parseFeed(xml: string, source: string): NewsItem[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  // Kaputtes XML ergibt sonst stillschweigend null Meldungen statt eines Fehlers.
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`Feed ${source} ist kein gültiges XML`);
  }
  const out: NewsItem[] = [];

  for (const item of Array.from(doc.getElementsByTagName("item"))) {
    const title = text(item, "title");
    const url = text(item, "link");
    const date = new Date(text(item, "pubDate"));
    if (title && !Number.isNaN(date.getTime())) out.push({ title, url, date, source });
  }

  for (const entry of Array.from(doc.getElementsByTagName("entry"))) {
    const title = text(entry, "title");
    const url = entry.getElementsByTagName("link")[0]?.getAttribute("href") ?? "";
    const dateRaw = text(entry, "updated") || text(entry, "published");
    const date = new Date(dateRaw);
    if (title && !Number.isNaN(date.getTime())) out.push({ title, url, date, source });
  }

  return out;
}
