# Device-Local Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add centrally stored, complete dashboard profiles while keeping the active profile selection local to each browser device.

**Architecture:** Wrap the existing version-1 `Config` objects in one version-2 profile document stored atomically in the existing `config.json`. Add profile-catalog mutations with their own revision while preserving per-config revisions, require a profile ID on every profile-dependent API request, and isolate React Query plus localStorage caches by profile ID.

**Tech Stack:** TypeScript strict, React 19, TanStack React Query, Hono, Zod, Vitest, Testing Library, Node.js 22 filesystem APIs.

**Spec:** `docs/superpowers/specs/2026-09-15-device-local-profiles-design.md`

## Global Constraints

- Do not read or print `.env`, `config.json`, or `pve-ca.pem`.
- Add no dependencies and use no `any` or unsafe type assertions to suppress errors.
- Keep all secrets in `process.env`; profile APIs must never return them.
- Browser requests to foreign domains remain forbidden; every remote request goes through `/api/...`.
- Private targets remain blocked by `/api/proxy` for every profile.
- User-visible messages are German; pane titles and status abbreviations remain English.
- Use no emoji or icon library; state remains represented by text glyphs.
- Use only existing CSS variables and retain WCAG AA contrast.
- Preserve unrelated user files and changes, including `.pnpm-store/` and `CODEBASE_REVIEW_2026-09-08.md`.
- After each task run `pnpm test`, `pnpm build`, and `git diff --check` before committing.
- Do not deploy; deployment requires a separate explicit user instruction.

## File Structure

- `src/config/schema.ts`: owns `ProfileId`, profile metadata, and the version-2 document schema while retaining the existing `Config` schema.
- `src/config/defaults.ts`: exports the deterministic one-profile default document.
- `server/config-store.ts`: recognizes legacy and version-2 files, normalizes every contained config, and serializes config/catalog mutations.
- `server/app.ts`: exposes the profile catalog and resolves an explicit profile for config, proxy, and homelab routes.
- `server/homelab-cache.ts`: isolates server-side cached PVE results by profile ID and config revision.
- `src/config/local.ts`: stores the local catalog, local active profile ID, and per-profile config snapshots.
- `src/api/profiles.ts`: owns profile catalog queries and create/rename/delete mutations.
- `src/api/config.ts`: loads and saves one explicit profile.
- `src/api/profileUrl.ts`: builds same-origin API URLs with one validated, encoded profile ID.
- `src/widgets/Weather.tsx`, `src/widgets/News.tsx`, `src/widgets/Agenda.tsx`, `src/widgets/Homelab.tsx`: accept a profile ID in their fetch functions.
- `src/App.tsx`: selects the local active profile, keys every data source by it, coordinates switching, and passes profile operations to UI components.
- `src/shell/SettingsPane.tsx`: adds the `PROFILE` section and protects unsaved drafts.
- `src/shell/StatusLine.tsx`: displays the active profile accessibly.
- `src/shell/KeymapOverlay.tsx`: documents profile commands.
- `src/config/io.ts`: includes a safe profile name in active-profile exports.
- Tests beside each source file lock down migration, isolation, conflicts, UI behavior, and security.

---

### Task 1: Profile document schema and deterministic defaults

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/config.test.ts`

**Interfaces:**
- Produces: `profileIdSchema`, `ProfileId`, `profileMetaSchema`, `ProfileMeta`, `profileDocumentSchema`, `ProfileDocument`, `DEFAULT_PROFILE_ID`, and `defaultProfileDocument`.
- Preserves: `configSchema`, `Config`, `defaultConfig`, `PANE_IDS`, and all existing validation behavior.

- [ ] **Step 1: Add failing schema tests**

Add tests proving:

```ts
const document = {
  version: 2,
  profilesUpdatedAt: "2026-09-15T00:00:00.000Z",
  profiles: [
    { id: "default", name: "Standard", config: defaultConfig },
    { id: "123e4567-e89b-42d3-a456-426614174000", name: "Arbeit", config: defaultConfig },
  ],
};
expect(profileDocumentSchema.parse(document).profiles).toHaveLength(2);
```

Also assert rejection of zero profiles, 17 profiles, duplicate IDs, `Privat` plus `privat`, names containing control characters, whitespace-only names, IDs outside `default` or a canonical lowercase UUID, and a document whose contained Config is invalid.

- [ ] **Step 2: Run the targeted tests and confirm failure**

Run: `pnpm vitest run src/config/config.test.ts`

Expected: FAIL because the profile exports do not exist.

- [ ] **Step 3: Add the schema and defaults**

Implement these public shapes without changing `Config`:

```ts
export const DEFAULT_PROFILE_ID = "default" as const;
export const profileIdSchema = z.string().refine(
  (value) => value === DEFAULT_PROFILE_ID || /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value),
  "Ungültige Profil-ID",
);
export type ProfileId = z.infer<typeof profileIdSchema>;

export const profileMetaSchema = z.object({
  id: profileIdSchema,
  name: text(64),
});

export const profileDocumentSchema = z.object({
  version: z.literal(2),
  profilesUpdatedAt: isoDateTime,
  profiles: z.array(profileMetaSchema.extend({ config: configSchema })).min(1).max(16),
}).superRefine(/* add duplicate ID and locale-independent lowercase-name issues */);
```

Use `name.toLocaleLowerCase("de-DE")` consistently for uniqueness. Export `defaultProfileDocument` from `defaults.ts` with `DEFAULT_PROFILE_ID`, name `Standard`, and `defaultConfig`.

- [ ] **Step 4: Run all required verification**

Run:

```bash
pnpm vitest run src/config/config.test.ts
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/config/schema.ts src/config/defaults.ts src/config/config.test.ts
git commit -m "feat: define dashboard profile documents"
```

### Task 2: Profile-aware atomic config store and legacy migration

**Files:**
- Modify: `server/config-store.ts`
- Modify: `server/config-store.test.ts`

**Interfaces:**
- Consumes: `ProfileDocument`, `ProfileId`, `profileDocumentSchema`, `configSchema`, `defaultProfileDocument`.
- Produces:

```ts
type ProfileCatalog = { profilesUpdatedAt: string; profiles: ProfileMeta[] };
type ConfigReadResult = { kind: "ok"; config: Config } | { kind: "not-found" };
type CatalogMutationResult =
  | { kind: "ok"; catalog: ProfileCatalog; createdId?: ProfileId }
  | { kind: "conflict"; current: string }
  | { kind: "not-found" }
  | { kind: "invalid"; issues: ZodIssue[] }
  | { kind: "last-profile" };
```

Extend `ConfigStore` with `readCatalog`, `readProfileConfig`, `createProfile`, `renameProfile`, and `deleteProfile`. Change `updateConfig` to accept `profileId` before `ifMatch`.

- [ ] **Step 1: Add failing migration and normalization tests**

Cover a legacy `Config` read as catalog `[{ id: "default", name: "Standard" }]`, repeated reads returning the same ID without rewriting the file, first successful config update persisting version 2, version-2 reads, per-profile unknown-pane removal/default-pane insertion, broken JSON backup/default recovery, and complete-document backup rotation.

- [ ] **Step 2: Add failing mutation and concurrency tests**

Cover creation as a full copy, UUID generation, case-insensitive duplicate-name rejection, rename with stable ID, deletion, refusal to delete the final profile, 16-profile limit, unknown source/target, stale catalog `If-Match`, stale config `If-Match`, and this sequence:

```ts
const privateWrite = await store.updateConfig(privateId, privateConfig.updatedAt, changedPrivate);
const workWrite = await store.updateConfig(workId, workConfig.updatedAt, changedWork);
expect(privateWrite.kind).toBe("ok");
expect(workWrite.kind).toBe("ok");
```

Also prove that a duplication exceeding `MAX_CONFIG_BYTES` returns `ConfigTooLargeError` before backup rotation.

- [ ] **Step 3: Run the targeted tests and confirm failure**

Run: `pnpm vitest run server/config-store.test.ts`

Expected: FAIL because the store still exposes a single Config.

- [ ] **Step 4: Implement legacy/document parsing and normalization**

Replace `readConfigUnlocked` with a private `readDocumentUnlocked(): Promise<ProfileDocument>` that:

1. parses JSON once,
2. first tries normalized `profileDocumentSchema`,
3. otherwise tries normalized legacy `configSchema`,
4. wraps a legacy result with `defaultProfileDocument` metadata without writing,
5. preserves the current broken-file behavior only when neither schema accepts the data.

Make `dropUnknownPanes` and missing-pane insertion operate on each contained Config. Never mutate `defaultConfig` or `defaultProfileDocument` by reference; create fresh arrays and objects.

- [ ] **Step 5: Implement catalog and per-profile operations**

Keep one store-local Promise queue. Every mutation reads the latest document inside that queue, validates its relevant revision, constructs a new complete document, validates it, checks serialized size, rotates backups, and calls `writeAtomic`. Generate new IDs with `randomUUID()`.

`updateConfig(profileId, ifMatch, candidate)` must advance only the target Config's `updatedAt`; it must not change `profilesUpdatedAt`. Catalog mutations must advance only `profilesUpdatedAt`, except creation also gives the copied Config a fresh `updatedAt` so its cache identity is independent.

- [ ] **Step 6: Run all required verification**

Run:

```bash
pnpm vitest run server/config-store.test.ts
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 7: Commit Task 2**

```bash
git add server/config-store.ts server/config-store.test.ts
git commit -m "feat: persist multiple dashboard profiles"
```

### Task 3: Profile catalog API and profile-scoped server data

**Files:**
- Modify: `server/app.ts`
- Modify: `server/index.test.ts`
- Modify: `server/homelab-cache.ts`
- Modify: `server/homelab-cache.test.ts`
- Modify: `server/proxy.test.ts`

**Interfaces:**
- Consumes: the Task 2 `ConfigStore` interface.
- Produces: explicit profile handling for catalog, config, proxy, and homelab routes.
- Changes `HomelabCache.get` to `get(profileId: ProfileId, config: Config): Promise<HomelabData>`.

- [ ] **Step 1: Add failing catalog-route tests**

Add API tests for catalog GET, protected POST/PATCH/DELETE, `If-Match` success and conflict, duplicate name, unknown source/target, last-profile refusal, body limits, malformed JSON, and the existing Host/Origin/CIDR protections on every write method.

Use request bodies:

```ts
{ name: "Arbeit", sourceProfileId: "default" }
{ name: "Privat" }
```

- [ ] **Step 2: Add failing profile-parameter tests**

For `/api/config`, `/api/proxy`, and `/api/homelab`, test missing profile (`400`), malformed profile (`400`), unknown profile (`404`), and successful selection. Prove that a URL allowed only by profile A is rejected under profile B and that disabled Homelab in one profile does not suppress enabled Homelab in another.

- [ ] **Step 3: Add failing Homelab cache-isolation tests**

Create two profiles whose Config values deliberately have the same `updatedAt`; assert two fetches for different profile IDs and one shared fetch for repeated requests to the same profile ID/revision.

- [ ] **Step 4: Run targeted tests and confirm failure**

Run:

```bash
pnpm vitest run server/index.test.ts server/homelab-cache.test.ts server/proxy.test.ts
```

Expected: FAIL because routes and server caches do not understand profiles.

- [ ] **Step 5: Implement request parsing and routes**

Add one helper in `server/app.ts` that parses the required `profile` query parameter with `profileIdSchema` and returns a discriminated result. Reuse it for all profile-dependent routes.

Implement catalog endpoints with `readJsonBody`, the existing body cap, `createWriteGuard(runtimeEnv)`, catalog `If-Match`, and stable German JSON errors. Update config PUT to call `store.updateConfig(profileId, ifMatch, body)`. Resolve the selected Config before proxy allowlist calculation and Homelab enablement checks.

- [ ] **Step 6: Key Homelab cache by profile and revision**

Replace revision-only identity with `${profileId}:${config.updatedAt}`. Keep single-flight, TTL, disabled-monitoring behavior, and error semantics unchanged.

- [ ] **Step 7: Run all required verification**

Run:

```bash
pnpm vitest run server/index.test.ts server/homelab-cache.test.ts server/proxy.test.ts
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 8: Commit Task 3**

```bash
git add server/app.ts server/index.test.ts server/homelab-cache.ts server/homelab-cache.test.ts server/proxy.test.ts
git commit -m "feat: expose profile-aware dashboard APIs"
```

### Task 4: Local profile selection and frontend API hooks

**Files:**
- Create: `src/api/profileUrl.ts`
- Create: `src/api/profiles.ts`
- Create: `src/api/profiles.test.tsx`
- Modify: `src/config/local.ts`
- Create: `src/config/local.test.ts`
- Modify: `src/api/config.ts`
- Modify: `src/api/config.test.tsx`

**Interfaces:**
- Produces:

```ts
type ProfileCatalog = { profilesUpdatedAt: string; profiles: ProfileMeta[] };
function profileApiUrl(path: string, profileId: ProfileId, params?: URLSearchParams): string;
function readActiveProfileId(): ProfileId | undefined;
function writeActiveProfileId(profileId: ProfileId): void;
function readLocalCatalog(): ProfileCatalog | undefined;
function writeLocalCatalog(catalog: ProfileCatalog): void;
function readLocalConfig(profileId: ProfileId): Config | undefined;
function writeLocalConfig(profileId: ProfileId, config: Config): void;
function useProfiles(): UseQueryResult<ProfileCatalog>;
function useCreateProfile(): UseMutationResult<...>;
function useRenameProfile(): UseMutationResult<...>;
function useDeleteProfile(): UseMutationResult<...>;
function useConfig(profileId: ProfileId): UseQueryResult<Config>;
function useSaveConfig(profileId: ProfileId): UseMutationResult<Config, ...>;
```

- [ ] **Step 1: Add failing local-storage tests**

Test valid and invalid active IDs, catalog validation, per-profile config keys, storage exceptions, and one-time migration of the existing `dashboard:config` value to `dashboard:config:default` without deleting unrelated storage.

- [ ] **Step 2: Add failing hook tests**

Test profile-specific URLs and query keys, cached initial data, catalog polling, create/rename/delete `If-Match`, profile config PUT `If-Match`, conflict errors retaining the server revision, and that success updates only the target profile cache.

- [ ] **Step 3: Run targeted tests and confirm failure**

Run:

```bash
pnpm vitest run src/config/local.test.ts src/api/profiles.test.tsx src/api/config.test.tsx
```

Expected: FAIL because profile-local persistence and hooks do not exist.

- [ ] **Step 4: Implement local persistence and URL construction**

Use these key families:

```text
dashboard:active-profile
dashboard:profiles
dashboard:config:<profileId>
```

Parse all stored values through the schemas. Catch every storage access failure. Construct URLs with `URLSearchParams`; never interpolate an unencoded profile ID or remote target.

- [ ] **Step 5: Implement catalog and per-profile hooks**

Use `queryKey: ["profiles"]` for the catalog and `["config", profileId]` for Config. Poll the catalog every 15 seconds and refetch on focus. On mutation success, cancel older catalog requests before updating localStorage and query data. Profile config invalidation must preserve the existing data-source invalidation rules but affect keys for the saved profile only.

- [ ] **Step 6: Run all required verification**

Run:

```bash
pnpm vitest run src/config/local.test.ts src/api/profiles.test.tsx src/api/config.test.tsx
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/api/profileUrl.ts src/api/profiles.ts src/api/profiles.test.tsx src/config/local.ts src/config/local.test.ts src/api/config.ts src/api/config.test.tsx
git commit -m "feat: add device-local profile state"
```

### Task 5: Profile-isolated widget requests and application switching

**Files:**
- Modify: `src/widgets/Weather.tsx`
- Modify: `src/widgets/Weather.test.tsx`
- Modify: `src/widgets/News.tsx`
- Modify: `src/widgets/News.test.tsx`
- Modify: `src/widgets/Agenda.tsx`
- Modify: `src/widgets/Agenda.test.tsx`
- Modify: `src/widgets/Homelab.tsx`
- Modify: `src/widgets/Homelab.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Changes fetch signatures to accept `profileId: ProfileId` as the first argument:

```ts
fetchWeather(profileId, location)
fetchNews(profileId, feeds)
fetchEvents(profileId, calendars, from, to)
fetchHomelab(profileId)
```

- Produces in `App`: a single active-profile resolver based on catalog plus local ID, and `switchProfile(profileId)` for Settings and commands.

- [ ] **Step 1: Add failing widget URL tests**

Update each fetch test to assert an encoded `profile=<id>` parameter. Retain all existing target URL, error, partial-source, and decoder assertions.

- [ ] **Step 2: Add failing App switching and isolation tests**

Cover initial local selection, fallback to the first server profile, independent simulated devices by resetting localStorage, remote deletion fallback with the specified German note, profile-specific Config loading, Theme/Layout changes after switching, and source query keys prefixed with the active profile ID.

Add a deferred-fetch test: start a request under `Arbeit`, switch to `Privat`, resolve the old request, and assert that no work-profile value appears in the private-profile UI or cache.

- [ ] **Step 3: Run targeted tests and confirm failure**

Run:

```bash
pnpm vitest run src/widgets/Weather.test.tsx src/widgets/News.test.tsx src/widgets/Agenda.test.tsx src/widgets/Homelab.test.tsx src/App.test.tsx
```

Expected: FAIL because requests and App state are not profile-aware.

- [ ] **Step 4: Pass profile IDs through all widget fetchers**

Use `profileApiUrl` for every `/api/proxy` and `/api/homelab` call. Keep local `/static/*.ics` requests routed through `/api/proxy`; the server still decides policy for the selected profile.

- [ ] **Step 5: Implement active-profile resolution in App**

Load the catalog before selecting a server profile, but use its valid local cached value for immediate rendering. Resolve selection deterministically: valid stored ID first, otherwise catalog entry zero with an explicit fallback. Because `noUncheckedIndexedAccess` is enabled, never assume `profiles[0]` exists even though the schema requires it.

Create every `useCachedQuery` key as `profile:<id>:<old-key>`. Pass the selected ID to fetch functions. On switch, save the ID locally, cancel old profile queries, reset pane selection through the existing reducer, and allow the target profile's local snapshot to render immediately.

- [ ] **Step 6: Handle remote deletion and request races**

When a catalog refresh no longer contains the selected ID, select the first available profile and display `Profil wurde entfernt — Standardprofil aktiv.`. Use profile-keyed Query caches so late requests can only update their original profile. Do not clear valid caches belonging to the old profile.

- [ ] **Step 7: Run all required verification**

Run:

```bash
pnpm vitest run src/widgets/Weather.test.tsx src/widgets/News.test.tsx src/widgets/Agenda.test.tsx src/widgets/Homelab.test.tsx src/App.test.tsx
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/widgets/Weather.tsx src/widgets/Weather.test.tsx src/widgets/News.tsx src/widgets/News.test.tsx src/widgets/Agenda.tsx src/widgets/Agenda.test.tsx src/widgets/Homelab.tsx src/widgets/Homelab.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: isolate dashboard data by active profile"
```

### Task 6: Profile management in Settings

**Files:**
- Modify: `src/shell/SettingsPane.tsx`
- Modify: `src/shell/SettingsPane.test.tsx`
- Modify: `src/index.css`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: active `ProfileMeta`, `ProfileCatalog`, `switchProfile`, and Task 4 mutation functions.
- Adds Settings props for `profiles`, `activeProfileId`, `onSwitchProfile`, `onCreateProfile`, `onRenameProfile`, and `onDeleteProfile` using explicit typed callbacks.
- Allows `initialSection?: Sec`, with `profile` as a valid first section.

- [ ] **Step 1: Add failing Profile-section tests**

Test the first navigation label `PROFILE`, active-row rendering, switching, duplication with a trimmed unique name, rename, two-click deletion, last-profile disabled state, and German API errors. Verify newly created profiles switch locally only after the server confirms creation.

- [ ] **Step 2: Add failing unsaved-draft protection tests**

Change a normal Config field, request a profile switch, assert no switch occurs and a discard confirmation appears; confirm and assert the switch. Cancel the confirmation and assert the draft remains. Repeat the protection when deleting the active profile. Deleting an inactive profile must not discard the draft.

- [ ] **Step 3: Run targeted tests and confirm failure**

Run:

```bash
pnpm vitest run src/shell/SettingsPane.test.tsx src/App.test.tsx
```

Expected: FAIL because Settings has no profile section or profile callbacks.

- [ ] **Step 4: Implement focused profile controls**

Add `PROFILE` before the eight existing sections. Follow the existing row/action visual language and CSS variables. Use text buttons, visible `:focus-visible`, labels for every input/action, and no new color values.

Track the Config snapshot captured when Settings opens. A draft is dirty when its validated serializable value differs from that snapshot. Profile catalog mutations do not modify the Config draft. Keep each destructive confirmation explicit and local to one action.

- [ ] **Step 5: Wire Settings to App mutations**

On successful create, switch to the returned `createdId`. On successful rename, keep the stable active ID. On deleting the active profile, choose the first remaining profile after the server response. Preserve the draft and display conflict recovery when catalog `If-Match` fails.

- [ ] **Step 6: Run accessibility and required verification**

Run:

```bash
pnpm vitest run src/shell/SettingsPane.test.tsx src/App.test.tsx
pnpm vitest run -t "Kontraste"
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/shell/SettingsPane.tsx src/shell/SettingsPane.test.tsx src/index.css src/App.tsx src/App.test.tsx
git commit -m "feat: manage profiles in dashboard settings"
```

### Task 7: Profile commands, statusline, help, import, and export

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/shell/StatusLine.tsx`
- Modify: `src/shell/StatusLine.test.tsx`
- Modify: `src/shell/KeymapOverlay.tsx`
- Modify: `src/shell/KeymapOverlay.test.tsx`
- Modify: `src/config/io.ts`
- Modify: `src/config/config.test.ts`
- Modify: `src/index.css`

**Interfaces:**
- Extends command handling with exact `profile` and `profile <name>` forms.
- Changes `exportConfig` to `exportConfig(config: Config, profileName: string): void`.
- Adds `profileName: string` to `StatusLine` props.

- [ ] **Step 1: Add failing command tests**

Assert `:profile` opens Settings on `PROFILE`; `:profile Arbeit` switches by case-insensitive exact name; whitespace is normalized; partial and unknown names fail in German; and switching does not update server-side catalog state.

- [ ] **Step 2: Add failing status/help/export tests**

Assert the statusline includes `profile:arbeit`, truncates only the visible string when necessary, exposes the full name through an accessible label/title, and keeps existing source/problem/note layout behavior. Assert Keymap help lists both profile commands. Assert export filename sanitization for spaces, slashes, control characters, and an empty sanitized result, with fallback `profil`.

- [ ] **Step 3: Run targeted tests and confirm failure**

Run:

```bash
pnpm vitest run src/App.test.tsx src/shell/StatusLine.test.tsx src/shell/KeymapOverlay.test.tsx src/config/config.test.ts
```

Expected: FAIL because command, status, help, and filename behavior are absent.

- [ ] **Step 4: Implement command parsing and direct Settings section**

In `runCommand`, treat `profile` separately from `profile ` plus a nonempty name. Compare with `name.toLocaleLowerCase("de-DE")`. Do not use prefix matching. Store a requested initial Settings section in App state so `:settings` uses the normal default and `:profile` opens `PROFILE`.

- [ ] **Step 5: Implement status, help, and active-profile export**

Render a compact `profile:<name>` status segment using existing classes/tokens. Keep full text accessible. Sanitize export names to lowercase letters/numbers plus `-` and `_`, replace disallowed runs with `-`, trim separators, and export `dashboard-<safe-name>.json`. Import continues to replace only the active Config because its save mutation is already bound to the active profile ID.

- [ ] **Step 6: Run all required verification**

Run:

```bash
pnpm vitest run src/App.test.tsx src/shell/StatusLine.test.tsx src/shell/KeymapOverlay.test.tsx src/config/config.test.ts
pnpm vitest run -t "Kontraste"
pnpm test
pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 7: Commit Task 7**

```bash
git add src/App.tsx src/App.test.tsx src/shell/StatusLine.tsx src/shell/StatusLine.test.tsx src/shell/KeymapOverlay.tsx src/shell/KeymapOverlay.test.tsx src/config/io.ts src/config/config.test.ts src/index.css
git commit -m "feat: add profile commands and status"
```

### Task 8: Documentation, regression verification, and release readiness

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `PLAN.md`
- Test: all existing test files

**Interfaces:**
- Documents the final API, storage format, migration, device-local selection, recovery, and commands.
- Removes Multi-Profile from the currently prohibited feature list while preserving the historical plan context.

- [ ] **Step 1: Update project documentation**

Document:

- the version-2 `config.json` envelope and automatic legacy migration,
- per-device active selection in localStorage,
- `:profile` and `:profile <name>`,
- profile-aware Config/Proxy/Homelab endpoints,
- whole-document server backups and active-profile import/export,
- deletion fallback and conflict behavior,
- that `.env` and all secrets remain global and are never returned,
- that deployment remains manual.

In `AGENTS.md`, remove `Multi-Profile` from `Nicht bauen` and update the Config/data-path architecture paragraphs. In `PLAN.md`, keep the original historical exclusion but annotate that a later explicit product decision superseded it, linking to the profile spec rather than rewriting the completed ten-step plan.

- [ ] **Step 2: Run focused security and integration suites**

Run:

```bash
pnpm vitest run server/config-store.test.ts server/index.test.ts server/proxy.test.ts server/homelab-cache.test.ts
pnpm vitest run src/api/profiles.test.tsx src/api/config.test.tsx src/App.test.tsx src/shell/SettingsPane.test.tsx
```

Expected: all tests pass with no secret values in snapshots or output.

- [ ] **Step 3: Run final project verification**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: complete success. Record the exact test-file/test-count summary and build result for handoff.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git status --short
git diff --stat HEAD~7..HEAD
git log --oneline -10
```

Confirm that `.pnpm-store/`, `CODEBASE_REVIEW_2026-09-08.md`, `.env`, `config.json`, and
`pve-ca.pem` are neither staged nor committed. Confirm no dependency or lockfile change.

- [ ] **Step 5: Commit Task 8**

```bash
git add README.md AGENTS.md PLAN.md
git commit -m "docs: document dashboard profiles"
```

Do not run `pnpm deploy`.
