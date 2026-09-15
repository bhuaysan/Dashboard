# Optional Proxmox Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proxmox-Monitoring kann unabhängig von der HOMELAB-Pane aktiviert oder deaktiviert werden; deaktiviert entstehen weder Proxmox-Abfragen noch PVE-Anzeigen.

**Architecture:** `Config["homelab"].enabled` ist die einzige fachliche Aktivierungsquelle. `layout[id="homelab"].visible` bleibt die unabhängige Darstellungsoption; Frontend und Server verhindern bei deaktiviertem Monitoring jede automatische oder direkte Homelab-Abfrage.

**Tech Stack:** TypeScript strict, React 19, TanStack React Query, Hono, Zod, Vitest, Testing Library

**Spec:** Vom Benutzer am 12. September 2026 freigegebener Entwurf in der Task-Konversation; die Projektverträge stehen zusätzlich in `AGENTS.md`, `PLAN.md` und `mockup/index.html`.

## Global Constraints

- Keine neuen Abhängigkeiten; nur Pakete aus `package.json` verwenden.
- Keine Emoji und keine Icons; Zustände nur mit vorhandenen Textzeichen darstellen.
- Benutzertexte deutsch, Pane-Titel und Statusline-Kürzel englisch.
- Keine Secrets lesen oder verändern; `.env`, `config.json` und `pve-ca.pem` bleiben unangetastet.
- `/api/proxy` und seine Sperre privater Adressen bleiben unverändert.
- TypeScript strict einschließlich `noUncheckedIndexedAccess`; kein `any` und keine Assertions zum Wegdrücken von Typfehlern.
- Browserzugriffe gehen ausschließlich an `/api/...`.
- TDD ist verpflichtend: jeden Verhaltenstest zuerst schreiben und mit dem erwarteten Fehler beobachten.
- Nach jeder Task `pnpm test` und `pnpm build`; beide müssen erfolgreich sein.
- Bestehende Configs ohne `homelab.enabled` bleiben aktiviert; neue Defaults starten deaktiviert.
- `configured: false` bedeutet weiterhin ausschließlich fehlende PVE-Laufzeitkonfiguration und niemals „vom Benutzer deaktiviert“.

---

### Task 1: Config-Vertrag und Einstellungsoberfläche

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/config.test.ts`
- Modify: `server/config-store.test.ts`
- Modify: `src/shell/SettingsPane.tsx`
- Modify: `src/shell/SettingsPane.test.tsx`
- Modify: `mockup/index.html`

**Interfaces:**
- Consumes: bestehendes `Config["homelab"]` und den vorhandenen Settings-Entwurf.
- Produces: `Config["homelab"]["enabled"]: boolean`; fehlendes Feld wird als `true` gelesen, `defaultConfig.homelab.enabled` ist `false`.

- [ ] **Step 1: Failing Config-Tests schreiben**

  Ergänze Verhaltenstests, die unabhängig vom Implementierungscode nachweisen:

  ```ts
  const { enabled: _enabled, ...legacyHomelab } = defaultConfig.homelab;
  const legacy = { ...defaultConfig, homelab: legacyHomelab };
  expect(configSchema.parse(legacy).homelab.enabled).toBe(true);
  expect(defaultConfig.homelab.enabled).toBe(false);
  ```

  Der Test muss bei fehlender Schema-Unterstützung am Zugriff beziehungsweise an der Erwartung scheitern.

- [ ] **Step 2: Config-RED verifizieren**

  Run: `pnpm vitest run src/config/config.test.ts`

  Expected: FAIL, weil `homelab.enabled` noch nicht existiert beziehungsweise nicht standardmäßig ergänzt wird.

- [ ] **Step 3: Minimalen Config-Vertrag implementieren**

  Ergänze im Homelab-Schema exakt:

  ```ts
  enabled: z.boolean().default(true),
  ```

  Ergänze im `defaultConfig.homelab` exakt:

  ```ts
  enabled: false,
  ```

  Die asymmetrischen Defaults sind beabsichtigt: Altbestand bleibt aktiv, neue Installationen sind Opt-in.

- [ ] **Step 4: Config-GREEN verifizieren**

  Run: `pnpm vitest run src/config/config.test.ts`

  Expected: PASS.

  Ergänze außerdem in `server/config-store.test.ts` einen Lesetest mit einer vollständig gültigen
  Config ohne `homelab.enabled`. `readConfig()` muss `homelab.enabled === true` liefern und darf
  keine `config.json.bak` anlegen. Verifiziere ihn mit:

  Run: `pnpm vitest run server/config-store.test.ts`

  Expected: PASS.

- [ ] **Step 5: Failing Settings-Test schreiben**

  Öffne den Homelab-Tab im echten `SettingsPane`, schalte die zugängliche Checkbox `Proxmox-Monitoring aktiv` ein und speichere. Prüfe den tatsächlich an `save.mutateAsync` übergebenen Config-Entwurf:

  ```ts
  expect(sent.homelab.enabled).toBe(true);
  expect(sent.homelab.node).toBe(defaultConfig.homelab.node);
  expect(sent.homelab.thresholds).toEqual(defaultConfig.homelab.thresholds);
  ```

- [ ] **Step 6: Settings-RED verifizieren**

  Run: `pnpm vitest run src/shell/SettingsPane.test.tsx`

  Expected: FAIL, weil die Checkbox fehlt.

- [ ] **Step 7: Settings und Mockup minimal erweitern**

  Ergänze oben im Homelab-Abschnitt eine Checkbox mit sichtbarem deutschen Text `Proxmox-Monitoring aktiv`, zugänglichem Namen und bestehender `check-state`-Darstellung `an`/`aus`. Sie ändert ausschließlich `draft.homelab.enabled`; alle übrigen Homelab-Werte bleiben erhalten.

  Ergänze im Layout-Abschnitt einen knappen deutschen Hinweis: Die Sichtbarkeit blendet nur die Pane aus; bei aktivem Monitoring bleiben Status und Alarme erhalten. Deaktiviere die HOMELAB-Sichtbarkeitscheckbox bei ausgeschaltetem Monitoring, ohne ihren gespeicherten Wert zu verändern.

  Spiegle denselben Schalter und Hinweis in `mockup/index.html`. Nutze nur vorhandene Klassen, CSS-Variablen und Textzeichen.

- [ ] **Step 8: Settings-GREEN und vollständige Abnahme**

  Run: `pnpm vitest run src/shell/SettingsPane.test.tsx src/config/config.test.ts`

  Expected: PASS.

  Run: `pnpm test`

  Expected: 0 fehlgeschlagene Tests.

  Run: `pnpm build`

  Expected: Exit 0.

- [ ] **Step 9: Commit**

  ```bash
  git add src/config/schema.ts src/config/defaults.ts src/config/config.test.ts server/config-store.test.ts src/shell/SettingsPane.tsx src/shell/SettingsPane.test.tsx mockup/index.html
  git commit -m "feat: add optional Proxmox monitoring setting"
  ```

---

### Task 2: Monitoring in Frontend und Server vollständig schalten

**Files:**
- Modify: `src/api/useCachedQuery.ts`
- Modify: `src/api/useCachedQuery.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `server/app.ts`
- Modify: `server/index.test.ts`
- Modify: `AGENTS.md`
- Modify: `PLAN.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `Config["homelab"]["enabled"]: boolean` aus Task 1.
- Produces: `useCachedQuery`-Option `enabled?: boolean`; deaktiviertes Monitoring blockiert Client-Query und Server-Fetcher.

- [ ] **Step 1: Failing Query-Tests schreiben**

  Ergänze Verhaltenstests mit echtem `QueryClient`:

  ```ts
  const fetcher = vi.fn(async () => [{ title: "neu", date: new Date() }]);
  const { result, rerender } = renderHook(
    ({ enabled }) => useCachedQuery("toggle", fetcher, 60_000, {
      enabled,
      decode: () => undefined,
    }),
    { initialProps: { enabled: false }, wrapper },
  );
  await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  expect(fetcher).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(fetcher).toHaveBeenCalledTimes(1);
  ```

- [ ] **Step 2: Query-RED verifizieren**

  Run: `pnpm vitest run src/api/useCachedQuery.test.tsx`

  Expected: FAIL, weil `enabled` noch keine gültige Option ist oder den Fetcher nicht sperrt.

- [ ] **Step 3: Minimale Query-Schaltung implementieren**

  Ergänze `enabled?: boolean` in `Options<T>` und reiche es an `useQuery` weiter:

  ```ts
  const { enabled = true, refetchIntervalMs, decode } = options;
  // ...
  enabled,
  ```

  Cache-Decodierung bleibt erlaubt; Netzwerkzugriffe und Refetches bleiben bei `false` gesperrt.

- [ ] **Step 4: Query-GREEN verifizieren**

  Run: `pnpm vitest run src/api/useCachedQuery.test.tsx`

  Expected: PASS.

- [ ] **Step 5: Failing App-Verhaltenstests schreiben**

  Teste mit vollständigen Config- und Homelab-Antworten beide Zustände:

  - `enabled: false`: kein Request auf `/api/homelab`, keine HOMELAB-Pane, kein `lab`-Paneeintrag, keine `pve`-Quelle, kein PVE-Fehler und keine PVE-Alarme.
  - `enabled: true` und `layout.homelab.visible: false`: Request auf `/api/homelab` findet statt, Pane und `lab`-Paneeintrag fehlen, `pve`-Quelle und Alarme bleiben sichtbar.
  - Wenn die fokussierte HOMELAB-Pane durch Speichern einer deaktivierten Config verschwindet, übernimmt der bestehende Reducer einen sichtbaren Fokus.

  Assertions prüfen gerendertes Nutzerverhalten und die echten Fetch-Ziele, nicht bloß Mock-Aufrufe ohne UI-Wirkung.

- [ ] **Step 6: App-RED verifizieren**

  Run: `pnpm vitest run src/App.test.tsx`

  Expected: FAIL, weil die Homelab-Query und PVE-Statusquelle noch unabhängig von `enabled` laufen.

- [ ] **Step 7: App minimal schalten**

  Leite vor dem Homelab-Hook `homelabEnabled` aus `config.homelab.enabled` ab. Rufe `useCachedQuery` weiterhin bedingungslos als Hook auf, aber mit `{ enabled: homelabEnabled }`.

  Die effektive HOMELAB-Pane-Sichtbarkeit ist `homelabEnabled && layoutVisible`. Entferne bei deaktiviertem Monitoring HOMELAB aus `visiblePanes`, den `pve`-Eintrag aus `StatusLine.sources`, PVE aus der Fehlerpriorisierung sowie Homelab-Alarme aus der Statusline. Bei aktiviertem Monitoring und nur ausgeblendeter Pane bleiben Status und Alarme erhalten.

- [ ] **Step 8: App-GREEN verifizieren**

  Run: `pnpm vitest run src/App.test.tsx src/api/useCachedQuery.test.tsx`

  Expected: PASS.

- [ ] **Step 9: Failing Serverroute-Test schreiben**

  Erzeuge die App mit deaktivierter Config und injiziertem `homelabFetcher`. Rufe `/api/homelab` auf und prüfe den Nutzervertrag:

  ```ts
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Homelab deaktiviert" });
  expect(homelabFetcher).not.toHaveBeenCalled();
  ```

  Ergänze beziehungsweise nutze eine Fixture-Option, ohne Produktionscode nur für Tests zu erweitern.

- [ ] **Step 10: Server-RED verifizieren**

  Run: `pnpm vitest run server/index.test.ts`

  Expected: FAIL, weil der Fetcher noch aufgerufen wird und die Route nicht 404 liefert.

- [ ] **Step 11: Serverseitige Sperre implementieren**

  Prüfe `cfg.homelab.enabled` unmittelbar nach erfolgreichem Config-Lesen und vor `homelabCache.get(cfg)`:

  ```ts
  if (!cfg.homelab.enabled) {
    return c.json({ error: "Homelab deaktiviert" }, 404);
  }
  ```

  `configured: false` und `emptyHomelab` bleiben unverändert.

- [ ] **Step 12: Dokumentation angleichen**

  Dokumentiere in `AGENTS.md`, `PLAN.md` und `README.md` exakt:

  - `homelab.enabled` steuert Monitoring und `/api/homelab`.
  - `layout.homelab.visible` steuert nur die Pane.
  - Bei deaktiviertem Monitoring gibt es keine PVE-Requests, Status- oder Alarmanzeige.
  - Fehlendes `PVE_TOKEN_SECRET` bleibt der davon unabhängige Zustand „nicht konfiguriert“.

  Behaupte keine automatische Migration und ändere keine Secret- oder Proxy-Regeln.

- [ ] **Step 13: Vollständige Abnahme**

  Run: `pnpm vitest run server/index.test.ts src/App.test.tsx src/api/useCachedQuery.test.tsx`

  Expected: PASS.

  Run: `pnpm test`

  Expected: 0 fehlgeschlagene Tests.

  Run: `pnpm build`

  Expected: Exit 0.

- [ ] **Step 14: Commit**

  ```bash
  git add src/api/useCachedQuery.ts src/api/useCachedQuery.test.tsx src/App.tsx src/App.test.tsx server/app.ts server/index.test.ts AGENTS.md PLAN.md README.md
  git commit -m "feat: disable Proxmox monitoring end to end"
  ```
