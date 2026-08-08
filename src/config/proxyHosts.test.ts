import { describe, expect, it } from "vitest";
import { defaultConfig } from "./defaults";
import { requiredProxyHosts, withRequiredProxyHosts } from "./proxyHosts";
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

describe("withRequiredProxyHosts", () => {
  it("ergänzt den fehlenden Host und behält die bestehenden Einträge in ihrer Reihenfolge", () => {
    const c = cfg({
      proxyAllowlist: ["api.open-meteo.com", "www.heise.de"],
      feeds: [{ label: "zt", url: "https://newsfeed.zeit.de/index", limit: 5 }],
    });
    expect(withRequiredProxyHosts(c).proxyAllowlist)
      .toEqual(["api.open-meteo.com", "www.heise.de", "newsfeed.zeit.de"]);
  });

  it("gibt dieselbe Config zurück, wenn nichts fehlt", () => {
    const c = cfg({
      proxyAllowlist: ["www.heise.de"],
      feeds: [{ label: "he", url: "https://www.heise.de/rss", limit: 5 }],
      calendars: [],
    });
    expect(withRequiredProxyHosts(c)).toBe(c);
  });

  it("erkennt einen bereits gelisteten Host trotz abweichender Schreibweise", () => {
    const c = cfg({
      proxyAllowlist: ["WWW.Heise.DE"],
      feeds: [{ label: "he", url: "https://www.heise.de/rss", limit: 5 }],
      calendars: [],
    });
    expect(withRequiredProxyHosts(c)).toBe(c);
  });
});
