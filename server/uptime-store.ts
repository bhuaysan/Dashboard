import { randomUUID } from "node:crypto";
import { copyFile, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import {
  emptyUptimeState,
  uptimeStateDocumentSchema,
  type UptimeStateDocument,
} from "./uptime-state";

export const MAX_UPTIME_STATE_BYTES = 2 * 1024 * 1024;

export class UptimeStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UptimeStoreError";
  }
}

export type UptimeStateStore = {
  load: () => Promise<UptimeStateDocument>;
  save: (document: UptimeStateDocument) => Promise<void>;
};

type UptimeStoreDependencies = {
  copyFile?: typeof copyFile;
  readFile?: typeof readFile;
  rename?: typeof rename;
  stat?: typeof stat;
  unlink?: typeof unlink;
  writeFile?: typeof writeFile;
};

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function freshState(): UptimeStateDocument {
  return structuredClone(emptyUptimeState);
}

export function createUptimeStateStore(
  path: string,
  dependencies: UptimeStoreDependencies = {},
): UptimeStateStore {
  const copyFileImpl = dependencies.copyFile ?? copyFile;
  const readFileImpl = dependencies.readFile ?? readFile;
  const renameImpl = dependencies.rename ?? rename;
  const statImpl = dependencies.stat ?? stat;
  const unlinkImpl = dependencies.unlink ?? unlink;
  const writeFileImpl = dependencies.writeFile ?? writeFile;

  async function recover(): Promise<UptimeStateDocument> {
    try {
      await copyFileImpl(path, `${path}.bak`);
      return freshState();
    } catch (error) {
      throw new UptimeStoreError("Beschädigte Uptime-Historie konnte nicht gesichert werden", { cause: error });
    }
  }

  async function load(): Promise<UptimeStateDocument> {
    let size: number;
    try {
      size = (await statImpl(path)).size;
    } catch (error) {
      if (isMissing(error)) return freshState();
      return recover();
    }
    if (size > MAX_UPTIME_STATE_BYTES) return recover();

    let source: string;
    try {
      source = await readFileImpl(path, "utf8");
    } catch {
      return recover();
    }
    if (Buffer.byteLength(source, "utf8") > MAX_UPTIME_STATE_BYTES) return recover();

    try {
      const parsed: unknown = JSON.parse(source);
      const result = uptimeStateDocumentSchema.safeParse(parsed);
      return result.success ? result.data : recover();
    } catch {
      return recover();
    }
  }

  async function save(document: UptimeStateDocument): Promise<void> {
    let serialized: string;
    try {
      serialized = JSON.stringify(uptimeStateDocumentSchema.parse(document));
    } catch (error) {
      throw new UptimeStoreError("Uptime-Historie ist ungültig", { cause: error });
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_UPTIME_STATE_BYTES) {
      throw new UptimeStoreError("Uptime-Historie ist zu groß");
    }

    const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
    let renamed = false;
    try {
      await writeFileImpl(tempPath, serialized, { mode: 0o600 });
      await renameImpl(tempPath, path);
      renamed = true;
    } catch (error) {
      throw new UptimeStoreError("Uptime-Historie konnte nicht geschrieben werden", { cause: error });
    } finally {
      if (!renamed) await unlinkImpl(tempPath).catch(() => undefined);
    }
  }

  return { load, save };
}
