import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/index.css", "utf8");

describe("Layout-CSS", () => {
  it("formatiert die von PaneGrid erzeugten Spalten und Vollbreiten-Panes", () => {
    expect(css).toMatch(/\.column\s*\{[^}]*display:\s*flex/s);
    expect(css).toMatch(/\.grid--grouped\s*>\s*\.pane--full\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  });

  it("behält das zweispaltige Agenda-Raster bei", () => {
    expect(css).toMatch(/\.ev\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*11\.5ch\s+1fr/s);
  });
});
