export const env = {
  port: Number(process.env.PORT ?? 7777),
  configPath: process.env.DASHBOARD_CONFIG ?? "./config.json",
  writeAllow: (process.env.DASHBOARD_WRITE_ALLOW ?? "127.0.0.1").split(",").map((s) => s.trim()),
  pve: process.env.PVE_TOKEN_SECRET
    ? {
        url: process.env.PVE_URL ?? "",
        tokenId: process.env.PVE_TOKEN_ID ?? "",
        secret: process.env.PVE_TOKEN_SECRET,
        caPath: process.env.PVE_CA_PATH ?? "./pve-ca.pem",
      }
    : undefined,     // undefined = Homelab nicht konfiguriert, das ist kein Fehler
};
