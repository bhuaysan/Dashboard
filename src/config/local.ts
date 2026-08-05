import { configSchema, type Config } from "./schema";

const KEY = "dashboard:config";

export function readLocalConfig(): Config | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = configSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

export function writeLocalConfig(cfg: Config): void {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* Speicher voll: ignorieren */ }
}
