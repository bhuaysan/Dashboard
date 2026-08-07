import type { ZodIssue } from "zod";

// Deutsche Bezeichnung für Schema-Schlüssel, die in einer Fehlermeldung auftauchen können.
// Nur Blätter, die ein Mensch beim Anblick von "layout.3.span" nicht sofort zuordnen würde.
const FIELD_LABEL: Record<string, string> = {
  label: "Name", url: "URL", hint: "Kürzel", title: "Titel",
  lat: "Breitengrad", lon: "Längengrad", tz: "Zeitzone", secondary: "Zeitzonen",
  default: "Standardsuche", bangs: "Bangs",
  visible: "Sichtbarkeit", span: "Breite", id: "Pane",
  node: "Node-Name", uiUrl: "Proxmox-Oberfläche", expectRunning: "Erwartete Gäste",
  thresholds: "Schwellwerte", cpu: "CPU", mem: "Speicher", storage: "Storage",
  backupAgeHours: "Backup-Alter", host: "Host", port: "Port",
  reachability: "Erreichbarkeit", linkGroups: "Links", feeds: "Feeds",
  calendars: "Kalender", proxyAllowlist: "Proxy", layout: "Layout",
  location: "Ort", clock: "Uhr", search: "Suche", homelab: "Homelab", theme: "Theme",
};

function describeSegment(seg: string | number): string {
  // Array-Index: für Menschen ab 1 zählen, nicht ab 0.
  if (typeof seg === "number") return `#${seg + 1}`;
  return FIELD_LABEL[seg] ?? seg;
}

function describePath(path: (string | number)[]): string {
  if (path.length === 0) return "der Konfiguration";
  return path.map(describeSegment).join(" → ");
}

// Zod-Codes auf deutsche, konsequenzenlose Sätze abbilden — ohne den internen Code oder
// den rohen Feld-Pfad als Haupttext zu zeigen. Ein unbekannter Code fällt auf Zods eigene
// (englische) Meldung zurück statt auf nichts.
function describeCode(issue: ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined" ? "fehlt" : "hat einen unerwarteten Wert";
    case "invalid_string":
      return issue.validation === "url"
        ? "ist keine gültige Adresse (muss mit http:// oder https:// beginnen)"
        : "hat ein ungültiges Format";
    case "too_small":
      return issue.type === "string" ? "darf nicht leer sein" : `muss mindestens ${issue.minimum} sein`;
    case "too_big":
      return issue.type === "string" ? "ist zu lang" : `darf höchstens ${issue.maximum} sein`;
    case "invalid_enum_value":
    case "invalid_literal":
      return "hat einen unbekannten Wert";
    default:
      return issue.message ?? "ist ungültig";
  }
}

/** Verwandelt einen Zod-Befund in einen vollständigen, lesbaren deutschen Satz. */
export function describeIssue(issue: ZodIssue): string {
  return `${describePath(issue.path)} ${describeCode(issue)}.`;
}

/** Der oberste Schlüssel eines Pfads — für die Zuordnung zu einem UI-Abschnitt. */
export function issueRootKey(issue: ZodIssue): string | undefined {
  const first = issue.path[0];
  return typeof first === "string" ? first : undefined;
}
