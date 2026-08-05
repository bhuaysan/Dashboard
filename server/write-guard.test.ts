import { describe, expect, it } from "vitest";
import { ipAllowed } from "./write-guard.ts";

describe("ipAllowed", () => {
  it("lässt exakt gelistete Adressen durch", () => {
    expect(ipAllowed("127.0.0.1", ["127.0.0.1"])).toBe(true);
    expect(ipAllowed("10.0.10.164", ["10.0.10.164"])).toBe(true);
  });

  it("lässt Adressen im CIDR-Bereich durch", () => {
    expect(ipAllowed("10.0.10.164", ["10.0.10.0/24"])).toBe(true);
    expect(ipAllowed("10.0.10.1", ["10.0.10.0/24"])).toBe(true);
    expect(ipAllowed("10.0.10.254", ["10.0.10.0/24"])).toBe(true);
  });

  it("sperrt Adressen außerhalb", () => {
    expect(ipAllowed("10.0.11.5", ["10.0.10.0/24"])).toBe(false);
    expect(ipAllowed("192.168.1.1", ["10.0.10.0/24"])).toBe(false);
    expect(ipAllowed("10.0.10.164", ["127.0.0.1"])).toBe(false);
  });

  it("behandelt kaputte Einträge als nicht passend", () => {
    expect(ipAllowed("10.0.10.164", ["10.0.10.0/33"])).toBe(false);
    expect(ipAllowed("10.0.10.164", ["kaputt/24"])).toBe(false);
  });
});
