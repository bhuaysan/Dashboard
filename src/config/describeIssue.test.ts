import { describe, expect, it } from "vitest";
import { configSchema } from "./schema";
import { defaultConfig } from "./defaults";
import { describeIssue, issueRootKey } from "./describeIssue";

function firstIssue(candidate: unknown) {
  const parsed = configSchema.safeParse(candidate);
  if (parsed.success) throw new Error("Testfixtur sollte ungültig sein");
  const issue = parsed.error.issues[0];
  if (!issue) throw new Error("keine Issues");
  return issue;
}

describe("describeIssue", () => {
  it("übersetzt einen ungültigen Enum-Wert lesbar, ohne den rohen Pfad", () => {
    const bad = structuredClone(defaultConfig);
    // @ts-expect-error absichtlich falscher Wert für den Test
    bad.layout[3].span = 3;
    const issue = firstIssue(bad);
    const text = describeIssue(issue);
    expect(text).not.toContain("layout.3.span");
    expect(text).toContain("Layout");
    expect(text).toContain("#4");
    expect(text).toContain("Breite");
  });

  it("übersetzt eine ungültige URL", () => {
    const bad = structuredClone(defaultConfig);
    const link = bad.linkGroups[0]?.links[0];
    if (link) link.url = "nicht-http";
    const issue = firstIssue(bad);
    expect(describeIssue(issue)).toContain("gültige Adresse");
  });

  it("benennt Fehler in Uptime-Zielen lesbar", () => {
    const bad = structuredClone(defaultConfig);
    bad.uptime.targets = [{
      id: "423e4567-e89b-42d3-a456-426614174000",
      type: "http",
      label: "Startseite",
      url: "nicht-http",
    }];
    expect(describeIssue(firstIssue(bad))).toContain("Uptime");
  });

  it("übersetzt ein fehlendes Feld", () => {
    const bad = structuredClone(defaultConfig) as unknown as Record<string, unknown>;
    delete bad.location;
    const issue = firstIssue(bad);
    expect(describeIssue(issue)).toContain("Ort");
    expect(describeIssue(issue)).toContain("fehlt");
  });

  it("liefert den obersten Pfad-Schlüssel zur Abschnittszuordnung", () => {
    const bad = structuredClone(defaultConfig) as unknown as Record<string, unknown>;
    (bad.homelab as Record<string, unknown>).reachability = [{ label: "x", host: 123, port: 80 }];
    const issue = firstIssue(bad);
    expect(issueRootKey(issue)).toBe("homelab");
  });

  it("hat keinen obersten Schlüssel, wenn der Fehlerwert selbst kein Objekt ist", () => {
    const issue = firstIssue("das ist keine Konfiguration");
    expect(issue.path).toEqual([]);
    expect(issueRootKey(issue)).toBeUndefined();
  });

  it("verwendet für Prototypnamen keine geerbten Feldbeschreibungen", () => {
    const issue = {
      code: "custom" as const,
      path: ["toString"],
      message: "ist ungültig",
    };
    expect(describeIssue(issue)).toBe("toString ist ungültig.");
  });
});
