import { describe, expect, it } from "vitest";
import { assertAllowed, isBlockedIp } from "./proxy.ts";

const allow = ["api.open-meteo.com", "localhost", "169.254.169.254"];

describe("assertAllowed", () => {
  it("lässt erlaubte Hosts durch", async () => {
    await expect(
      assertAllowed(new URL("https://api.open-meteo.com/v1/forecast"), allow),
    ).resolves.toBeUndefined();
  });

  it("lehnt fremde Hosts ab", async () => {
    await expect(assertAllowed(new URL("https://example.com/"), allow)).rejects.toThrow(
      "Host nicht erlaubt",
    );
  });

  it("lehnt private Adressen ab", async () => {
    await expect(assertAllowed(new URL("http://localhost:8006/"), allow)).rejects.toThrow(
      "Private Adresse",
    );
  });

  it("lehnt die Metadaten-Adresse ab", async () => {
    await expect(assertAllowed(new URL("http://169.254.169.254/latest"), allow)).rejects.toThrow(
      "Private Adresse",
    );
  });

  it("lehnt fremde Schemas ab", async () => {
    await expect(assertAllowed(new URL("ftp://api.open-meteo.com/"), allow)).rejects.toThrow(
      "Schema",
    );
  });
});

describe("isBlockedIp", () => {
  it("sperrt private Bereiche", () => {
    for (const ip of ["10.0.10.10", "127.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  it("sperrt IPv6 pauschal", () => {
    expect(isBlockedIp("::1")).toBe(true);
  });

  it("lässt öffentliche Adressen durch", () => {
    expect(isBlockedIp("49.12.34.56")).toBe(false);
  });
});
