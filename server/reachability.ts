import net from "node:net";

export type ReachTarget = { label: string; host: string; port: number };
export type ReachResult = { label: string; ok: boolean };
export type ReachProbe = (target: ReachTarget) => Promise<boolean>;

function probeTarget(target: ReachTarget): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: target.host, port: target.port });
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export function checkReachability(
  targets: ReachTarget[],
  probe: ReachProbe = probeTarget,
): Promise<ReachResult[]> {
  return Promise.all(targets.map(async (target) => ({
    label: target.label,
    ok: await probe(target),
  })));
}
