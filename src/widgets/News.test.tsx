import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fetchNews, News } from "./News";

const FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Meldung</title><link>https://example.com/1</link>
  <pubDate>Wed, 05 Aug 2026 12:02:00 GMT</pubDate></item>
</channel></rss>`;

const feeds = [
  { label: "eins", url: "https://eins.example/rss", limit: 5 },
  { label: "zwei", url: "https://zwei.example/rss", limit: 5 },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchNews", () => {
  it("meldet einen Fehler, wenn keine einzige Quelle antwortet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    await expect(fetchNews(feeds)).rejects.toThrow("Kein Feed erreichbar");
  });

  it("liefert die erreichbaren Quellen, wenn nur eine ausfällt", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("eins.example")
        ? new Response(FEED, { status: 200 })
        : new Response("", { status: 502 }),
    ));
    const items = await fetchNews(feeds);
    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe("eins");
  });

  it("wertet unlesbares XML als Ausfall der Quelle", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<rss><channel>", { status: 200 })));
    await expect(fetchNews(feeds)).rejects.toThrow("Kein Feed erreichbar");
  });

  it("bleibt ohne eingetragene Feeds leer statt zu scheitern", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    await expect(fetchNews([])).resolves.toEqual([]);
  });
});

describe("News", () => {
  const items = [
    { title: "Echte Meldung", url: "https://example.com/1", source: "eins", date: new Date() },
    { title: "Vergiftete Meldung", url: "javascript:alert(1)", source: "zwei", date: new Date() },
  ];

  it("verlinkt Meldungen, aber nur über http und https", () => {
    render(<News items={items} selIndex={-1} feedCount={2} />);
    expect(screen.getByText("Echte Meldung").closest("a")?.getAttribute("href"))
      .toBe("https://example.com/1");
    // Die Adresse kommt aus einem fremden Feed — javascript: darf nie ein href werden.
    expect(screen.getByText("Vergiftete Meldung").closest("a")).toBeNull();
  });
});
