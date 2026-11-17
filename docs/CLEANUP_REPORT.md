# Codebase Cleanup Audit — 2026-11-17

Scope: `src/`, `web/src/`, `tests/`, root config/docs. This document is the
Phase 1 audit snapshot. The safe/high-value items were executed the same day;
see `docs/DELETION_LOG.md` for the exact changes. Higher-risk refactors remain
deferred below.

Previous run: no cleanup report/deletion log existed. `AUDIT.md` is a
historical logic/security audit, not a cleanup report, so it was only used to
avoid re-reporting already-fixed logic issues.

## Execution status (2026-11-17)

| Status | Findings |
|---|---|
| Resolved | C01, C02, C03, C09, C12, C13, C14, C16, C17, C19 |
| Partial | C11 (mapping overfetch removed; overview remains), C15 (formatting fixed; CI/frontend tests still absent), C18 (port aligned; systemd Node path unchanged) |
| Deferred | C04 (owner decision), C05, C06, C07, C08, C10 |

After execution: typecheck, lint, format, 126/126 tests and build all pass;
madge reports zero cycles; jscpd is down to 36 clones / 659 duplicated lines;
`/api/routes` for `auto:free` dropped from 51–77 ms to ~9–12 ms locally;
`GET /api/resources/:id` returns 284 bytes instead of the 456 KB list.

## Baseline

| Gate | Result |
|---|---|
| Typecheck | Pass (`tsc --noEmit` root + web) |
| Lint | Pass, 0 warnings (`eslint src tests web/src`) |
| Tests | **126/126 pass**, 16 files, 0 skipped |
| Build | Pass (web 381 KB JS / 39.5 KB CSS; server `tsc`) |
| Format | **Fail** — `format:check` reports 30 files (now fixed; see execution status) |
| Duplicate detector | jscpd: 43 clones, 711 duplicated lines (3.33%) across 84 files (now 36 / 659) |
| Dead-code detector | knip: 1 real orphan file + 1 unused dep; web results are false positives (see note) |
| Web unused exports | ts-prune with `web/tsconfig.json`: 9 unused exports |
| Dependency detector | depcheck: `pino` unused |
| Circular imports | madge: 4 cycles, all type-only `AppDeps` imports |

**Knip caveat:** the root knip run marks all 33 `web/src` files unused because
the root project does not include the web tsconfig/entry. Those are **not**
findings. Web dead-code results below come from ts-prune plus manual grep.

## Findings summary

| Category | Count | Tier |
|---|---:|---|
| Dead code / unused UI | 2 | T1 |
| Unused dependency | 1 | T1 |
| Duplicate logic | 6 | T2/T3 |
| Redundant API/DB calls | 3 | T2/T3 |
| Unused route/API | 1 | T2 |
| Abandoned/orphan file | 1 | T2 |
| Tech debt / quality gates | 4 | T1/T2 |
| Stale docs | 1 | T2 |
| **Total** | **19** | |

**Estimated removable:** ~120 lines of directly dead code, 1 dependency, and
5 unused icon definitions. Consolidation findings could remove another
~500–800 net lines, but they are refactors, not safe deletes. Removing
`import-keys.ts` would remove 411 more lines, but only with owner approval.

## Top 5 highest-value, lowest-risk actions

1. Delete unused web exports/icons/CSS (`C01`) — ~120 lines, zero behavior.
2. Remove direct `pino` dependency (`C02`) and dead `timingSafeCompare` (`C03`).
3. Stop the Dashboard downloading ~1.25 MB of list data every 15 s (`C11`).
4. Add `GET /api/resources/:id`; model detail currently downloads 456 KB to
   display one row (`C13`).
5. Deduplicate SQLite row mappers (`C09`) — ~80 lines, covered by tests.

## Findings

### C01 — Unused web components, helpers, icons and CSS

- Category: dead code / unused UI
- Location:
  - `web/src/components/ui.tsx:106-114` — `Chip`
  - `web/src/components/ui.tsx:139-150` — `QuotaLabel`
  - `web/src/lib/api.ts:72-80` — `qs`
  - `web/src/lib/format.ts:59-62,121-123,134-136,138-142` — `fmtExact`, `modelLabel`, `capLabel`, `relativeHour`
  - `web/src/lib/hooks.ts:125-132,134-143` — `useDebounced`, `useMountedRef`
  - `web/src/components/Icon.tsx:22-30,111-121,143-144` — `search`, `external`, `clock`, `collapse`, `expand` icons
  - `web/src/styles/components.css:525-556` — `.chip*`
  - `web/src/styles/components.css:617-633` — `.quota-label*`
- Tier / Risk: **T1 / SAFE**
- Why unnecessary: ts-prune reports each export unused; manual grep found only
  the definitions (no JSX, imports or dynamic string use). `search` appears as
  a tool id, but never as an `<Icon name>`; the other four icons have no hits.
- Impact: ~120 lines removed, smaller API surface, fewer dead icon paths.
- Risks: none found. These are internal SPA modules, not a published library.
- Recommended action: delete the exports/functions/icons and their CSS rules.
- Verification: `pnpm typecheck && pnpm lint && pnpm build`, then grep each
  symbol once more before deletion.

### C02 — `pino` is an unused direct dependency

- Category: dead code / dependency
- Location: `package.json:35`
- Tier / Risk: **T1 / SAFE**
- Why unnecessary: both depcheck and knip flag it; no `import "pino"` or
  `require("pino")` exists in `src` or `tests`. Fastify already brings
  `pino@9.14.0` transitively for its logger.
- Impact: one direct dependency removed; no runtime behavior change.
- Risks: low. If direct `pino` usage is planned (custom transports), keep it.
- Recommended action: `pnpm remove pino`; verify server boot and logging.
- Verification: `pnpm test`, `pnpm build`, start server, hit `/healthz`.

### C03 — Dead crypto helper and unnecessary export surface

- Category: dead code
- Location: `src/shared/crypto.ts:71-84` — `timingSafeCompare`
- Tier / Risk: **T1 / SAFE**
- Why unnecessary: zero references in `src`, `tests` or docs. The service is
  explicitly unauthenticated/local-first, so there is no token comparison path.
- Impact: 14 lines removed.
- Risks: none. If constant-time comparison is intended for future auth, keep it.
- Recommended action: delete it.
- Additional low-priority cleanup: these exports are only used inside their
  own module and can drop the `export` keyword: `exaAdapter`,
  `firecrawlAdapter`, `tavilyAdapter`, `authHeaders`, `withBodyAuth`,
  `resetUrgency`, `isRateWindow`, `rateWindowStartMs`, `requireMasterKey`,
  `capabilitySchema`, `routingHintSchema`. `FREE_MODEL_RE`/`SKIP_MODEL_RE`/
  `CURATED_MODELS` are imported by `import-keys.ts`, so keep those exports
  unless that script moves.
- Verification: typecheck + tests after the unexport pass.

### C04 — Orphan one-off key importer

- Category: abandoned/orphan file
- Location: `src/server/import-keys.ts:1-411`
- Tier / Risk: **T2 / CAREFUL**
- Why it looks orphaned: nothing imports it, it has no `package.json` script,
  and knip lists it as an unused file. It is referenced only by `STATE.md`
  historical notes as a manual command:
  `KEYS_PATH=... pnpm tsx src/server/import-keys.ts`.
- Impact: 411 lines if deleted; otherwise no removal. It is also the only
  importer of `CURATED_MODELS`/`SKIP_MODEL_RE`, which affects C03.
- Risks: it was used to import 206 credentials and may be needed again.
  Deleting it would lose a documented operational path.
- Recommended action: **needs owner decision**. Preferred: move to
  `scripts/import-keys.ts` and add `"import:keys"` to `package.json`. Delete
  only if the one-time migration is finished and the export format is dead.
- Verification if moved: `pnpm import:keys --help`/dry import against a copy
  of the DB; do not run against production secrets during cleanup.

### C05 — Router god object and duplicated execute/stream paths

- Category: complexity + duplicate logic
- Location: `src/core/router.ts` (1,132 lines)
  - `candidates` 154-309 (156 lines)
  - `execute` 310-529 (220 lines)
  - `executeStream` 530-794 (265 lines)
  - `accountUsage` 978-1062 (155 lines)
  - jscpd clones: 325-365↔802-840 (41 lines), 385-423↔561-597 (39),
    470-513↔749-788 (44), plus several 10-16 line clones
- Tier / Risk: **T3 / RISKY**
- Why unnecessary: the non-stream and stream paths repeat candidate expansion,
  no-route handling, attempt queuing, failure classification, logging and
  accounting. `accountUsage` repeats the same four-metric block.
- Impact: potentially 200-300 net lines removed and one fallback/accounting
  path; lower risk of stream/non-stream behavior drift.
- Risks: high. Streaming cancellation, committed routes, partial SSE failures
  and quota accounting are subtle. Current tests cover routing/streaming but
  not every fallback branch.
- Recommended action: defer to a dedicated refactor branch. Extract a shared
  attempt runner and loop through the four usage metrics; do not change
  streaming semantics in the same batch.
- Verification: full suite plus new parity tests for stream vs non-stream
  fallback, cancellation and usage accounting.

### C06 — Duplicated HTTP/SSE route plumbing

- Category: duplicate logic
- Location:
  - `src/server/routes/llm.ts:48-211` (chat handler) and `212-321` (`streamChat`)
  - `src/server/routes/protocols.ts:181-259`, `262-339`, `408-488`, `489-586`
  - `src/server/routes/tools.ts:182-259`
  - jscpd clones: `llm.ts:252-263` vs `protocols.ts:430-440/511-521`;
    `protocols.ts` internal 16/19/15/14-line clones
- Tier / Risk: **T2 / CAREFUL**
- Why unnecessary: router headers, SSE response start, delta framing,
  `[DONE]`, disconnect handling and error mapping are copied across the
  OpenAI, Responses, Anthropic and tool routes.
- Impact: ~100-150 lines could be centralized; fewer protocol drift bugs.
- Risks: each protocol has a different event shape; a shared writer must stay
  protocol-specific at the envelope level. Add stream-output tests first.
- Recommended action: extract `setRouterHeaders` (already exists in
  `protocols.ts`) and a small SSE writer; leave payload shaping local.
- Verification: streaming, protocols, llm and tools tests.

### C07 — Duplicated provider table markup

- Category: duplicate logic / unused UI structure
- Location:
  - `web/src/pages/DashboardPage.tsx:373-425`
  - `web/src/pages/ProvidersPage.tsx:96-154`
  - jscpd: four 10-13 line clones
- Tier / Risk: **T2 / SAFE**
- Why unnecessary: both render the same provider row shape (state, adapter,
  key counts, 24h, success) with different columns.
- Impact: ~80 lines deduped and one place for provider health rendering.
- Risks: Dashboard omits base URL/priority and adds models; parametrize columns
  rather than force one exact layout.
- Recommended action: extract `ProviderHealthTable` with optional columns.
- Verification: typecheck/build plus browser check of both pages.

### C08 — Duplicated backend/web domain types

- Category: duplicate logic / maintainability
- Location:
  - `src/shared/types.ts:16-43,46-80,117-140,173-191`
  - `web/src/lib/types.ts:13-40,42-72,93-119,148-166`
  - jscpd: four 19-35 line clones
- Tier / Risk: **T3 / CAREFUL**
- Why unnecessary: `Capability`, `Provider`, `Account`, `Resource`,
  `ProviderResource`, quota and route shapes are hand-mirrored. The web
  `Credential` intentionally differs (redacted DTO), but the rest can drift.
- Impact: ~110 duplicated lines removed; one source of truth for API DTOs.
- Risks: the backend model includes `secretEncrypted`; the web must never
  import that type. Extract only public/redacted DTOs into a shared module.
- Recommended action: add a small shared DTO module or generated types in a
  separate refactor. Do not import backend types directly into the browser.
- Verification: typecheck both projects and API integration tests.

### C09 — SQLite row-mapper duplication

- Category: duplicate logic
- Location: `src/db/sqlite-store.ts`
  - 91-100 ↔ 107-116
  - 153-161 ↔ 173-181
  - 217-227 ↔ 238-248
  - 306-315 ↔ 345-354
  - 396-407 ↔ 428-439
  - 855-878 ↔ 886-909 (24-line clone)
- Tier / Risk: **T2 / SAFE**
- Why unnecessary: each `get`/`list` pair repeats the same snake_case →
  camelCase mapping and JSON parsing.
- Impact: ~80 lines removed; one mapping per entity.
- Risks: low; tests exercise most store reads. Add a small store unit test for
  each mapper if not covered.
- Recommended action: private `mapProvider`, `mapAccount`, `mapCredential`,
  `mapResource`, `mapProviderResource`, `mapRequestLog` helpers.
- Verification: full test suite, especially routing/burn/audit regressions.

### C10 — Duplicated adapter HTTP/auth helpers

- Category: duplicate logic
- Location:
  - `src/adapters/exa.ts:48-58` ↔ `tavily.ts:41-51` (11 lines)
  - `src/adapters/exa.ts:156-170` ↔ `firecrawl.ts:221-235` /
    `tavily.ts:221-235` (15 lines)
  - `src/adapters/openai-compatible.ts:160-172,274-298` ↔
    `src/adapters/tool-base.ts:199-210,314-338` (13/25 lines)
- Tier / Risk: **T3 / CAREFUL**
- Why unnecessary: wrapper class constructors and HTTP/error handling repeat
  near-identical code.
- Impact: ~80-120 lines deduped; consistent timeout/redaction behavior.
- Risks: auth schemes differ (`x-api-key`, Bearer, body key), streaming vs
  JSON, and provider-specific error bodies. Keep auth strategy explicit.
- Recommended action: extract shared request/timeout/error helpers only after
  adding parity tests for each adapter.
- Verification: adapter/tools/search/streaming tests with mocked fetch.

### C11 — Dashboard overfetches and duplicates `/api/overview`

- Category: redundant API calls
- Location:
  - `web/src/pages/DashboardPage.tsx:49-56` — eight polls every 15 s
  - `web/src/server/routes/management.ts:426-453` — `/api/overview`
  - `web/src/pages/DashboardPage.tsx:224-263` — overview is used only for
    requests/success/tokens/mappings/provider counts
- Tier / Risk: **T2 / SAFE**
- Why unnecessary: `/api/overview` re-lists providers, credentials, resources,
  mappings and 500 logs, while the Dashboard separately polls `/api/providers`,
  `/api/credentials`, `/api/provider-resources`, `/api/requests?limit=500`,
  `/api/quotas`, `/api/routes/counts`, `/api/adapters` and `/api/overview`.
  Measured payloads on the live DB: mappings 803 KB, logs 325 KB, credentials
  60 KB, route counts 62 KB, resources not fetched here — roughly 1.25 MB per
  15 s tick. The mapping list is only used to count mappings per provider.
- Impact: one fewer request per tick and one fewer duplicate server scan;
  avoids downloading 803 KB just for counts.
- Risks: low; metrics must stay consistent. `/api/overview` is documented, so
  keep the endpoint and stop using it from the Dashboard unless the API is
  consolidated.
- Recommended action: compute the five metrics from the already-fetched lists
  and remove the UI overview call; add per-provider mapping counts to
  `/api/providers` or `/api/overview` if needed.
- Verification: compare displayed metrics before/after; no frontend tests
  exist, so a browser check is required.

### C12 — `/api/routes` N+1 quota/health queries

- Category: redundant DB queries
- Location: `src/server/routes/management.ts:285-303`
  - per route: `store.listQuotaWindows(r.credentialId)` (line 299)
  - per route: `store.getHealth(...)` (line 300)
  - implementations: `src/db/sqlite-store.ts:546-577`, `618-632`
- Tier / Risk: **T3 / RISKY**
- Why unnecessary: one page load for `auto:free` returns 1,851 routes and
  executes ~3,700 additional SQLite queries. Live measurement:
  `GET /api/routes?resource=llm:model:auto:free&capability=llm.chat` =
  **1,053,720 bytes / 1,851 routes / 51-77 ms local**. Network/JSON parsing will
  dominate on a remote client.
- Impact: batching could reduce this to 2-3 queries and a smaller response.
- Risks: API shape and quota/health grouping; alias resources are the extreme,
  but ordinary models also pay per-route queries.
- Recommended action: add batched store methods
  (`listQuotaWindowsForCredentials`, batched health lookup) or include
  quota/health summaries in the route expansion query. Consider pagination for
  alias resources. Needs an API decision before implementing.
- Verification: route-count tests plus a live alias benchmark and full routing
  suite.

### C13 — Model detail downloads every canonical resource

- Category: redundant API call
- Location: `web/src/pages/ModelDetailPage.tsx:213-217`
  - `useApi<Resource[]>("/api/resources")`, then `.find(...)`
- Tier / Risk: **T2 / SAFE**
- Why unnecessary: live `/api/resources` is **455,902 bytes / 1,533 resources**
  just to locate one row. The page already scopes mappings and routes by id.
- Impact: single-resource response instead of 456 KB; faster detail loads.
- Risks: low. Add `GET /api/resources/:id` or support `?id=`; keep list
  endpoint for the Models/Admin pages.
- Recommended action: add a single-resource endpoint and use it here.
- Verification: API test for 200/404, then browser check model detail.

### C14 — `/api/requests/:id` has no caller or test

- Category: unused route/API
- Location: `src/server/routes/management.ts:418-425`
- Tier / Risk: **T2 / CAREFUL**
- Why unused: grep finds only the route and its docs entry (`docs/api.md:111`);
  no web caller, test or MCP caller.
- Impact: 8 lines if removed; otherwise no change.
- Risks: it is a documented management API and may be used by scripts/external
  clients. It is not safe to delete without owner confirmation.
- Recommended action: either add a management test and keep it, or remove it
  and its docs row/generated endpoint references.
- Verification if kept: test 200 and 404.

### C15 — Quality-gate drift: formatting, CI and frontend tests

- Category: tech debt
- Location:
  - `package.json:22` — `format:check` exists but fails on 30 files
  - no `.github/` workflow or other CI config (ROADMAP Phase 0 lists "basic CI")
  - `web/src/` has 37 files / ~9.6k lines and **zero** test/spec files
- Tier / Risk: **T2 / CAREFUL**
- Why it matters: the baseline is green for typecheck/lint/test/build, but
  formatting is not enforced and UI cleanup has no automated safety net.
- Impact: cleanup of web code can only rely on typecheck/build/browser checks.
- Risks: a repo-wide Prettier pass creates a large diff; do it as its own
  formatting-only commit if desired.
- Recommended action: choose one of (a) run `pnpm format` once and add
  `format:check` to the quality gate, or (b) remove `format:check` from the
  documented workflow. Add a minimal Playwright/Vitest UI smoke test before
  larger UI refactors.
- Verification: `pnpm format:check` and CI on a clean clone.

### C16 — Stale task/roadmap/status docs

- Category: stale docs
- Location:
  - `TASKS.md:238` — says "five-page IA" (now six pages incl. Admin)
  - `TASKS.md:261` — references "dashboard simulator" (UI dropped)
  - `ROADMAP.md:193-206` — lists Overview/Resources/Credentials/Quota/Policies
    pages that no longer exist
  - `ROADMAP.md:240-248` — lists Responses/streaming/Anthropic as "possible"
    though implemented
  - `README.md:66` — status dated 2026-09-25 despite the 2026-11-17 rebuild
- Tier / Risk: **T2 / SAFE**
- Why unnecessary: active docs describe the removed UI and old page model,
  which misleads the next operator/agent.
- Impact: no code; avoids wrong assumptions during cleanup.
- Risks: low; preserve historical detail in `STATE.md`/`AUDIT.md` rather than
  deleting it.
- Recommended action: refresh TASKS/ROADMAP status sections and README date.
- Verification: grep for old page names and "simulator" references.

### C17 — Local `.commandcode/` config is not ignored

- Category: repo hygiene / tech debt
- Location: `.commandcode/settings.json`, `.commandcode/taste/taste.md`
  (untracked, not matched by `.gitignore`)
- Tier / Risk: **T1 / CAREFUL**
- Why it matters: `git add .` would commit local tool permissions and personal
  taste preferences. These are not application code.
- Impact: prevents accidental local-config commits.
- Risks: if the settings are deliberately shared with the team, keep them
  tracked and document that.
- Recommended action: add `.commandcode/` to `.gitignore` unless intentionally
  shared.
- Verification: `git check-ignore -v .commandcode/settings.json`.

### C18 — Runtime/deploy config drift

- Category: tech debt
- Location:
  - `deploy/api-router.service:11` — hard-codes a version-specific fnm Node path
    (`.../node-versions/v24.16.0/...`)
  - `.env.example:2` — `PORT=3000`, while README quickstart and the systemd
    setup use `4500`
- Tier / Risk: **T2 / CAREFUL**
- Why it matters: a Node upgrade/removal breaks the service; a new install
  following `.env.example` listens somewhere other than the documented port.
- Impact: no code removal; avoids a class of "works on my machine" failures.
- Risks: systemd PATH may not include fnm; changing ExecStart needs a
  systemd-analyze/daemon-reload verification.
- Recommended action: align `.env.example` to 4500 (or document 3000
  consistently) and use a stable wrapper/absolute current-Node path.
- Verification: `systemctl --user daemon-reload`, restart, `/healthz` on 4500.

### C19 — Type-only circular imports around `AppDeps`

- Category: tech debt / architecture
- Location:
  - `src/server/app.ts:10-13` imports route registrars
  - `src/server/routes/{llm,management,protocols,tools}.ts` import
    `type { AppDeps } from "../app.js"` (e.g. `llm.ts:11`)
- Tier / Risk: **T2 / SAFE**
- Why unnecessary: madge reports four cycles, but all are `import type`, so
  runtime is fine. Still, it couples route modules back to the app factory.
- Impact: move `AppDeps` to `src/server/deps.ts`; zero runtime change.
- Risks: low; a type-only refactor.
- Recommended action: extract `AppDeps` and import it from both sides.
- Verification: typecheck + build + madge should report 0 cycles.

## Items needing owner decisions

1. `src/server/import-keys.ts` — keep/move/delete (C04).
2. `/api/routes` response shape and batching (C12); this is the largest live
   performance issue.
3. `/api/requests/:id` — keep with a test, or remove (C14).
4. Shared API DTO module vs duplicated types (C08).
5. Router execution/stream consolidation scope (C05).
6. `.commandcode/` should be ignored or committed (C17).
7. CI/frontend test approach (C15).
8. Deploy Node path/port documentation (C18).

## Things checked and found clean

- No `TODO`/`FIXME`/`HACK`/`XXX` markers anywhere in `src`, `web/src`, `tests`
  or docs.
- No skipped/todo tests; 126 tests pass, and every test file contains
  assertions.
- No `any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` or `eslint-disable`
  in source/tests.
- No swallowed `catch {}` blocks; no `console.*` in the web app (server console
  output is startup/CLI only).
- No duplicate HTTP/date libraries; the web uses one typed fetch client plus
  two intentional streaming fetches in Playground.
- No unused DB tables: all 9 schema tables are referenced. `routes` is derived,
  not a table, consistent with `docs/data-model.md`.
- No generated/tracked build output: `dist/`, `web/dist/`, `data/`, `*.db` and
  `.firecrawl/` are ignored. `.firecrawl/` is a deliberate local API-reference
  cache referenced by `STATE.md`.
- No runtime circular dependencies; the four madge cycles are type-only (C19).
- `/api/routing/simulate` is not dead: tests use it and docs document it. The
  UI simulator was intentionally dropped.
- `POST /api/providers` is intentionally backend-only, not a dead endpoint.
- The only unused direct dependency found was `pino`; web dependency warnings
  from knip are false positives because the root project does not include the
  web tsconfig.
- All route/API additions from the dashboard rebuild are covered by
  typecheck/lint/build and the 126-test suite; the Admin page was manually
  exercised end-to-end (create model + route, verify DB, delete test row).
- No duplicate CSS clones were found by jscpd (0 CSS clone pairs), despite the
  two ~1k-line stylesheets.

## Recommended cleanup plan

**Precondition:** commit/stash the current refactor first. The worktree has
34 modified files, 3 deleted `public/*` files, and untracked `web/`, `deploy/`,
`tests/audit-regressions.test.ts` and `tsconfig.build.json`. Do not start
cleanup on an uncommitted tree.

**Batch 1 — safe deletes (T1):**
- C01 dead web exports/icons/CSS
- C02 `pino`
- C03 `timingSafeCompare` (and optional unexport pass)
- C17 `.gitignore` decision
- Verify: typecheck, lint, tests, build, browser spot-check.

**Batch 2 — low-risk consolidation (T2):**
- C07 provider table extraction
- C09 SQLite row mappers
- C11 Dashboard overview/mapping overfetch
- C13 single-resource endpoint
- C14 request-detail decision
- C16 stale docs
- C15 formatting/CI decision
- Verify after each item, not just at the end.

**Batch 3 — focused refactors (T3):**
- C12 batched route quotas/health
- C06 shared SSE/header helpers
- C10 adapter HTTP/auth helpers
- C08 shared DTO types
- C05 router execute/stream consolidation
- Each on its own branch/commit with parity tests.

Do not start Batch 3 until Batches 1–2 are green and committed.
