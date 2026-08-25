// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkReachability } from "./reachability.ts";

describe("checkReachability", () => {
  it("prüft mehrere Ziele parallel und unterscheidet offen von geschlossen", async () => {
    const started: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const result = checkReachability([
      { label: "offen", host: "open.example", port: 80 },
      { label: "geschlossen", host: "closed.example", port: 81 },
    ], async (target) => {
      started.push(target.host);
      await gate;
      return target.port === 80;
    });
    await Promise.resolve();
    expect(started).toEqual(["open.example", "closed.example"]);
    release();
    await expect(result).resolves.toEqual([
      { label: "offen", ok: true },
      { label: "geschlossen", ok: false },
    ]);
  });

  it("liefert für eine leere Zielmenge sofort ein leeres Ergebnis", async () => {
    await expect(checkReachability([])).resolves.toEqual([]);
  });
});
