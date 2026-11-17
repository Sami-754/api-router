# Deletion log

## 2026-11-17 Cleanup Session

Executed from `docs/CLEANUP_REPORT.md` (same-day audit). No schema changes.
Worktree was backed up to the session scratchpad before edits; no git commit was
created because the working tree still contains the larger uncommitted UI
refactor.

### Removed

- `pino` direct dependency — unused in `src`/`tests`; Fastify still provides it
  transitively for its logger.
- `timingSafeCompare` in `src/shared/crypto.ts` — zero references; no auth path
  uses it.
- `Chip` and `QuotaLabel` components plus `.chip*`/`.quota-label*` CSS — unused
  by any page.
- `qs` from `web/src/lib/api.ts`, and `fmtExact`, `modelLabel`, `capLabel`,
  `relativeHour` from `web/src/lib/format.ts` — unused exports.
- `useDebounced` and `useMountedRef` from `web/src/lib/hooks.ts` — unused.
- Five unused icon definitions (`search`, `external`, `clock`, `collapse`,
  `expand`) and their union entries.

### Consolidated

- SQLite row mapping: added `mapProvider`, `mapAccount`, `mapCredential`,
  `mapResource`, `mapProviderResource`, `mapQuotaWindow`, `mapRequestLog`;
  replaced duplicated `get`/`list` mapping blocks in `src/db/sqlite-store.ts`.
- `/api/routes`: replaced per-route `listQuotaWindows` + `getHealth` calls with
  batched `listQuotaWindowsForCredentials` + `listHealthForCredentials`
  (chunked at 500 credential ids). Live `auto:free` routes dropped from
  51–77 ms to ~9–12 ms locally and still include quotas/health.
- `ModelDetailPage`: now fetches `GET /api/resources/:id` (284 bytes) instead of
  the full 456 KB resource list.
- Dashboard no longer polls `/api/provider-resources` (803 KB per tick); the
  per-provider models column was removed because Dashboard could not use it
  without that download. `/api/overview` still supplies the mapping total.
- Extracted `AppDeps`/`RuntimeSettings` to `src/server/deps.ts`; madge now reports
  zero circular dependencies.
- Removed unnecessary `export` keywords from internal-only helpers
  (`exaAdapter`, `firecrawlAdapter`, `tavilyAdapter`, `authHeaders`,
  `withBodyAuth`, `resetUrgency`, `isRateWindow`, `rateWindowStartMs`,
  `FREE_MODEL_RE`, `requireMasterKey`, `capabilitySchema`, `routingHintSchema`).
- UI removed: provider/resource/mapping creation dialogs (earlier same-day
  change), replaced by the Add page (key-first provisioning + manual model route).

### Kept on purpose (DO NOT REMOVE)

- `src/server/import-keys.ts` — orphan by imports, but documented operational
  importer used for 206 credentials. Owner decision: keep/move later.
- `POST /api/routing/simulate` — UI simulator dropped, but tests and docs use it.
- `POST /api/providers` — intentionally backend-only; not a dead endpoint.
- `src/core/router.ts` execute/executeStream duplication — deferred T3/RISKY
  refactor; needs a dedicated branch and parity tests.
- `POST /api/requests/:id` — kept and now covered by an API test.
- `.firecrawl/` — intentional gitignored local API-reference cache.

### Docs/config

- `.gitignore`: added `.commandcode/`.
- `format`/`format:check` now target `web/src` + `web/*.{ts,html}` instead of all
  of `web/**` (avoids formatting `web/dist`).
- `.env.example` port aligned to 4500; `docs/api.md` updated.
- TASKS/ROADMAP/README refreshed for the six-page UI and shipped protocol work.

### Impact

- Files: net +1 (`src/server/deps.ts`); no source files deleted.
- Dependencies: -1 direct (`pino`).
- Lines: ~150 dead UI/helper/CSS lines removed; consolidation net roughly
  neutral after adding batched store helpers + tests.
- Formatting: 30 unformatted files before -> all matched files formatted.
- Gates after changes: typecheck pass, lint pass, 126/126 tests pass, build pass,
  `format:check` pass. Live `/healthz` 200, dashboard 200, single-resource route
  200 with 284-byte payload.
