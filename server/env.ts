import { z } from "zod";

export type EnvRecord = Readonly<Record<string, string | undefined>>;

export type PveEnvironment = {
  url: string;
  tokenId: string;
  secret: string;
  caPath: string;
};

export type DashboardEnvironment = {
  port: number;
  configPath: string;
  staticPath: string;
  writeAllow: string[];
  writeHosts: string[];
  pve?: PveEnvironment;
};

export class EnvironmentError extends Error {
  readonly variables: string[];

  constructor(variables: string[]) {
    const unique = [...new Set(variables)];
    super(`Ungültige Umgebungsvariablen: ${unique.join(", ")}`);
    this.name = "EnvironmentError";
    this.variables = unique;
  }
}

const nonEmpty = z.string().trim().min(1);
const pathValue = nonEmpty.refine((value) => !value.includes("\u0000"), "ungültiger Pfad");
const portValue = z.string().trim()
  .min(1)
  .regex(/^\d+$/, "ungültiger Port")
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value >= 1 && value <= 65535, "ungültiger Port");

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const number = Number(part);
    return Number.isInteger(number) && number >= 0 && number <= 255;
  });
}

const cidrValue = nonEmpty.refine((value) => {
  const [address, bits] = value.split("/");
  if (address === undefined || !isIpv4(address)) return false;
  if (bits === undefined) return true;
  return /^\d{1,2}$/.test(bits) && Number(bits) >= 0 && Number(bits) <= 32;
}, "ungültiges IPv4/CIDR");

const hostValue = nonEmpty.refine((value) => {
  if (/[^A-Za-z0-9.:-]/.test(value) || value.includes("..")) return false;
  const portMatch = /:(\d+)$/.exec(value);
  if (portMatch && (Number(portMatch[1]) < 1 || Number(portMatch[1]) > 65535)) return false;
  const hostname = portMatch ? value.slice(0, -portMatch[0].length) : value;
  if (hostname === "" || hostname.startsWith(".") || hostname.endsWith(".")) return false;
  return hostname.split(".").every((part) => /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(part));
}, "ungültiger Host");

const listValue = (item: z.ZodType<string>) => z.string().transform((value) => value.split(",").map((part) => part.trim()))
  .pipe(z.array(item).min(1));

const baseEnvironmentSchema = z.object({
  PORT: portValue,
  DASHBOARD_CONFIG: pathValue,
  DASHBOARD_STATIC: pathValue,
  DASHBOARD_WRITE_ALLOW: listValue(cidrValue),
  DASHBOARD_WRITE_HOSTS: listValue(hostValue),
});

const pveEnvironmentSchema = z.object({
  PVE_URL: nonEmpty.refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.username === "" && url.password === "" &&
        url.pathname === "/" && url.search === "" && url.hash === "";
    } catch {
      return false;
    }
  }, "PVE_URL muss eine HTTPS-URL sein"),
  PVE_TOKEN_ID: nonEmpty,
  PVE_TOKEN_SECRET: nonEmpty,
  PVE_CA_PATH: pathValue,
});

function invalidVariables(issues: z.ZodIssue[]): string[] {
  return issues.map((issue) => {
    const variable = issue.path[0];
    return typeof variable === "string" ? variable : "Umgebung";
  });
}

export function parseEnv(record: EnvRecord): DashboardEnvironment {
  const parsed = baseEnvironmentSchema.safeParse({
    PORT: record.PORT ?? "7777",
    DASHBOARD_CONFIG: record.DASHBOARD_CONFIG ?? "./config.json",
    DASHBOARD_STATIC: record.DASHBOARD_STATIC ?? "./static",
    DASHBOARD_WRITE_ALLOW: record.DASHBOARD_WRITE_ALLOW ?? "127.0.0.1",
    DASHBOARD_WRITE_HOSTS: record.DASHBOARD_WRITE_HOSTS ?? "start.home.arpa,10.0.10.20,localhost,127.0.0.1",
  });
  if (!parsed.success) throw new EnvironmentError(invalidVariables(parsed.error.issues));

  const secret = record.PVE_TOKEN_SECRET?.trim() ?? "";
  let pve: PveEnvironment | undefined;
  if (secret !== "") {
    const pveParsed = pveEnvironmentSchema.safeParse({
      PVE_URL: record.PVE_URL ?? "",
      PVE_TOKEN_ID: record.PVE_TOKEN_ID ?? "",
      PVE_TOKEN_SECRET: record.PVE_TOKEN_SECRET ?? "",
      PVE_CA_PATH: record.PVE_CA_PATH ?? "",
    });
    if (!pveParsed.success) throw new EnvironmentError(invalidVariables(pveParsed.error.issues));
    pve = {
      url: pveParsed.data.PVE_URL.replace(/\/$/, ""),
      tokenId: pveParsed.data.PVE_TOKEN_ID,
      secret: pveParsed.data.PVE_TOKEN_SECRET,
      caPath: pveParsed.data.PVE_CA_PATH,
    };
  }

  return {
    port: parsed.data.PORT,
    configPath: parsed.data.DASHBOARD_CONFIG,
    staticPath: parsed.data.DASHBOARD_STATIC,
    writeAllow: parsed.data.DASHBOARD_WRITE_ALLOW,
    writeHosts: parsed.data.DASHBOARD_WRITE_HOSTS,
    ...(pve ? { pve } : {}),
  };
}

export const env = parseEnv(process.env);
