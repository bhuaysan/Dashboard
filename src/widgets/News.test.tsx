import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fetchNews, News } from "./News";
import type { ProfileId } from "../config/schema";

const PROFILE_ID = "123e4567-e89b-42d3-a456-426614174000" as ProfileId;

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
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await expect(fetchNews(PROFILE_ID, feeds, controller.signal)).rejects.toThrow("Kein Feed erreichbar");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`profile=${PROFILE_ID}`), { signal: controller.signal });
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal === controller.signal)).toBe(true);
  });

  it("liefert die erreichbaren Quellen, wenn nur eine ausfällt", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("eins.example")
        ? new Response(FEED, { status: 200 })
        : new Response("", { status: 502 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchNews(PROFILE_ID, feeds);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.source).toBe("eins");
    expect(result.failures).toEqual(["zwei"]);
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes(`profile=${PROFILE_ID}`))).toBe(true);
  });

  it("wertet unlesbares XML als Ausfall der Quelle", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<rss><channel>", { status: 200 })));
    await expect(fetchNews(PROFILE_ID, feeds)).rejects.toThrow("Kein Feed erreichbar");
  });

  it("bleibt ohne eingetragene Feeds leer statt zu scheitern", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    await expect(fetchNews(PROFILE_ID, [])).resolves.toEqual({ items: [], failures: [] });
  });

  it("sortiert vor dem Feed-Limit, damit der neueste Artikel bleibt", async () => {
    const ascending = `<?xml version="1.0"?><rss><channel>
      <item><title>alt</title><link>/alt</link><pubDate>Wed, 05 Aug 2026 11:00:00 GMT</pubDate></item>
      <item><title>neu</title><link>/neu</link><pubDate>Wed, 05 Aug 2026 12:00:00 GMT</pubDate></item>
    </channel></rss>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(ascending, { status: 200 })));
    const result = await fetchNews(PROFILE_ID, [{ label: "feed", url: "https://example.com/rss.xml", limit: 1 }]);
    expect(result.items.map((item) => item.title)).toEqual(["neu"]);
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
