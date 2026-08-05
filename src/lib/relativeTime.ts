export function relativeTime(d: Date, now = new Date()): string {
  const min = Math.round((now.getTime() - d.getTime()) / 60000);
  const abs = Math.abs(min);
  if (abs < 1) return "gerade eben";
  // Zeitpunkte in der Zukunft gab es als „gerade eben" aus — etwa bei falscher Uhrzeit
  // auf dem Proxmox-Host.
  const span = (n: number, unit: string) => (min < 0 ? `in ${n} ${unit}` : `vor ${n} ${unit}`);
  if (abs < 60) return span(abs, "min");
  const h = Math.round(abs / 60);
  if (h < 24) return span(h, "h");
  return span(Math.round(h / 24), "d");
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
