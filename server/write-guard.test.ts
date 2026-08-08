import { describe, expect, it } from "vitest";
import { hostAllowed, ipAllowed, originAllowed } from "./write-guard.ts";

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

describe("hostAllowed und originAllowed", () => {
  const hosts = ["start.home.arpa", "10.0.10.20", "localhost"];

  it("akzeptiert erlaubte Hosts mit Port und Großschreibung", () => {
    expect(hostAllowed("START.HOME.ARPA", hosts)).toBe(true);
    expect(hostAllowed("localhost:7777", hosts)).toBe(true);
    expect(hostAllowed("evil.example", hosts)).toBe(false);
  });

  it("akzeptiert nur eine passende HTTP(S)-Origin", () => {
    expect(originAllowed("http://start.home.arpa", "start.home.arpa", hosts)).toBe(true);
    expect(originAllowed("http://evil.example", "start.home.arpa", hosts)).toBe(false);
    expect(originAllowed("javascript:alert(1)", "start.home.arpa", hosts)).toBe(false);
    expect(originAllowed("http://localhost:5173", "localhost:7777", hosts)).toBe(true);
    expect(originAllowed("http://start.home.arpa/path", "start.home.arpa", hosts)).toBe(false);
    expect(originAllowed("null", "start.home.arpa", hosts)).toBe(false);
  });
});
