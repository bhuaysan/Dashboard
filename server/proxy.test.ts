// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertAllowed, isBlockedIp } from "./proxy.ts";

const allow = ["api.open-meteo.com", "localhost", "169.254.169.254"];
const resolveAddress = async (hostname: string): Promise<{ address: string }> => ({
  address: hostname === "localhost" ? "127.0.0.1" : hostname === "169.254.169.254" ? hostname : "93.184.216.34",
});

describe("assertAllowed", () => {
  it("lässt erlaubte Hosts durch und liefert die geprüfte Adresse", async () => {
    await expect(
      assertAllowed(new URL("https://api.open-meteo.com/v1/forecast"), allow, async () => ({ address: "93.184.216.34" })),
    ).resolves.toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  });

  it("lehnt fremde Hosts ab", async () => {
    await expect(assertAllowed(new URL("https://example.com/"), allow)).rejects.toThrow(
      "Host nicht erlaubt",
    );
  });

  it("lehnt private Adressen ab", async () => {
    await expect(assertAllowed(new URL("http://localhost:8006/"), allow, resolveAddress)).rejects.toThrow(
      "Private Adresse",
    );
  });

  it("lehnt die Metadaten-Adresse ab", async () => {
    await expect(assertAllowed(new URL("http://169.254.169.254/latest"), allow, resolveAddress)).rejects.toThrow(
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

  it("sperrt reservierte Bereiche", () => {
    for (const ip of ["192.0.0.1", "192.0.2.1", "198.18.0.1", "198.19.255.255", "224.0.0.1", "240.0.0.1", "255.255.255.255"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  it("sperrt Oktette außerhalb von 0–255", () => {
    expect(isBlockedIp("999.1.1.1")).toBe(true);
  });

  it("sperrt IPv6 pauschal", () => {
    expect(isBlockedIp("::1")).toBe(true);
  });

  it("lässt öffentliche Adressen durch", () => {
    expect(isBlockedIp("49.12.34.56")).toBe(false);
  });
});
