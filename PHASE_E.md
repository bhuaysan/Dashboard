# Phase E — Audit-Abnahme

Stand: 8. August 2026

## Finding → Änderung → Test

| Finding | Änderung | Abnahme |
| --- | --- | --- |
| F-26 | `server/app.ts` als testbare App-Fabrik; `server/index.ts` lädt `.env` nur im ausführbaren Einstiegspunkt. Servertests laufen in Node, DNS und Environment sind synthetisch, temporäre Verzeichnisse werden entfernt, Tests ohne Testfälle schlagen fehl. | `server/env.test.ts`, `server/index.test.ts`, hermetische Proxy-Tests |
| F-21 | `packageManager`/Node-Engine, lokales `tsx`, pnpm-Lock im Release, `pnpm test`/`pnpm build`/`git diff --check` vor Upload, root-owned Releases, atomarer `current`-Symlink, Restart-, Aktivitäts- und `/api/health`-Check mit Rollback. | `bash -n deploy/*.sh`; Release-Ablauf in `deploy/deploy.sh` |
| F-22 | Environment mit Zod validiert; PVE-Felder sind vollständig oder vollständig leer. State liegt unter `/var/lib/dashboard`, Environment/CA unter `/etc/dashboard`, Unit hat minimale Schreib- und Capability-Rechte. | `server/env.test.ts`, `deploy/dashboard.service` |
| F-24 | Offenes Overlay isoliert das Raster mit `inert`/`aria-hidden`; Settings und KEYMAP besitzen Focus-Traps und KEYMAP einen Schließen-Button. Row-Aktionen und Layout-Controls haben Kontextnamen und Touch-Ziele; MONTH ist eine semantische Tabelle. | `KeymapOverlay.test.tsx`, `SettingsPane.test.tsx`, `Month.test.tsx`, `App.test.tsx` |
| F-27–F-31 | 204-Responses bleiben bodylos; unbekannte Bangs, Ortssuche und PVE-Status werden semantisch korrekt behandelt. | Server-, CommandBar-, Settings- und StatusLine-Tests |

F-25 bleibt bewusst offen: Die Entscheidung, ob MONTH und das aktuelle Layout der neue Mockup-
Sollstand sind, muss produktseitig bestätigt werden. Deshalb wurden Mockup, Pane-Reihenfolge und
Spalten nicht eigenmächtig geändert. F-32s historische Dateien wurden ebenfalls nicht gelöscht;
deren gewünschtes Schicksal ist im Audit ausdrücklich als Klärungspunkt markiert.

## Verifikation

Erfolgreich ausgeführt:

```text
pnpm test   — 34 Testdateien, 266 Tests
pnpm build  — erfolgreich
git diff --check — erfolgreich
bash -n deploy/deploy.sh deploy/provision.sh — erfolgreich
```

`pnpm deploy` wurde nicht ausgeführt; es bleibt eine ausdrücklich auszulösende externe Änderung.
