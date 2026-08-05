import net from "node:net";

export type ReachTarget = { label: string; host: string; port: number };
export type ReachResult = { label: string; ok: boolean };

export function checkReachability(targets: ReachTarget[]): Promise<ReachResult[]> {
  return Promise.all(targets.map((t) => new Promise<ReachResult>((resolve) => {
    const socket = net.createConnection({ host: t.host, port: t.port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve({ label: t.label, ok });
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  })));
}
