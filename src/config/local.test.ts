import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readActiveProfileId,
  readLocalCatalog,
  readLocalConfig,
  writeActiveProfileId,
  writeLocalCatalog,
  writeLocalConfig,
} from "./local";
import { DEFAULT_PROFILE_ID, type ProfileId } from "./schema";
import { defaultConfig } from "./defaults";

const WORK_PROFILE_ID = "123e4567-e89b-42d3-a456-426614174000" as ProfileId;
const catalog = {
  profilesUpdatedAt: "2026-09-15T00:00:00.000Z",
  profiles: [
    { id: DEFAULT_PROFILE_ID, name: "Standard" },
    { id: WORK_PROFILE_ID, name: "Arbeit" },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("device-local profile state", () => {
  it("reads and validates the active profile ID", () => {
    writeActiveProfileId(WORK_PROFILE_ID);
    expect(readActiveProfileId()).toBe(WORK_PROFILE_ID);

    localStorage.setItem("dashboard:active-profile", "not-a-profile");
    expect(readActiveProfileId()).toBeUndefined();
  });

  it("validates catalog snapshots before exposing them", () => {
    writeLocalCatalog(catalog);
    expect(readLocalCatalog()).toEqual(catalog);

    localStorage.setItem("dashboard:profiles", JSON.stringify({ ...catalog, profiles: [] }));
    expect(readLocalCatalog()).toBeUndefined();

    localStorage.setItem("dashboard:profiles", JSON.stringify({
      ...catalog,
      profiles: [catalog.profiles[0], { id: WORK_PROFILE_ID, name: "standard" }],
    }));
    expect(readLocalCatalog()).toBeUndefined();
  });

  it("keeps cached configs isolated by profile ID", () => {
    const workConfig = { ...defaultConfig, theme: "light" as const };
    writeLocalConfig(DEFAULT_PROFILE_ID, defaultConfig);
    writeLocalConfig(WORK_PROFILE_ID, workConfig);

    expect(readLocalConfig(DEFAULT_PROFILE_ID)).toEqual(defaultConfig);
    expect(readLocalConfig(WORK_PROFILE_ID)).toEqual(workConfig);
    expect(localStorage.getItem("dashboard:config:default")).not.toBeNull();
    expect(localStorage.getItem(`dashboard:config:${WORK_PROFILE_ID}`)).not.toBeNull();
  });

  it("schreibt Config-Snapshots revisionsmonoton", () => {
    const older = { ...defaultConfig, updatedAt: "2026-09-15T00:00:00.000Z" };
    const newer = { ...defaultConfig, theme: "light" as const, updatedAt: "2026-09-15T00:00:01.000Z" };
    const equal = { ...defaultConfig, theme: "dark" as const, updatedAt: newer.updatedAt };

    writeLocalConfig(DEFAULT_PROFILE_ID, newer);
    writeLocalConfig(DEFAULT_PROFILE_ID, older);
    expect(readLocalConfig(DEFAULT_PROFILE_ID)).toEqual(newer);

    writeLocalConfig(DEFAULT_PROFILE_ID, equal);
    expect(readLocalConfig(DEFAULT_PROFILE_ID)).toEqual(equal);
  });

  it("schreibt Katalog-Snapshots revisionsmonoton", () => {
    const second = catalog.profiles[1];
    if (second === undefined) throw new Error("Testkatalog unvollständig");
    const older = { ...catalog, profilesUpdatedAt: "2026-09-15T00:00:00.000Z" };
    const newer = { ...catalog, profilesUpdatedAt: "2026-09-15T00:00:01.000Z", profiles: [{ id: DEFAULT_PROFILE_ID, name: "Neu" }, second] };
    const equal = { ...newer, profiles: [{ id: DEFAULT_PROFILE_ID, name: "Gleich" }, second] };

    writeLocalCatalog(newer);
    writeLocalCatalog(older);
    expect(readLocalCatalog()).toEqual(newer);

    writeLocalCatalog(equal);
    expect(readLocalCatalog()).toEqual(equal);
  });

  it("migrates the legacy config once and preserves unrelated storage", () => {
    localStorage.setItem("dashboard:config", JSON.stringify(defaultConfig));
    localStorage.setItem("unrelated", "keep");

    expect(readLocalConfig(DEFAULT_PROFILE_ID)).toEqual(defaultConfig);
    expect(localStorage.getItem("dashboard:config:default")).toBe(JSON.stringify(defaultConfig));
    expect(localStorage.getItem("dashboard:config")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");

    localStorage.setItem("dashboard:config", JSON.stringify({ ...defaultConfig, theme: "light" }));
    expect(readLocalConfig(DEFAULT_PROFILE_ID)).toEqual(defaultConfig);
  });

  it("swallows every storage failure", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => { throw new Error("blocked"); });

    expect(() => readActiveProfileId()).not.toThrow();
    expect(() => writeActiveProfileId(DEFAULT_PROFILE_ID)).not.toThrow();
    expect(() => readLocalCatalog()).not.toThrow();
    expect(() => writeLocalCatalog(catalog)).not.toThrow();
    expect(() => readLocalConfig(DEFAULT_PROFILE_ID)).not.toThrow();
    expect(() => writeLocalConfig(DEFAULT_PROFILE_ID, defaultConfig)).not.toThrow();
    expect(readActiveProfileId()).toBeUndefined();
    expect(readLocalCatalog()).toBeUndefined();
    expect(readLocalConfig(DEFAULT_PROFILE_ID)).toBeUndefined();
  });
});
