# Uptime Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-driven `UPTIME` pane that checks configured HTTP(S) and TCP targets every 60 seconds and displays current state plus an exact measured 24-hour availability history.

**Architecture:** A standalone server monitor reads every profile, probes at most eight targets concurrently, records one compact sample per minute, and atomically persists all profile histories in `uptime.json`. A read-only profile-scoped API exposes validated snapshots; the browser merges those snapshots with the active profile config and renders a full-width pane without ever contacting monitored targets directly.

**Tech Stack:** TypeScript 6 strict, Node.js 22, Hono, React 19, TanStack React Query, Zod, Undici, Vitest, Testing Library, Node filesystem and TCP APIs.

**Spec:** `docs/superpowers/specs/2026-09-22-uptime-widget-design.md`

## Global Constraints

- Do not read or print `.env`, `config.json`, or `pve-ca.pem`; variable names come from `.env.example`.
- Add no dependencies. Use only packages already present in `package.json` and Node.js 22 APIs.
- Keep TypeScript strict with `noUncheckedIndexedAccess`; use no `any` and no unsafe assertion to suppress an error.
- Keep pane titles and status abbreviations English and uppercase in presentation (`UPTIME`, `up`); all user-facing messages remain German.
- Use no emoji or icon library. States use `●`, `!`, `○`, `?`, `━`, and `·`.
- Use only existing CSS variables; add no literal component colors or Tailwind opacity modifiers.
- Browser network traffic remains same-origin under `/api/...`; the browser must never probe a monitored target directly.
- `/api/proxy` must continue to block private addresses. Uptime's deliberate private-target access must not alter proxy code or policy.
- Probe interval is 60 seconds, timeout is 5 seconds, HTTP success is final status `200–399`, redirect limit is five, and global probe concurrency is eight.
- The first consecutive failure is `degraded`; the second is `down`; one success restores `up` immediately. Every failed sample counts against availability.
- Keep exactly 1,440 rolling minute slots per target. Unknown slots are excluded from the availability denominator.
- Persist at most 2 MiB atomically at `DASHBOARD_UPTIME`; LXC uses `/var/lib/dashboard/uptime.json`, VPS uses `/data/uptime.json`.
- Preserve all unrelated dirty-worktree changes. Stage and commit only files named by the active task.
- After every task run its targeted test, then `pnpm test`, `pnpm build`, and `git diff --check` before committing.
- Do not deploy. LXC or VPS deployment requires a separate explicit user request.

## Review Focus

- Redirects with a missing `Location`, a credentialed destination, a non-HTTP scheme, or a sixth hop must fail without reading a response body; Task 2 pins each case.
- Clock anomalies—two results in one minute, a multi-minute gap, a gap over 1,440 minutes, and a future persisted minute—must not duplicate or grow the ring; Task 3 pins each case.
- Renaming a target must preserve history while changing type, URL, host, or port must reset it; Tasks 3 and 5 pin both branches.
- A config read failure, a still-running prior cycle, or more than eight slow probes must not overlap work or corrupt the last snapshot; Task 5 pins all three conditions.
- A corrupt, oversized, or temporarily unwritable state file must preserve recoverability, keep in-memory monitoring alive, and surface `storageOk: false`; Tasks 4 and 5 pin these conditions.

## File Structure

- `src/config/schema.ts`: owns Uptime target configuration and validation; pane registration remains for Task 9 so earlier tasks continue to build.
- `src/config/defaults.ts`: defaults Uptime monitoring off with no targets.
- `src/lib/uptime.ts`: shared Zod contract for API errors, target results, hourly history, and the complete response.
- `server/uptime-probe.ts`: performs one HTTP(S) or TCP probe and classifies bounded errors.
- `server/uptime-state.ts`: pure target fingerprint, ring-buffer, state-transition, availability, and projection logic.
- `server/uptime-store.ts`: validates, recovers, size-limits, and atomically writes `uptime.json`.
- `server/uptime-monitor.ts`: schedules profile reads, runs bounded probes, prunes removed targets, saves state, and exposes read-only snapshots.
- `server/config-store.ts`: adds one internal all-profile config read for the monitor.
- `server/app.ts`: exposes `GET /api/uptime?profile=<id>` without accepting a target.
- `server/index.ts`: creates the shared ConfigStore and starts the monitor.
- `server/env.ts`: validates `DASHBOARD_UPTIME` as `uptimePath`.
- `src/widgets/Uptime.tsx`: validates/fetches snapshots and renders target rows.
- `src/shell/SettingsPane.tsx`: edits the profile's Uptime switch and targets.
- `src/App.tsx`: connects query, keyboard rows, pane visibility, full-width layout, errors, and statusline alarms.
- `src/lib/useKeymap.ts`, `src/shell/PaneGrid.tsx`, `src/index.css`: register and lay out the new full-width pane accessibly and responsively.
- `.env.example`, deployment scripts, `.gitignore`, `README.md`: preserve and document runtime state on both deployment paths.
- Tests next to each unit lock down validation, network behavior, history, storage, scheduling, API, UI, keyboard, and deployment behavior.

---

### Task 1: Uptime configuration and shared response contract

**Files:**
- Create: `src/lib/uptime.ts`
- Modify: `src/config/schema.ts:94-224`
- Modify: `src/config/defaults.ts:70-95`
- Modify: `src/config/config.test.ts:13-115`
- Create: `src/lib/uptime.test.ts`

**Interfaces:**
- Produces `uptimeTargetSchema`, `UptimeTarget`, and `Config["uptime"]` with `enabled` plus at most 32 discriminated HTTP/TCP targets.
- Produces `uptimeResponseSchema`, `UptimeResponse`, `UptimeTargetResult`, `UptimeError`, `UptimeStatus`, and `UptimeHistoryState`.
- Preserves existing config version 1 and profile-document version 2; missing `uptime` parses as disabled with no targets.

- [ ] **Step 1: Add failing config tests**

Add these cases to `src/config/config.test.ts` using stable UUIDs:

```ts
const HTTP_ID = "123e4567-e89b-42d3-a456-426614174010";
const TCP_ID = "123e4567-e89b-42d3-a456-426614174011";

it("ergänzt Uptime bei einer alten Config deterministisch", () => {
  const { uptime: _omit, ...legacy } = defaultConfig;
  expect(configSchema.parse(legacy).uptime).toEqual({ enabled: false, targets: [] });
});

it("akzeptiert HTTP- und TCP-Ziele mit frei wählbarem Port", () => {
  const parsed = configSchema.parse({
    ...defaultConfig,
    uptime: { enabled: true, targets: [
      { id: HTTP_ID, type: "http", label: "Immich", url: "https://photos.example/health" },
      { id: TCP_ID, type: "tcp", label: "Minecraft", host: "MC.Example", port: 25567 },
    ] },
  });
  expect(parsed.uptime.targets[1]).toMatchObject({ host: "mc.example", port: 25567 });
});
```

Also assert rejection of credentialed URLs, `ftp:`, invalid UUIDs, duplicate target IDs, blank/control-character labels, invalid hosts, ports `0` and `65536`, and 33 targets.

- [ ] **Step 2: Add failing shared-contract tests**

Create `src/lib/uptime.test.ts` and assert exactly 24 history entries, percentages only in `0..100`, non-negative integer milliseconds/minutes, valid ISO timestamps, and valid error/status combinations:

```ts
expect(uptimeResponseSchema.safeParse({
  updatedAt: "2026-09-22T12:00:00.000Z",
  storageOk: true,
  targets: [{
    id: HTTP_ID,
    status: "up",
    statusSince: "2026-09-22T11:00:00.000Z",
    checkedAt: "2026-09-22T12:00:00.000Z",
    responseTimeMs: 23,
    uptime24h: 99.93,
    measuredMinutes: 1440,
    history: Array.from({ length: 24 }, () => "ok"),
    error: null,
  }],
}).success).toBe(true);
```

- [ ] **Step 3: Run targeted tests and confirm failure**

Run:

```bash
pnpm vitest run src/config/config.test.ts src/lib/uptime.test.ts
```

Expected: FAIL because the Uptime config and response exports do not exist.

- [ ] **Step 4: Implement schemas and types**

In `src/config/schema.ts`, add the discriminated target schema before `baseConfigSchema`, default the entire Uptime object, and add duplicate-ID issues in `configSchema.superRefine`:

```ts
export const uptimeTargetSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().uuid(), type: z.literal("http"), label: text(MAX_TEXT_LENGTH), url: httpUrl }),
  z.object({ id: z.string().uuid(), type: z.literal("tcp"), label: text(MAX_TEXT_LENGTH), host: hostname, port }),
]);

// inside baseConfigSchema
uptime: z.object({
  enabled: z.boolean(),
  targets: z.array(uptimeTargetSchema).max(32),
}).default({ enabled: false, targets: [] }),

export type UptimeTarget = z.infer<typeof uptimeTargetSchema>;
```

In `src/lib/uptime.ts`, define strict bounds and export the inferred types:

```ts
export const uptimeStatusSchema = z.enum(["unknown", "up", "degraded", "down"]);
export const uptimeHistoryStateSchema = z.enum(["ok", "mixed", "down", "unknown"]);
export const uptimeErrorSchema = z.object({
  code: z.enum(["timeout", "dns", "refused", "tls", "redirect", "http", "network"]),
  httpStatus: z.number().int().min(100).max(599).optional(),
}).strict();
export const uptimeTargetResultSchema = z.object({
  id: z.string().uuid(),
  status: uptimeStatusSchema,
  statusSince: z.string().datetime({ offset: true }).nullable(),
  checkedAt: z.string().datetime({ offset: true }).nullable(),
  responseTimeMs: z.number().int().nonnegative().nullable(),
  uptime24h: z.number().finite().min(0).max(100).nullable(),
  measuredMinutes: z.number().int().min(0).max(1440),
  history: z.array(uptimeHistoryStateSchema).length(24),
  error: uptimeErrorSchema.nullable(),
}).strict().superRefine((result, ctx) => {
  if (result.status === "up" && (result.responseTimeMs === null || result.error !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Erreichbares Ziel braucht Antwortzeit ohne Fehler" });
  }
  if ((result.status === "degraded" || result.status === "down") &&
      (result.responseTimeMs !== null || result.error === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Fehlgeschlagenes Ziel braucht Fehler ohne Antwortzeit" });
  }
});
export const uptimeResponseSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }).nullable(),
  storageOk: z.boolean(),
  targets: z.array(uptimeTargetResultSchema).max(32),
}).strict();
```

Add `uptime: { enabled: false, targets: [] }` to `defaultConfig` without adding the pane yet.

- [ ] **Step 5: Run required verification**

Run:

```bash
pnpm vitest run src/config/config.test.ts src/lib/uptime.test.ts
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/config/schema.ts src/config/defaults.ts src/config/config.test.ts src/lib/uptime.ts src/lib/uptime.test.ts
git commit -m "feat: define uptime monitoring contracts"
```

### Task 2: Bounded HTTP and TCP probes

**Files:**
- Create: `server/uptime-probe.ts`
- Create: `server/uptime-probe.test.ts`

**Interfaces:**
- Consumes `UptimeTarget` and `UptimeError` from Task 1.
- Produces:

```ts
export type UptimeProbeResult =
  | { ok: true; responseTimeMs: number }
  | { ok: false; error: UptimeError };
export type UptimeProbe = (target: UptimeTarget) => Promise<UptimeProbeResult>;
export function probeHttp(target: Extract<UptimeTarget, { type: "http" }>, deps?: HttpProbeDependencies): Promise<UptimeProbeResult>;
export function probeTcp(target: Extract<UptimeTarget, { type: "tcp" }>, deps?: TcpProbeDependencies): Promise<UptimeProbeResult>;
export function probeTarget(target: UptimeTarget): Promise<UptimeProbeResult>;
```

- [ ] **Step 1: Add failing HTTP probe tests**

Use an injected `fetchImpl` and monotonic `now` to cover `200`, `399`, `400`, elapsed milliseconds, body cancellation, and redirects. Include these review-focus cases:

```ts
it.each([
  [new Response(null, { status: 302 }), "redirect"],
  [new Response(null, { status: 302, headers: { location: "ftp://example.com/file" } }), "redirect"],
  [new Response(null, { status: 302, headers: { location: "https://user:pass@example.com/" } }), "redirect"],
])("weist unsichere Weiterleitung ab", async (response, code) => {
  const fetchImpl = vi.fn(async () => response);
  await expect(probeHttp(httpTarget, { fetchImpl, now: () => 0 })).resolves.toMatchObject({
    ok: false, error: { code },
  });
});
```

Build a six-response chain from statuses `301`, `302`, `303`, `307`, or `308` and assert only six requests occur—initial plus five allowed hops—and the result is `redirect`. Assert another non-redirect response such as `304` or `399` succeeds without `Location`. Reject injected fetches with representative `ENOTFOUND`, `ECONNREFUSED`, certificate, abort, and unknown errors and assert the bounded error codes. Assert a redirect target with a private hostname is accepted here; `/api/proxy` security tests remain unchanged.

- [ ] **Step 2: Add failing TCP probe tests**

Start a local `node:net` server on port `0`, read its assigned port with an `AddressInfo` runtime check, and assert success plus immediate socket close. Inject a connector returning a test socket/EventEmitter for timeout, `ECONNREFUSED`, and `ENOTFOUND`:

```ts
const result = await probeTcp(
  { id: TCP_ID, type: "tcp", label: "Minecraft", host: "mc.example", port: 25567 },
  { connect: () => socket, now: () => 0, timeoutMs: 5_000 },
);
expect(result).toEqual({ ok: false, error: { code: "timeout" } });
expect(socket.destroyed).toBe(true);
```

- [ ] **Step 3: Run targeted tests and confirm failure**

Run: `pnpm vitest run server/uptime-probe.test.ts`

Expected: FAIL because the probe module does not exist.

- [ ] **Step 4: Implement one shared deadline and manual redirects**

Use `undici.fetch`, `AbortSignal.timeout(5_000)`, `redirect: "manual"`, and `performance.now()`. Reuse one deadline signal across the entire redirect chain. Resolve each `Location` against the current URL, reject credentials or non-HTTP(S), cancel every response body, and return only the final bounded result:

```ts
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
for (let redirects = 0; redirects <= 5; redirects += 1) {
  const response = await fetchImpl(current, { method: "GET", redirect: "manual", signal });
  await response.body?.cancel().catch(() => undefined);
  if (redirectStatuses.has(response.status)) {
    if (redirects === 5) return { ok: false, error: { code: "redirect" } };
    const location = response.headers.get("location");
    if (location === null) return { ok: false, error: { code: "redirect" } };
    const next = new URL(location, current);
    if (!isSafeMonitorUrl(next)) return { ok: false, error: { code: "redirect" } };
    current = next;
    continue;
  }
  return response.status >= 200 && response.status <= 399
    ? { ok: true, responseTimeMs: elapsedMs() }
    : { ok: false, error: { code: "http", httpStatus: response.status } };
}
```

Implement TCP with `net.createConnection`, `socket.setTimeout`, once-only settlement, and unconditional `socket.destroy()`.

- [ ] **Step 5: Run required verification**

Run:

```bash
pnpm vitest run server/uptime-probe.test.ts server/proxy.test.ts
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed, including unchanged private-address proxy tests.

- [ ] **Step 6: Commit Task 2**

```bash
git add server/uptime-probe.ts server/uptime-probe.test.ts
git commit -m "feat: probe uptime targets"
```

### Task 3: Pure 24-hour history and state transitions

**Files:**
- Create: `server/uptime-state.ts`
- Create: `server/uptime-state.test.ts`

**Interfaces:**
- Consumes `UptimeTarget`, `UptimeProbeResult`, and Task 1 response types.
- Produces `storedTargetStateSchema`, `uptimeStateDocumentSchema`, `UptimeStateDocument`, `emptyUptimeState`, `targetFingerprint`, `recordProbe`, `projectTarget`, and `projectProfile`.

- [ ] **Step 1: Add failing transition tests**

Pin the complete state machine at exact minute timestamps:

```ts
const first = recordProbe(undefined, target, { ok: true, responseTimeMs: 31 }, Date.parse("2026-09-22T10:00:00Z"));
const warning = recordProbe(first, target, { ok: false, error: { code: "timeout" } }, Date.parse("2026-09-22T10:01:00Z"));
const down = recordProbe(warning, target, { ok: false, error: { code: "timeout" } }, Date.parse("2026-09-22T10:02:00Z"));
const recovered = recordProbe(down, target, { ok: true, responseTimeMs: 27 }, Date.parse("2026-09-22T10:03:00Z"));

expect([first.status, warning.status, down.status, recovered.status])
  .toEqual(["up", "degraded", "down", "up"]);
expect([first.samples, warning.samples, down.samples, recovered.samples])
  .toEqual(["1", "10", "100", "1001"]);
expect(warning.responseTimeMs).toBeNull();
```

Also prove that a first-ever failure is `degraded`, the second is `down`, and one success resets `consecutiveFailures` to zero.

- [ ] **Step 2: Add failing ring and projection tests**

Cover same-minute replacement/no duplication, a three-minute gap inserting `??`, a gap longer than 1,440 minutes, a persisted future `sampleMinute`, trimming to 1,440, and unknown state after 150 seconds. Assert exact percentage and left-padded hourly history:

```ts
expect(projectTarget(target.id, state, Date.parse("2026-09-22T10:03:00Z"))).toMatchObject({
  uptime24h: 50,
  measuredMinutes: 4,
  history: [...Array.from({ length: 23 }, () => "unknown"), "mixed"],
});
```

Test all-success hour as `ok`, all-failed hour as `down`, mixed hour as `mixed`, and no measured samples as `uptime24h: null`. For stale state, assert `status: "unknown"` and `statusSince = checkedAt + 150 seconds`.

- [ ] **Step 3: Add failing fingerprint tests**

Assert label-only changes produce the same fingerprint, while HTTP URL, TCP host, TCP port, and target type changes each produce a different fingerprint. Assert host case and URL normalization do not create accidental resets.

- [ ] **Step 4: Run targeted tests and confirm failure**

Run: `pnpm vitest run server/uptime-state.test.ts`

Expected: FAIL because the state module does not exist.

- [ ] **Step 5: Implement the validated stored shape and ring update**

Use an array-shaped document so profile/target IDs are validated as values rather than unchecked object keys:

```ts
export const storedTargetStateSchema = z.object({
  id: z.string().uuid(),
  fingerprint: z.string().min(1).max(4096),
  sampleMinute: z.number().int().nonnegative(),
  samples: z.string().regex(/^[01?]{1,1440}$/),
  status: z.enum(["up", "degraded", "down"]),
  statusSince: z.string().datetime({ offset: true }),
  checkedAt: z.string().datetime({ offset: true }),
  responseTimeMs: z.number().int().nonnegative().nullable(),
  consecutiveFailures: z.number().int().min(0),
  error: uptimeErrorSchema.nullable(),
}).strict();

export const uptimeStateDocumentSchema = z.object({
  version: z.literal(1),
  profiles: z.array(z.object({
    id: profileIdSchema,
    updatedAt: z.string().datetime({ offset: true }).nullable(),
    targets: z.array(storedTargetStateSchema).max(32),
  }).strict()).max(16),
}).strict();
```

In `recordProbe`, reset on fingerprint mismatch. If the stored minute is in the future, reset the ring to the current result rather than preserving impossible ordering. For a same-minute result, replace the last slot without growing the ring. For a positive gap, append at most 1,439 `?` characters before the current `1` or `0`, then slice `samples.slice(-1440)`; never allocate a string proportional to an unbounded clock jump.

- [ ] **Step 6: Implement projection**

Left-pad samples to 1,440 with `?`, divide into 24 chunks of 60, derive the four history states, and calculate:

```ts
const successes = [...samples].filter((sample) => sample === "1").length;
const failures = [...samples].filter((sample) => sample === "0").length;
const measuredMinutes = successes + failures;
const uptime24h = measuredMinutes === 0 ? null : (successes / measuredMinutes) * 100;
```

Round only API-facing `uptime24h` to two decimals. Keep `responseTimeMs` non-null only when the latest probe succeeded.

- [ ] **Step 7: Run required verification**

Run:

```bash
pnpm vitest run server/uptime-state.test.ts
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 8: Commit Task 3**

```bash
git add server/uptime-state.ts server/uptime-state.test.ts
git commit -m "feat: calculate uptime history"
```

### Task 4: Recoverable atomic Uptime state store

**Files:**
- Create: `server/uptime-store.ts`
- Create: `server/uptime-store.test.ts`

**Interfaces:**
- Consumes `uptimeStateDocumentSchema`, `UptimeStateDocument`, and `emptyUptimeState`.
- Produces:

```ts
export const MAX_UPTIME_STATE_BYTES = 2 * 1024 * 1024;
export type UptimeStateStore = {
  load: () => Promise<UptimeStateDocument>;
  save: (document: UptimeStateDocument) => Promise<void>;
};
export function createUptimeStateStore(path: string): UptimeStateStore;
```

- [ ] **Step 1: Add failing load and recovery tests**

Use `mkdtemp`, `readFile`, `writeFile`, and `stat` under the OS temp directory. Assert missing file returns a fresh empty document without creating a file. Assert valid JSON loads. For malformed, schema-invalid, and larger-than-2-MiB inputs, assert an identical `.bak` copy exists and load returns a fresh empty document.

Add a file containing duplicate profile IDs or duplicate target IDs and require schema-level rejection; add these duplicate checks to the Task 3 document schema if the test exposes the gap.

- [ ] **Step 2: Add failing save tests**

Assert saved JSON parses through `uptimeStateDocumentSchema`, final mode is `0600`, no `*.tmp-*` file remains, and the old complete file survives an injected pre-rename write failure. Assert saving serialized content above 2 MiB rejects before changing the active file.

- [ ] **Step 3: Run targeted tests and confirm failure**

Run: `pnpm vitest run server/uptime-store.test.ts server/uptime-state.test.ts`

Expected: FAIL because the store module does not exist.

- [ ] **Step 4: Implement bounded read, backup, and atomic save**

Read `stat` before `readFile`, recheck byte length after reading, parse as `unknown`, and validate. Use a unique temporary name and clean it on every failed path:

```ts
const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
let renamed = false;
try {
  await writeFile(tempPath, serialized, { mode: 0o600 });
  await rename(tempPath, path);
  renamed = true;
} finally {
  if (!renamed) await unlink(tempPath).catch(() => undefined);
}
```

For an existing unreadable/oversized/invalid active file, `copyFile(path, `${path}.bak`)` before returning a new cloned empty document. Throw a typed `UptimeStoreError` when backup itself or a save fails; never include file contents in messages.

- [ ] **Step 5: Run required verification**

Run:

```bash
pnpm vitest run server/uptime-store.test.ts server/uptime-state.test.ts
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 6: Commit Task 4**

```bash
git add server/uptime-store.ts server/uptime-store.test.ts server/uptime-state.ts server/uptime-state.test.ts
git commit -m "feat: persist uptime history"
```

### Task 5: Profile-aware scheduler and snapshots

**Files:**
- Create: `server/uptime-monitor.ts`
- Create: `server/uptime-monitor.test.ts`
- Modify: `server/config-store.ts:133-180,258-310,430-end`
- Modify: `server/config-store.test.ts:280-330`

**Interfaces:**
- Extends `ConfigStore` with `readAllProfileConfigs(): Promise<Array<{ profileId: ProfileId; config: Config }>>`.
- Consumes `UptimeStateStore`, `UptimeProbe`, Task 3 state functions, and all profile configs.
- Produces:

```ts
export type UptimeReader = { getSnapshot: (profileId: ProfileId) => UptimeResponse };
export type UptimeMonitor = UptimeReader & {
  initialize: () => Promise<void>;
  runOnce: () => Promise<void>;
  start: () => void;
  stop: () => void;
};
export function createUptimeMonitor(options: UptimeMonitorOptions): UptimeMonitor;
```

- [ ] **Step 1: Add failing ConfigStore snapshot tests**

In `server/config-store.test.ts`, create two profiles and assert one `readAllProfileConfigs()` call returns cloned configs for both IDs, including migrated defaults. Mutate the returned object and assert a second read is unchanged.

- [ ] **Step 2: Add failing monitor lifecycle tests**

Use fake config/store/probe dependencies and an injected `now`, `setIntervalFn`, and `clearIntervalFn`. Assert `initialize()` loads once, `start()` schedules `60_000`, triggers an immediate background run, and `stop()` clears exactly its timer.

Assert disabled profiles are not probed but retain stored history. Assert deleted profiles/targets are pruned, label-only changes preserve state, and endpoint changes reset through the Task 3 fingerprint.

- [ ] **Step 3: Add failing concurrency and overlap tests**

Create nine deferred probes, track `active` and `maximumActive`, and resolve them in order:

```ts
expect(maximumActive).toBe(8);
expect(probe).toHaveBeenCalledTimes(8);
resolveNextProbe();
await Promise.resolve();
expect(probe).toHaveBeenCalledTimes(9);
```

Call `runOnce()` again while one deferred probe is pending and assert no second config read or duplicated probe occurs. Reject a config read and assert the prior snapshot remains unchanged. Reject save after completed probes and assert the new in-memory snapshot is returned with `storageOk: false`; make the following save succeed and assert it returns to true.

- [ ] **Step 4: Add failing snapshot tests**

Assert each profile gets its own `updatedAt`, target order follows the last read config, stale projection is derived using the injected current time, and a target absent from stored history receives the Task 3 empty result. The reader must always return a valid `uptimeResponseSchema` object, including before the first cycle.

- [ ] **Step 5: Run targeted tests and confirm failure**

Run:

```bash
pnpm vitest run server/config-store.test.ts server/uptime-monitor.test.ts
```

Expected: FAIL because the all-profile read and monitor do not exist.

- [ ] **Step 6: Implement one validated all-profile read**

Add this internal method without exposing the profile document itself:

```ts
async function readAllProfileConfigs(): Promise<Array<{ profileId: ProfileId; config: Config }>> {
  const document = await readDocumentUnlocked();
  return document.profiles.map(({ id, config }) => ({ profileId: id, config: clone(config) }));
}
```

Return it from `createConfigStore` and add it to the `ConfigStore` type.

- [ ] **Step 7: Implement monitor sequencing and bounded workers**

Keep a store-local `running` promise/flag. Flatten enabled targets as `{ profileId, target }`, then process them through eight async workers sharing an incrementing index; never use an unbounded `Promise.all` over every target. After all probes settle, set each enabled profile's `updatedAt`, prune only deleted profiles/targets, update in-memory state first, then attempt one atomic save.

Use this failure boundary:

```ts
try {
  const profiles = await configStore.readAllProfileConfigs();
  const next = await runTargets(profiles, state);
  state = next;
  try {
    await stateStore.save(next);
    storageOk = true;
  } catch {
    storageOk = false;
  }
} catch {
  // Config unavailable: keep the last state and timestamps so they become stale naturally.
}
```

`getSnapshot` must call pure Task 3 projection with `now()` and validate the final object through `uptimeResponseSchema.parse`.

- [ ] **Step 8: Run required verification**

Run:

```bash
pnpm vitest run server/config-store.test.ts server/uptime-monitor.test.ts
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 9: Commit Task 5**

```bash
git add server/config-store.ts server/config-store.test.ts server/uptime-monitor.ts server/uptime-monitor.test.ts
git commit -m "feat: schedule uptime monitoring"
```

### Task 6: Runtime environment, server wiring, and read-only API

**Files:**
- Modify: `server/env.ts:10-22,64-112,122-134`
- Modify: `server/env.test.ts:4-28`
- Modify: `server/app.ts:13-20,64-69,126-132,309-333`
- Modify: `server/index.ts:1-17`
- Modify: `server/index.test.ts:1-70,500-545`
- Modify: `server/pve-fetch.test.ts:18-27`

**Interfaces:**
- Extends `DashboardEnvironment` with `uptimePath: string` sourced from `DASHBOARD_UPTIME`, defaulting to `uptime.json` beside `DASHBOARD_CONFIG` for backward-compatible existing deployments.
- Extends `AppOptions` with `uptimeReader?: UptimeReader`.
- Produces `GET /api/uptime?profile=<id>` using existing required-profile validation.

- [ ] **Step 1: Add failing environment tests**

Add `DASHBOARD_UPTIME: "/tmp/dashboard/uptime.json"` to the synthetic base and expected parsed object. Also assert that omitting it while `DASHBOARD_CONFIG=/tmp/dashboard/config.json` yields `/tmp/dashboard/uptime.json`, and an empty or NUL-containing value throws mentioning only `DASHBOARD_UPTIME`. This sibling fallback ensures an already-provisioned VPS with `/data/config.json` writes to `/data/uptime.json` before its environment file is refreshed. Add `uptimePath` to the typed PVE test environment.

- [ ] **Step 2: Add failing API tests**

Extend the `itWithApp` harness to inject a fake `UptimeReader`. Test missing/malformed profile `400`, unknown profile `404`, disabled monitoring `404` with `{ error: "Uptime deaktiviert" }`, and enabled profiles returning the fake snapshot exactly.

Prove the endpoint ignores `url`, `host`, and `port` query parameters and never calls a probe. Prove a ConfigStore failure returns `503` without exposing a path or exception text.

- [ ] **Step 3: Run targeted tests and confirm failure**

Run:

```bash
pnpm vitest run server/env.test.ts server/index.test.ts
```

Expected: FAIL because `uptimePath`, the reader option, and route do not exist.

- [ ] **Step 4: Implement environment and route**

Import `dirname` and `join` from `node:path`, derive the sibling default before parsing, then validate `DASHBOARD_UPTIME` through `pathValue`:

```ts
const configPathInput = record.DASHBOARD_CONFIG ?? "./config.json";
const uptimePathInput = record.DASHBOARD_UPTIME ?? join(dirname(configPathInput), "uptime.json");
const parsed = baseEnvironmentSchema.safeParse({
  PORT: record.PORT ?? "7777",
  DASHBOARD_CONFIG: configPathInput,
  DASHBOARD_UPTIME: uptimePathInput,
  DASHBOARD_STATIC: record.DASHBOARD_STATIC ?? "./static",
  DASHBOARD_WRITE_ALLOW: record.DASHBOARD_WRITE_ALLOW ?? "127.0.0.1",
  DASHBOARD_WRITE_HOSTS: record.DASHBOARD_WRITE_HOSTS ?? "start.home.arpa,10.0.10.20,localhost,127.0.0.1",
});
```

Then implement the route immediately after Homelab, reusing `requiredProfile` and `readProfileConfig`:

```ts
app.get("/api/uptime", async (c) => {
  const profile = requiredProfile(c.req.raw);
  if (profile.kind !== "ok") return profileParameterError(c, profile);
  try {
    const result = await store.readProfileConfig(profile.profileId);
    if (result.kind === "not-found") return c.json({ error: "Profil nicht gefunden" }, 404);
    if (!result.config.uptime.enabled) return c.json({ error: "Uptime deaktiviert" }, 404);
    return c.json(uptimeReader.getSnapshot(profile.profileId));
  } catch (error) {
    if (error instanceof ConfigStoreError) return c.json({ error: "Config nicht verfügbar" }, 503);
    return c.json({ error: "Uptime nicht verfügbar" }, 502);
  }
});
```

The route must not inspect any target query parameter.

Because `AppOptions.uptimeReader` remains optional for isolated existing tests, create a local fallback reader that returns `{ updatedAt: null, storageOk: true, targets: [] }`. Production always injects the real monitor. Add a `/api/health` assertion showing that a `down` target or `storageOk: false` does not change health status.

- [ ] **Step 5: Wire one production monitor**

In `server/index.ts`, create the ConfigStore and monitor explicitly, pass the reader to the app, and initialize/start only in the executable main path. Await initialization before `serve` so persisted history is available to the first request:

```ts
const configStore = createConfigStore(env.configPath);
const uptimeMonitor = createUptimeMonitor({
  configStore,
  stateStore: createUptimeStateStore(env.uptimePath),
  probe: probeTarget,
});
const app = createApp({ env, distRoot, configStore, uptimeReader: uptimeMonitor });

if (isMain) {
  await uptimeMonitor.initialize();
  uptimeMonitor.start();
  serve({ fetch: app.fetch, port: env.port }, (info) => {
    console.log(`dashboard-server auf Port ${info.port}`);
  });
}
```

Imports in tests must perform neither filesystem initialization nor timer/listener startup.

- [ ] **Step 6: Run required verification**

Run:

```bash
pnpm vitest run server/env.test.ts server/index.test.ts server/uptime-monitor.test.ts
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 7: Commit Task 6**

```bash
git add server/env.ts server/env.test.ts server/app.ts server/index.ts server/index.test.ts server/pve-fetch.test.ts
git commit -m "feat: expose uptime snapshots"
```

### Task 7: Uptime fetcher and accessible target table

**Files:**
- Create: `src/widgets/Uptime.tsx`
- Create: `src/widgets/Uptime.test.tsx`

**Interfaces:**
- Consumes `UptimeTarget`, `UptimeResponse`, `uptimeResponseSchema`, `ProfileId`, `profileApiUrl`, `safeHref`, and `shortAge`.
- Produces `decodeUptime`, `fetchUptime(profileId, signal?)`, and:

```ts
export function Uptime(props: {
  targets: UptimeTarget[];
  data?: UptimeResponse;
  selIndex: number;
  now: Date;
}): React.JSX.Element;
```

- [ ] **Step 1: Add failing fetch and decode tests**

Stub `fetch` and assert `/api/uptime?profile=<encoded-id>` plus AbortSignal, rejection on non-2xx, rejection on invalid JSON shape, and successful decoding of a complete response. Assert 23 or 25 history entries are rejected and no Date revival occurs.

- [ ] **Step 2: Add failing rendering tests**

Render one HTTP and one TCP target with results in config order. Assert German status copy, endpoint text, `31 ms`, `99,93 %`, 24 history marks, and `seit 3h`. Assert the HTTP row is an anchor with the safe configured URL while the TCP row has `data-row` but no anchor/href.

Cover every state and bounded error translation:

```ts
expect(screen.getByText("erreichbar")).toBeTruthy();
expect(screen.getByText("gestört")).toBeTruthy();
expect(screen.getByText("nicht erreichbar")).toBeTruthy();
expect(screen.getByText("unbekannt")).toBeTruthy();
expect(screen.getByText("Zeitüberschreitung")).toBeTruthy();
expect(screen.getByText("HTTP 503")).toBeTruthy();
```

Also test empty targets, absent data, a configured target missing from the result list, `storageOk: false`, `uptime24h: null`, and selection class at `selIndex`.

- [ ] **Step 3: Run targeted tests and confirm failure**

Run: `pnpm vitest run src/widgets/Uptime.test.tsx`

Expected: FAIL because the widget does not exist.

- [ ] **Step 4: Implement validated fetch and merge-by-ID rendering**

Implement `decodeUptime` as `uptimeResponseSchema.safeParse(value)`. Build a `Map` from `data.targets` but iterate `targets` from config so saved order and brand-new rows appear immediately. Use `Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })`.

Render history as one labelled container with 24 `aria-hidden` spans. Use `━` for `ok`, `!` for `mixed`, `○` for `down`, and `·` for `unknown`; include a German `aria-label` summarizing the 24-hour history so color and glyph density are not the only accessible signal.

- [ ] **Step 5: Run required verification**

Run:

```bash
pnpm vitest run src/widgets/Uptime.test.tsx
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/widgets/Uptime.tsx src/widgets/Uptime.test.tsx
git commit -m "feat: render uptime target status"
```

### Task 8: Uptime settings editor

**Files:**
- Modify: `src/shell/SettingsPane.tsx:55-90,1180-1315`
- Modify: `src/shell/SettingsPane.test.tsx`
- Modify: `src/config/describeIssue.ts:10-20`
- Modify: `src/config/describeIssue.test.ts`
- Modify: `src/index.css` in the settings-table rules near existing `.tbl--reach`

**Interfaces:**
- Consumes Task 1 `Config["uptime"]` and existing `RowActs`/`NumInput` patterns.
- Produces a `UPTIME` settings section; config save remains the existing whole-profile mutation.

- [ ] **Step 1: Add failing settings tests**

Render settings with deterministic existing target IDs. Click the new section and test:

- global enable checkbox updates `draft.uptime.enabled`;
- `+ HTTP` creates `{ type: "http", label: "neu", url: "https://example.com/" }` with a generated UUID;
- `+ TCP` creates `{ type: "tcp", label: "neu", host: "minecraft.example", port: 25565 }` with a generated UUID;
- editing TCP port to `25567`, HTTP URL, host, and labels reaches the saved Config;
- move and delete actions preserve stable IDs;
- both add buttons disable at 32 targets and the schema error maps back to the Uptime section.

Stub only `crypto.randomUUID` with canonical UUID strings; do not assert a production-generated value.

- [ ] **Step 2: Run targeted tests and confirm failure**

Run:

```bash
pnpm vitest run src/shell/SettingsPane.test.tsx src/config/describeIssue.test.ts
```

Expected: FAIL because no Uptime section exists.

- [ ] **Step 3: Add section routing and error labels**

Extend the constants exactly:

```ts
const SECTIONS = [
  ["profile", "PROFILE"], ["links", "Links"], ["feeds", "Feeds"],
  ["cal", "Kalender"], ["place", "Ort & Zeit"], ["layout", "Layout"],
  ["lab", "Homelab"], ["uptime", "Uptime"], ["search", "Suche"], ["proxy", "Proxy"],
] as const;

// SECTION_BY_ROOT
uptime: "uptime",
```

Add `uptime: "Uptime"` to `describeIssue`'s root labels.

- [ ] **Step 4: Implement target controls**

Use a checkbox labelled `Uptime-Monitoring aktiv`, a table whose columns adapt to target type, and existing `RowActs`. New target helpers must create the complete valid discriminated object:

```ts
const newHttpTarget = (): UptimeTarget => ({
  id: crypto.randomUUID(), type: "http", label: "neu", url: "https://example.com/",
});
const newTcpTarget = (): UptimeTarget => ({
  id: crypto.randomUUID(), type: "tcp", label: "neu", host: "minecraft.example", port: 25565,
});
```

Do not offer type conversion, custom timeout, status, body, header, auth, TLS, or pause fields. Use CSS grid classes based on the existing Settings tables; at narrow width allow fields to wrap rather than overflow.

- [ ] **Step 5: Run required verification**

Run:

```bash
pnpm vitest run src/shell/SettingsPane.test.tsx src/config/describeIssue.test.ts
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 6: Commit Task 8**

```bash
git add src/shell/SettingsPane.tsx src/shell/SettingsPane.test.tsx src/config/describeIssue.ts src/config/describeIssue.test.ts src/index.css
git commit -m "feat: configure uptime targets"
```

### Task 9: Pane, keyboard, query, layout, and statusline integration

**Files:**
- Modify: `src/config/schema.ts:3-7,108-133`
- Modify: `src/config/defaults.ts:70-80`
- Modify: `src/config/config.test.ts`
- Modify: `server/config-store.test.ts`
- Modify: `src/lib/useKeymap.ts:20-35`
- Modify: `src/lib/useKeymap.test.tsx:1-110,150-185`
- Modify: `src/api/config.ts:87-97`
- Modify: `src/api/config.test.tsx`
- Modify: `src/shell/PaneGrid.test.tsx`
- Modify: `src/shell/SettingsPane.tsx:1180-1235`
- Modify: `src/shell/SettingsPane.test.tsx`
- Modify: `src/App.tsx:220-330,455-525,545-710,750-790`
- Modify: `src/App.test.tsx`
- Modify: `src/index.css:111-162,296-380`

**Interfaces:**
- Appends `uptime` to `PANE_IDS` and `PANE_ORDER` without renumbering existing panes.
- Adds a full-width layout entry `{ id: "uptime", visible: true }` with no span.
- Uses `useCachedQuery("profile:<id>:up", fetchUptime, 60_000, ...)`.
- Adds `up` to config-save cancellation/invalidation and StatusLine sources.

- [ ] **Step 1: Add failing pane-schema and keymap tests**

Assert an old config without an Uptime layout entry gains the default entry in each profile through ConfigStore normalization. Assert a historical `span` on `uptime` is stripped like Homelab. Extend all exhaustive `Record<PaneId, number>` and visible sets with `uptime` and assert key `8` focuses it while existing key `7` still focuses Homelab.

- [ ] **Step 2: Add failing App integration tests**

Extend the base fetch stub with `/api/uptime`. Add tests proving:

- disabled monitoring makes zero Uptime requests, hides the pane, and shows `○ up` as unconfigured;
- enabled monitoring requests `/api/uptime?profile=default` and renders targets;
- hidden pane still polls and shows StatusLine alarms;
- profile switch uses the new profile ID and no old response crosses over;
- config save cancels/invalidates only the active profile's `up` query;
- `j`/`k` select TCP rows, Enter opens HTTP rows only;
- `storageOk: false` makes source `crit` without discarding visible results;
- a freshly fetched snapshot with `updatedAt: null` or older than 150 seconds remains `warn` rather than appearing fresh;
- one `degraded` target produces warning count, while any `down` target makes the aggregate critical.

- [ ] **Step 3: Add failing full-pane layout and responsive tests**

Update `PaneGrid.test.tsx` to pass both full panes and assert direct DOM order is Homelab then Uptime after grouped columns. In `App.test.tsx`, assert Uptime remains full width in grouped and legacy-span layouts. Add a DOM/class assertion that the mobile row uses the responsive two-line class and no fixed pixel/min-width style.

- [ ] **Step 4: Run targeted tests and confirm failure**

Run:

```bash
pnpm vitest run src/config/config.test.ts server/config-store.test.ts src/lib/useKeymap.test.tsx src/api/config.test.tsx src/shell/PaneGrid.test.tsx src/App.test.tsx
```

Expected: FAIL because the pane and App integration do not exist.

- [ ] **Step 5: Register the pane without changing existing numeric shortcuts**

Append `"uptime"` after `"homelab"` in `PANE_IDS`, add the full-width layout union member, append `{ id: "uptime", visible: true }` in defaults, and add `uptime: "up"` to `PANE_LABELS`. Update every exhaustive PaneId record.

Change ConfigStore's existing missing-pane normalizer only through the new default entry; do not add an Uptime-specific migration branch.

In the Settings layout table, treat both `homelab` and `uptime` as fixed full-width panes. Disable Uptime visibility only when `draft.uptime.enabled` is false, and add a test proving hidden-but-enabled monitoring remains possible.

- [ ] **Step 6: Integrate query, rows, visibility, and full panes**

In `App.tsx`, mirror Homelab's enable/visibility split:

```ts
const uptimeEnabled = profileDataReady && config.uptime.enabled;
const uptimeQuery = useCachedQuery(
  `profile:${profileId}:up`,
  (signal) => fetchUptime(profileId, signal),
  60_000,
  { decode: decodeUptime, refetchIntervalMs: 60_000, enabled: uptimeEnabled },
);
```

Add rows in config order with `{ url: target.type === "http" ? target.url : undefined }`. Render `Uptime` as `span="full"` after Homelab. Pass both full nodes to `PaneGrid` as one keyed array/fragment so they remain direct grid children in the agreed order.

Extend `isProfileDataSourceKey` in `src/api/config.ts` with `(config.uptime.enabled && sourceKey === "up")` so a save cannot leave an old snapshot attached to a changed endpoint.

- [ ] **Step 7: Integrate statusline source and alarms**

Derive results only when enabled. Count `degraded` and `down`; use `crit` if any result is `down`, otherwise `warn`. The `up` source remains present even while monitoring is disabled. Derive server-round staleness separately from React Query staleness:

```ts
const uptimeRoundMs = Date.parse(uptimeQuery.data?.updatedAt ?? "");
const uptimeRoundStale = !Number.isFinite(uptimeRoundMs) || Date.now() - uptimeRoundMs > 150_000;
const uptimeSourceState: SourceState = !uptimeEnabled
  ? "unconfigured"
  : uptimeQuery.data?.storageOk === false
    ? "crit"
    : queryState(uptimeQuery, uptimeRoundStale);
```

Use the server round timestamp (`uptimeQuery.data?.updatedAt`) rather than the browser fetch time for the StatusLine age. Treat a null timestamp or a round older than 150 seconds as `warn`, even if React Query just fetched that old snapshot successfully. Include `up` in the first-error search only when enabled. Keep target failures as `alerts`, not as a data-source error. Do not duplicate target names in the general `problem` string.

- [ ] **Step 8: Add responsive, token-only styles**

Create `.uptime-*` rules with a desktop grid for mark/status, name/endpoint, latency, percentage, and 24-slot history. At `max-width: 700px`, make each row a two-line grid with history across the full second line. Use only `var(--color-fg)`, `--color-dim`, `--color-warn`, `--color-crit`, `--color-accent`, and `--color-bg-sel`; no new token or hex value.

- [ ] **Step 9: Run required verification**

Run:

```bash
pnpm vitest run src/config/config.test.ts server/config-store.test.ts src/lib/useKeymap.test.tsx src/api/config.test.tsx src/shell/PaneGrid.test.tsx src/App.test.tsx src/widgets/Uptime.test.tsx src/shell/StatusLine.test.tsx
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 10: Commit Task 9**

```bash
git add src/config/schema.ts src/config/defaults.ts src/config/config.test.ts server/config-store.test.ts src/lib/useKeymap.ts src/lib/useKeymap.test.tsx src/api/config.ts src/api/config.test.tsx src/shell/PaneGrid.test.tsx src/shell/SettingsPane.tsx src/shell/SettingsPane.test.tsx src/App.tsx src/App.test.tsx src/index.css
git commit -m "feat: integrate uptime dashboard pane"
```

### Task 10: Persistent deployment paths, documentation, and final verification

**Files:**
- Modify: `.env.example:14-24`
- Modify: `.gitignore:15-22`
- Modify: `deploy/deploy.sh:35-52`
- Modify: `deploy/provision.sh:42-58`
- Modify: `deploy/provision-vps.sh:17-25`
- Modify: `deploy/package-vps.sh:25-35`
- Modify: `deploy/package-vps.test.sh`
- Modify: `deploy/remote-vps-deploy.test.sh`
- Modify: `README.md:144-150,193-216`

**Interfaces:**
- Production LXC receives `DASHBOARD_UPTIME=/var/lib/dashboard/uptime.json`.
- VPS receives `DASHBOARD_UPTIME=/data/uptime.json` within the existing persistent bind mount.
- Runtime state and temp/backup variants remain excluded from Git and release inputs.

- [ ] **Step 1: Add failing deployment-harness assertions**

In `deploy/package-vps.test.sh`, assert the generated `.dockerignore` contains both `**/uptime.json` and `**/uptime.json.*`. In `deploy/remote-vps-deploy.test.sh`, create `state/uptime.json` beside the marker, run every success/rollback case, and assert its exact contents remain unchanged and the produced backup archive contains `./uptime.json`.

Add shell assertions that `deploy.sh` and `provision.sh` set the LXC path and `provision-vps.sh` seeds the VPS path. Keep these string checks in the existing deploy test scripts rather than introducing a new test runner.

- [ ] **Step 2: Run deployment tests and confirm failure**

Run: `pnpm run test:deploy`

Expected: FAIL because the Uptime path and ignores are absent.

- [ ] **Step 3: Add environment paths and exclusions**

Add to `.env.example`:

```dotenv
# Persistente 24-Stunden-Historie des Uptime-Monitors.
DASHBOARD_UPTIME=./uptime.json
```

Add `uptime.json`, `uptime.json.*`, and its temporary-name pattern to `.gitignore`. Set the production values with the existing `set_env` helpers. Add both Uptime patterns to the generated VPS `.dockerignore`; do not add the runtime file to package copy lists.

- [ ] **Step 4: Document operation and limitations**

Update README environment and persistent-state sections with:

- the two production paths;
- one-minute checks and 24-hour retention;
- history backup/restore alongside `config.json`;
- the fact that LXC and VPS histories are independent;
- the fact that Dashboard downtime creates unknown gaps and the service cannot monitor itself reliably;
- no public access, notifications, credentials, or TLS bypass;
- Minecraft is TCP reachability only and its port is configurable.

- [ ] **Step 5: Run local HTTP/TCP smoke coverage**

Run the tests that start real loopback HTTP and TCP listeners and pass them through probe, state, monitor, and API projection:

```bash
pnpm vitest run server/uptime-probe.test.ts server/uptime-state.test.ts server/uptime-monitor.test.ts server/index.test.ts
```

Expected: PASS with one HTTP and one TCP success using ephemeral local ports; no external network or `.env` access occurs.

- [ ] **Step 6: Run complete verification**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: all unit, frontend, server, deploy, TypeScript, and Vite checks succeed.

- [ ] **Step 7: Inspect final scope and secrets**

Run:

```bash
git status --short
git diff --stat 4c3e32a..HEAD
git diff --check 4c3e32a..HEAD
rg -n "PVE_TOKEN_SECRET|password|authorization" src server --glob '!*.test.*'
```

Expected: only planned source/docs/deploy files are part of the feature commits; no secret value, authenticated monitor option, new dependency, literal component color, or runtime `uptime.json` is committed. Existing legitimate PVE secret handling remains only in the established environment/PVE code.

- [ ] **Step 8: Commit Task 10**

```bash
git add .env.example .gitignore deploy/deploy.sh deploy/provision.sh deploy/provision-vps.sh deploy/package-vps.sh deploy/package-vps.test.sh deploy/remote-vps-deploy.test.sh README.md
git commit -m "docs: operate uptime monitoring state"
```

- [ ] **Step 9: Request final code review before integration**

Use `superpowers:requesting-code-review` to review the complete branch against
`docs/superpowers/specs/2026-09-22-uptime-widget-design.md`, with special attention to the
five Review Focus items, the unchanged `/api/proxy` policy, profile isolation, and all
unrelated pre-existing working-tree changes.
