import { describe, expect, it } from "vitest";
import { defaultConfig } from "./defaults";
import { effectiveProxyHosts, requiredProxyHosts } from "./proxyHosts";
import type { Config } from "./schema";

function cfg(over: Partial<Config>): Config {
  return { ...defaultConfig, ...over };
}

describe("requiredProxyHosts", () => {
  it("sammelt die Hosts von Feeds und Kalendern", () => {
    const c = cfg({
      feeds: [{ label: "zt", url: "https://newsfeed.zeit.de/index", limit: 5 }],
      calendars: [{ label: "Arbeit", url: "https://cal.example.com/x.ics" }],
    });
    expect(requiredProxyHosts(c)).toEqual(["newsfeed.zeit.de", "cal.example.com"]);
  });

  it("lässt den Port weg — der Proxy vergleicht ohne ihn", () => {
    const c = cfg({ feeds: [{ label: "x", url: "https://example.com:8443/feed", limit: 5 }] });
    expect(requiredProxyHosts(c)).toEqual(["example.com"]);
  });

  it("nennt jeden Host einmal, auch bei mehreren Quellen darauf", () => {
    const c = cfg({
      feeds: [
        { label: "a", url: "https://www.heise.de/rss/a", limit: 5 },
        { label: "b", url: "https://www.heise.de/rss/b", limit: 5 },
      ],
    });
    expect(requiredProxyHosts(c)).toEqual(["www.heise.de"]);
  });

  it("überspringt lokale Kalenderpfade und unbrauchbare Adressen", () => {
    const c = cfg({
      feeds: [{ label: "kaputt", url: "kein-url", limit: 5 }],
      calendars: [{ label: "lokal", url: "/kalender/arbeit.ics" }],
    });
    expect(requiredProxyHosts(c)).toEqual([]);
  });
});

describe("effectiveProxyHosts", () => {
  it("ergänzt den fehlenden Host und behält die bestehenden Einträge in ihrer Reihenfolge", () => {
    const c = cfg({
      proxyAllowlist: ["api.open-meteo.com", "www.heise.de"],
      feeds: [{ label: "zt", url: "https://newsfeed.zeit.de/index", limit: 5 }],
    });
    expect(effectiveProxyHosts(c))
      .toEqual(["api.open-meteo.com", "www.heise.de", "newsfeed.zeit.de"]);
  });

  it("ändert die persistierbare Config nicht", () => {
    const c = cfg({
      proxyAllowlist: ["www.heise.de"],
      feeds: [{ label: "he", url: "https://www.heise.de/rss", limit: 5 }],
      calendars: [],
    });
    expect(effectiveProxyHosts(c)).toEqual(["www.heise.de"]);
    expect(c.proxyAllowlist).toEqual(["www.heise.de"]);
  });

  it("erkennt einen bereits gelisteten Host trotz abweichender Schreibweise", () => {
    const c = cfg({
      proxyAllowlist: ["WWW.Heise.DE"],
      feeds: [{ label: "he", url: "https://www.heise.de/rss", limit: 5 }],
      calendars: [],
    });
    expect(effectiveProxyHosts(c)).toEqual(["www.heise.de"]);
  });

  it("bleibt auch bei maximaler manueller Allowlist außerhalb der Config-Grenze", () => {
    const c = cfg({
      proxyAllowlist: Array.from({ length: 128 }, (_, index) => `manual-${index}.example`),
      feeds: Array.from({ length: 32 }, (_, index) => ({
        label: `Feed ${index}`, url: `https://feed-${index}.example/rss`, limit: 5,
      })),
      calendars: Array.from({ length: 32 }, (_, index) => ({
        label: `Kalender ${index}`, url: `https://cal-${index}.example/work.ics`,
      })),
    });
    expect(effectiveProxyHosts(c)).toHaveLength(192);
    expect(c.proxyAllowlist).toHaveLength(128);
  });
});
