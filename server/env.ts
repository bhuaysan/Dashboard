export const env = {
  port: Number(process.env.PORT ?? 7777),  configPath: process.env.DASHBOARD_CONFIG ?? "./config.json",
  staticPath: process.env.DASHBOARD_STATIC?.trim() || "./static",
  writeAllow: (process.env.DASHBOARD_WRITE_ALLOW ?? "127.0.0.1").split(",").map((s) => s.trim()),
  writeHosts: (process.env.DASHBOARD_WRITE_HOSTS ?? "start.home.arpa,10.0.10.20,localhost,127.0.0.1")
    .split(",").map((s) => s.trim()).filter(Boolean),
  pve: process.env.PVE_TOKEN_SECRET
    ? {
        url: process.env.PVE_URL ?? "",
        tokenId: process.env.PVE_TOKEN_ID ?? "",
        secret: process.env.PVE_TOKEN_SECRET,
        caPath: process.env.PVE_CA_PATH ?? "./pve-ca.pem",
      }
    : undefined,     // undefined = Homelab nicht konfiguriert, das ist kein Fehler
};
