// Der Zielhost einer Linkadresse, wie er in der Links-Pane rechts neben dem Namen steht.
// Der Port bleibt stehen — bei 10.0.10.10:8006 und 10.0.10.107:7195 ist er das
// Unterscheidungsmerkmal. „www." fällt weg: es steht in jeder Zeile gleich und trägt nichts.
export function linkHost(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";           // unbrauchbare Adresse: die Zeile bleibt rechts eben leer
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  return parsed.host.replace(/^www\./, "");
}
