import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  emptyUptimeState,
  targetFingerprint,
  uptimeStateDocumentSchema,
  type StoredTargetState,
  type UptimeStateDocument,
} from "./uptime-state";
import {
  createUptimeStateStore,
  MAX_UPTIME_STATE_BYTES,
  UptimeStoreError,
} from "./uptime-store";

const TARGET_ID = "123e4567-e89b-42d3-a456-426614174010";

function targetState(id = TARGET_ID, fingerprint?: string): StoredTargetState {
  return {
    id,
    fingerprint: fingerprint ?? targetFingerprint({
      id,
      type: "http",
      label: "Web",
      url: "https://example.com/health",
    }),
    sampleMinute: 29_841_723,
    samples: "1",
    status: "up",
    statusSince: "2026-09-22T10:03:00.000Z",
    checkedAt: "2026-09-22T10:03:00.000Z",
    responseTimeMs: 20,
    consecutiveFailures: 0,
    error: null,
  };
}

function validDocument(): UptimeStateDocument {
  return {
    version: 1,
    profiles: [{
      id: "default",
      updatedAt: "2026-09-22T10:03:00.000Z",
      targets: [targetState()],
    }],
  };
}

type StoreFixture = {
  dir: string;
  statePath: string;
};

function itWithStore(name: string, test: (fixture: StoreFixture) => Promise<void>): void {
  it(name, async () => {
    const dir = await mkdtemp(join(tmpdir(), "dashboard-uptime-store-"));
    try {
      await test({ dir, statePath: join(dir, "uptime.json") });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

describe("UptimeStateStore.load", () => {
  itWithStore("liefert bei fehlender Datei einen frischen Zustand, ohne eine Datei anzulegen", async ({ dir, statePath }) => {
    const store = createUptimeStateStore(statePath);
    const first = await store.load();
    first.profiles.push({ id: "default", updatedAt: null, targets: [] });
    expect(await store.load()).toEqual(emptyUptimeState);
    expect(await readdir(dir)).toEqual([]);
  });

  itWithStore("liest ein vollständig validiertes Dokument", async ({ statePath }) => {
    const document = validDocument();
    await writeFile(statePath, JSON.stringify(document));
    expect(await createUptimeStateStore(statePath).load()).toEqual(document);
  });

  itWithStore("sichert syntaktisch beschädigten Inhalt identisch und startet leer", async ({ statePath }) => {
    const broken = "{kein json";
    await writeFile(statePath, broken);
    expect(await createUptimeStateStore(statePath).load()).toEqual(emptyUptimeState);
    expect(await readFile(`${statePath}.bak`, "utf8")).toBe(broken);
  });

  itWithStore("sichert semantisch ungültigen Inhalt identisch und startet leer", async ({ statePath }) => {
    const broken = JSON.stringify({ version: 9, profiles: [] });
    await writeFile(statePath, broken);
    expect(await createUptimeStateStore(statePath).load()).toEqual(emptyUptimeState);
    expect(await readFile(`${statePath}.bak`, "utf8")).toBe(broken);
  });

  itWithStore("sichert eine zu große Datei ohne sie einzulesen und startet leer", async ({ statePath }) => {
    const broken = "x".repeat(MAX_UPTIME_STATE_BYTES + 1);
    await writeFile(statePath, broken);
    expect(await createUptimeStateStore(statePath).load()).toEqual(emptyUptimeState);
    expect(await readFile(`${statePath}.bak`, "utf8")).toBe(broken);
  });

  it.each([
    ["Profil-IDs", {
      ...validDocument(),
      profiles: [validDocument().profiles[0]!, validDocument().profiles[0]!],
    }],
    ["Ziel-IDs", {
      ...validDocument(),
      profiles: [{
        ...validDocument().profiles[0]!,
        targets: [targetState(), targetState()],
      }],
    }],
  ])("weist doppelte %s auf Schemaebene ab", (_kind, document) => {
    expect(uptimeStateDocumentSchema.safeParse(document).success).toBe(false);
  });
});

describe("UptimeStateStore.save", () => {
  itWithStore("schreibt atomar mit Modus 0600 und ohne temporäre Datei", async ({ dir, statePath }) => {
    const document = validDocument();
    await createUptimeStateStore(statePath).save(document);
    expect(uptimeStateDocumentSchema.parse(JSON.parse(await readFile(statePath, "utf8")))).toEqual(document);
    expect((await stat(statePath)).mode & 0o777).toBe(0o600);
    expect((await readdir(dir)).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  itWithStore("behält die alte vollständige Datei bei einem Schreibfehler", async ({ statePath }) => {
    const old = JSON.stringify(validDocument());
    await writeFile(statePath, old);
    const store = createUptimeStateStore(statePath, {
      writeFile: async () => { throw new Error("simulierter Schreibfehler"); },
    });
    await expect(store.save({ version: 1, profiles: [] })).rejects.toBeInstanceOf(UptimeStoreError);
    expect(await readFile(statePath, "utf8")).toBe(old);
  });

  itWithStore("entfernt die temporäre Datei bei einem Rename-Fehler", async ({ dir, statePath }) => {
    const store = createUptimeStateStore(statePath, {
      rename: async () => { throw new Error("simulierter Rename-Fehler"); },
    });
    await expect(store.save(validDocument())).rejects.toBeInstanceOf(UptimeStoreError);
    expect((await readdir(dir)).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  itWithStore("weist ein serialisiertes Dokument über 2 MiB vor jeder Änderung ab", async ({ statePath }) => {
    const old = JSON.stringify(validDocument());
    await writeFile(statePath, old);
    const targets = Array.from({ length: 32 }, (_, index) => targetState(
      `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`,
      "x".repeat(4096),
    ));
    const profiles = Array.from({ length: 16 }, (_, index) => ({
      id: index === 0 ? "default" : `123e4567-e89b-42d3-a456-${String(index + 100).padStart(12, "0")}`,
      updatedAt: "2026-09-22T10:03:00.000Z",
      targets,
    }));
    const oversized = uptimeStateDocumentSchema.parse({ version: 1, profiles });

    await expect(createUptimeStateStore(statePath).save(oversized)).rejects.toBeInstanceOf(UptimeStoreError);
    expect(await readFile(statePath, "utf8")).toBe(old);
  });
});
