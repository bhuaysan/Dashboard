import { describe, expect, it } from "vitest";
import { parseFeed } from "./rss";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Beispiel</title>
  <item>
    <title>Erste Meldung</title>
    <link>https://example.com/1</link>
    <pubDate>Wed, 05 Aug 2026 12:02:00 GMT</pubDate>
  </item>
  <item>
    <title>Zweite Meldung</title>
    <link>https://example.com/2</link>
    <pubDate>Wed, 05 Aug 2026 11:47:00 GMT</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Beispiel</title>
  <entry>
    <title>Erste Meldung</title>
    <link href="https://example.com/1"/>
    <updated>2026-08-05T12:02:00Z</updated>
  </entry>
  <entry>
    <title>Zweite Meldung</title>
    <link href="https://example.com/2"/>
    <published>2026-08-05T11:47:00Z</published>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("liefert für RSS 2.0 und Atom dieselbe Struktur", () => {
    const rss = parseFeed(RSS, "beispiel");
    const atom = parseFeed(ATOM, "beispiel");
    expect(rss).toHaveLength(2);
    expect(atom).toHaveLength(2);
    for (const items of [rss, atom]) {
      expect(items[0]).toMatchObject({
        title: "Erste Meldung",
        url: "https://example.com/1",
        source: "beispiel",
      });
      expect(items[0]?.date.toISOString()).toBe("2026-08-05T12:02:00.000Z");
      expect(items[1]?.title).toBe("Zweite Meldung");
    }
  });

  it("meldet unlesbares XML, statt stillschweigend nichts zu liefern", () => {
    expect(() => parseFeed("<rss><channel>", "beispiel")).toThrow("kein gültiges XML");
  });
});
