// @vitest-environment node
import net from "node:net";
import { describe, expect, it } from "vitest";
import { checkReachability } from "./reachability.ts";

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Serveradresse fehlt"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

describe("checkReachability", () => {
  it("prüft mehrere Ziele parallel und unterscheidet offen von geschlossen", async () => {
    const openServer = net.createServer();
    const closedServer = net.createServer();
    const openPort = await listen(openServer);
    const closedPort = await listen(closedServer);
    await close(closedServer);

    try {
      await expect(checkReachability([
        { label: "offen", host: "127.0.0.1", port: openPort },
        { label: "geschlossen", host: "127.0.0.1", port: closedPort },
      ])).resolves.toEqual([
        { label: "offen", ok: true },
        { label: "geschlossen", ok: false },
      ]);
    } finally {
      await close(openServer);
    }
  });

  it("liefert für eine leere Zielmenge sofort ein leeres Ergebnis", async () => {
    await expect(checkReachability([])).resolves.toEqual([]);
  });
});
