import { configSchema, type Config } from "./schema";

export function exportConfig(cfg: Config): void {
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "dashboard-config.json";
  a.click();
  URL.revokeObjectURL(url);
}

export type ImportResult = { ok: true; config: Config } | { ok: false; message: string };

export async function importConfig(file: File): Promise<ImportResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return { ok: false, message: "Datei ist kein gültiges JSON." };
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue && issue.path.length > 0 ? issue.path.join(".") : "(Wurzel)";
    return { ok: false, message: `Konfiguration ungültig: Fehler bei ${path}.` };
  }
  return { ok: true, config: parsed.data };
}
