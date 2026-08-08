import { describe, expect, it } from "vitest";
import { linkHost } from "./host";

describe("linkHost", () => {
  it("gibt den Host ohne Schema und Pfad", () => {
    expect(linkHost("https://github.com")).toBe("github.com");
    expect(linkHost("https://drive.google.com/")).toBe("drive.google.com");
    expect(linkHost("https://github.com/search?q=test")).toBe("github.com");
  });

  it("behält den Port — er unterscheidet die Homelab-Dienste", () => {
    expect(linkHost("https://10.0.10.10:8006/#v1:0:18")).toBe("10.0.10.10:8006");
    expect(linkHost("https://10.0.10.107:7195/tos/#/desktop")).toBe("10.0.10.107:7195");
  });

  it("wirft www. weg, weil es in jeder Zeile gleich stünde", () => {
    expect(linkHost("https://www.heise.de/rss/")).toBe("heise.de");
    // Nur das führende www., nicht irgendein www im Namen.
    expect(linkHost("https://wwwtest.example.com")).toBe("wwwtest.example.com");
  });

  it("liefert nichts bei unbrauchbaren Adressen", () => {
    expect(linkHost("kein-url")).toBe("");
    expect(linkHost("")).toBe("");
    // javascript: käme über die Config herein und hätte in der Anzeige nichts zu suchen.
    expect(linkHost("javascript:alert(1)")).toBe("");
  });
});
