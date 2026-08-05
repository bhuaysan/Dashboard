import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/defaults";

let dir: string;
let configPath: string;
let store: typeof import("./config-store.ts");

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dashboard-store-"));
  configPath = join(dir, "config.json");
  process.env.DASHBOARD_CONFIG = configPath;
  store = await import("./config-store.ts");
});

describe("readConfig", () => {
  it("liefert Defaults, wenn die Datei fehlt", async () => {
    expect(await store.readConfig()).toEqual(defaultConfig);
  });

  it("legt bei kaputtem Inhalt eine .bak-Datei an und fällt auf Defaults zurück", async () => {
    await writeFile(configPath, JSON.stringify({ version: 99, kaputt: true }));
    expect(await store.readConfig()).toEqual(defaultConfig);
    const bak = JSON.parse(await readFile(`${configPath}.bak`, "utf8")) as { version: number };
    expect(bak.version).toBe(99);
  });
});

describe("writeConfig", () => {
  it("hebt die vorherigen Stände als config.json.1 bis .7 auf", async () => {
    // zehn Speichervorgänge mit unterscheidbarem Inhalt
    for (let i = 1; i <= 10; i++) {
      await store.writeConfig({ ...defaultConfig, updatedAt: `stand-${i}` });
    }
    const aktuell = JSON.parse(await readFile(configPath, "utf8")) as { updatedAt: string };
    expect(aktuell.updatedAt).toBe("stand-10");

    // .1 ist der jüngste vorherige Stand, .7 der älteste
    const backups = await Promise.all(
      [1, 7].map(async (n) => JSON.parse(await readFile(`${configPath}.${n}`, "utf8")) as { updatedAt: string }),
    );
    expect(backups[0]?.updatedAt).toBe("stand-9");
    expect(backups[1]?.updatedAt).toBe("stand-3");

    // und es bleiben genau sieben übrig
    const files = await readdir(dir);
    expect(files.filter((f) => /^config\.json\.\d+$/.test(f))).toHaveLength(7);
  });
});

describe("writeAtomic", () => {
  it("schreibt vollständig und hinterlässt keine tmp-Datei", async () => {
    const target = join(dir, "atomic.txt");
    await store.writeAtomic(target, "inhalt");
    expect(await readFile(target, "utf8")).toBe("inhalt");
    const files = await readdir(dir);
    expect(files.some((f) => f.includes(".tmp-"))).toBe(false);
  });
});
