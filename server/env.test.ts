// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EnvironmentError, parseEnv } from "./env.ts";

const base = {
  PORT: "7777",
  DASHBOARD_CONFIG: "/tmp/dashboard/config.json",
  DASHBOARD_STATIC: "/tmp/dashboard/static",
  DASHBOARD_WRITE_ALLOW: "127.0.0.1,10.0.10.0/24",
  DASHBOARD_WRITE_HOSTS: "start.home.arpa,localhost",
};

describe("parseEnv", () => {
  it("parst eine synthetische Entwicklungsumgebung ohne .env", () => {
    expect(parseEnv(base)).toEqual({
      port: 7777,
      configPath: "/tmp/dashboard/config.json",
      staticPath: "/tmp/dashboard/static",
      writeAllow: ["127.0.0.1", "10.0.10.0/24"],
      writeHosts: ["start.home.arpa", "localhost"],
    });
  });

  it.each([
    ["leer", ""],
    ["zu klein", "0"],
    ["zu groß", "65536"],
    ["nicht numerisch", "NaN"],
  ])("weist einen %s Port mit ausschließlich Variablennamen ab", (_label, port) => {
    expect(() => parseEnv({ ...base, PORT: port })).toThrow("PORT");
  });

  it("weist kaputte CIDR- und Hostlisten ab", () => {
    expect(() => parseEnv({ ...base, DASHBOARD_WRITE_ALLOW: "10.0.0.0/33" })).toThrow("DASHBOARD_WRITE_ALLOW");
    expect(() => parseEnv({ ...base, DASHBOARD_WRITE_HOSTS: "https://evil.example" })).toThrow("DASHBOARD_WRITE_HOSTS");
  });

  it("behandelt PVE-Felder ohne Secret als nicht konfiguriert", () => {
    const parsed = parseEnv({
      ...base,
      PVE_URL: "https://pve.example:8006",
      PVE_TOKEN_ID: "dashboard@pve!startpage",
      PVE_TOKEN_SECRET: "   ",
      PVE_CA_PATH: "/etc/dashboard/pve-ca.pem",
    });
    expect(parsed.pve).toBeUndefined();
  });

  it("akzeptiert eine vollständig leere PVE-Gruppe als nicht konfiguriert", () => {
    const parsed = parseEnv({
      ...base,
      PVE_URL: "",
      PVE_TOKEN_ID: "",
      PVE_TOKEN_SECRET: "",
      PVE_CA_PATH: "",
    });
    expect(parsed.pve).toBeUndefined();
  });

  it("akzeptiert eine vollständige HTTPS-PVE-Konfiguration", () => {
    const parsed = parseEnv({
      ...base,
      PVE_URL: "https://pve.example:8006",
      PVE_TOKEN_ID: "dashboard@pve!startpage",
      PVE_TOKEN_SECRET: "synthetic-secret",
      PVE_CA_PATH: "/etc/dashboard/pve-ca.pem",
    });
    expect(parsed.pve).toEqual({
      url: "https://pve.example:8006",
      tokenId: "dashboard@pve!startpage",
      secret: "synthetic-secret",
      caPath: "/etc/dashboard/pve-ca.pem",
    });
  });

  it("behandelt teilweise konfigurierte PVE-Felder als Startup-Fehler", () => {
    try {
      parseEnv({ ...base, PVE_URL: "http://pve.example:8006", PVE_TOKEN_SECRET: "synthetic-secret" });
      throw new Error("erwarteter Testfehler fehlt");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentError);
      if (error instanceof Error) {
        expect(error.message).toContain("PVE_URL");
        expect(error.message).toContain("PVE_TOKEN_ID");
        expect(error.message).not.toContain("synthetic-secret");
      }
    }
  });

  it("fordert bei gesetztem Secret die übrigen PVE-Felder an", () => {
    try {
      parseEnv({ ...base, PVE_TOKEN_SECRET: "synthetic-secret" });
      throw new Error("erwarteter Testfehler fehlt");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentError);
      if (error instanceof EnvironmentError) {
        expect(error.variables).toEqual(expect.arrayContaining(["PVE_URL", "PVE_TOKEN_ID", "PVE_CA_PATH"]));
        expect(error.message).not.toContain("synthetic-secret");
      }
    }
  });
});
