import { describe, expect, it } from "vitest";
import { fuzzyFilter } from "./fuzzy";

const links = [
  { label: "Datasphere" },
  { label: "Analytics Cloud" },
  { label: "BTP Cockpit" },
  { label: "Home Assistant" },
  { label: "Jira" },
  { label: "Confluence" },
  { label: "Proxmox" },
  { label: "Pi-hole" },
  { label: "Jellyfin" },
  { label: "Filebrowser" },
  { label: "GitHub" },
  { label: "MDN" },
];

describe("fuzzyFilter", () => {
  it("findet Datasphere über dat", () => {
    const hits = fuzzyFilter("dat", links, (l) => l.label);
    expect(hits[0]?.label).toBe("Datasphere");
  });

  it("bewertet Treffer am Wortanfang höher", () => {
    const items = [{ label: "xdata" }, { label: "data x" }];
    const hits = fuzzyFilter("data", items, (l) => l.label);
    expect(hits[0]?.label).toBe("data x");
  });

  it("begrenzt die Ergebnismenge auf 8", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ label: `aaaa${i}` }));
    expect(fuzzyFilter("a", many, (l) => l.label)).toHaveLength(8);
  });

  it("liefert nichts, wenn kein Zeichen passt", () => {
    expect(fuzzyFilter("zzz", links, (l) => l.label)).toHaveLength(0);
  });
});
