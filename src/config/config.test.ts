import { describe, expect, it } from "vitest";
import { configSchema } from "./schema";
import { defaultConfig } from "./defaults";
import { readLocalConfig } from "./local";

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
