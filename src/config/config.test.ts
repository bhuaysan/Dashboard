import { describe, expect, it } from "vitest";
import { configSchema } from "./schema";
import { defaultConfig } from "./defaults";
import { readLocalConfig } from "./local";
import { restoreConfig } from "./io";

describe("configSchema", () => {
  it("akzeptiert die Defaults", () => {
    expect(() => configSchema.parse(defaultConfig)).not.toThrow();
  });

  it("weist ein Objekt ohne location ab", () => {
    const { location: _omit, ...rest } = defaultConfig;
    expect(configSchema.safeParse(rest).success).toBe(false);
  });
});

describe("readLocalConfig", () => {
  it("liefert bei kaputtem JSON undefined und wirft nicht", () => {
    localStorage.setItem("dashboard:config", "{kaputt");
    expect(() => readLocalConfig()).not.toThrow();
    expect(readLocalConfig()).toBeUndefined();
  });

  it("liefert undefined, wenn nichts gespeichert ist", () => {
    localStorage.removeItem("dashboard:config");
    expect(readLocalConfig()).toBeUndefined();
  });
});

describe("restoreConfig", () => {
  it("übernimmt beim Restore die aktuelle Serverrevision", () => {
    const imported = { ...defaultConfig, theme: "light" as const, updatedAt: "alter-stand" };
    const current = { ...defaultConfig, updatedAt: "aktueller-stand" };
    const restored = restoreConfig(imported, current);
    expect(restored.theme).toBe("light");
    expect(restored.updatedAt).toBe("aktueller-stand");
  });
});
