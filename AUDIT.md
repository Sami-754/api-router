# TypeScript Audit — 2026-10-10

Baseline: `tsc --noEmit` clean, `eslint` clean, 70/70 tests pass, `strict: true` already on.
Scope: all 30 files under `src/`.

## High — real bugs

### 1. Double failure counting (non-stream path)
- `src/core/router.ts:359` — `execute()` catch calls `store.recordFailure(...)` directly
- `src/core/router.ts:604` — then calls `noteAttemptFailure()`, which calls `store.recordFailure(...)` again
- Impact: every failed attempt bumps `failure_count` / `consecutive_failures` **twice** in `health_snapshots`, so reliability scores decay 2x too fast on the non-stream path (the stream path in `executeStream` calls it only once — inconsistent).
- Fix: remove the direct `recordFailure` call at `:359` and rely on `noteAttemptFailure()` (which also handles the 401 → mark-invalid logic).

### 2. Quota usage not scoped by provider resource
- `src/db/sqlite-store.ts:511-517` — `incrementQuotaUsage` updates `WHERE credential_id = ? AND metric = ?` with **no `provider_resource_id` predicate**. A quota window scoped to model A gets inflated by traffic from model B on the same key → false "quota exhausted".
- `src/db/sqlite-store.ts:637-644` — `sumUsage` has the same missing scope, so live rate checks (`rateChecksFor` in `src/core/quota.ts:133`) count cross-resource usage, while static checks (`quotaViewForRoute`) filter windows by scope. The two enforcement paths disagree for resource-scoped windows.
- Callers that pass the scope correctly: `router.ts` `accountUsage()` (`:629`) and `executeStream().finish` (`:487`) both have `route.providerResourceId` available.
- Fix: add optional `providerResourceId` filter to `incrementQuotaUsage` and `sumUsage` (count events where `provider_resource_id IS NULL` OR matches the scoped resource), and thread it from the router call sites.

### 3. SSRF guard is dead code
- `src/shared/config.ts:24` — `validateBaseUrl()` exists (blocks `localhost`, `169.254.169.254`, `127.*`, credentials-in-URL, non-http(s)) but is **never called** (grep confirms single hit at definition).
- `src/server/routes/management.ts:23` (`POST /api/providers`) and `:36` (`PATCH /api/providers/:id`) accept arbitrary http(s) URLs.
- AGENTS.md security rules explicitly require: "Validate user-supplied custom base URLs" / "Protect against SSRF if arbitrary/custom endpoints are supported".
- Fix: call `validateBaseUrl()` on `baseUrl` in provider create/patch (reject with 400), and on `entries[0].baseUrl` in `import-keys.ts:172`.

## Medium

### 4. Dead branch in HTTP error classification (403 misclassified)
- `src/provider-sdk/error-classify.ts:21` — `if (status === 401 || status === 403) return retryableFor("auth", false);` short-circuits before `:36` (`if (status === 402 || status === 403)` quota/credit body check), so the `403` arm of that branch is unreachable.
- Impact: providers that signal exhausted credits/balance via 403 (common) are classified `auth` → client receives 401 instead of 429, key gets 10-min auth cooldown instead of 5-min quota cooldown.
- Fix: move the quota/credit body check for 403 ahead of the auth return, or drop `403` from line 21 and let the body sniff decide (keep 401 as auth).

### 5. Failed stream attempts are invisible in request logs
- `src/core/router.ts:413-528` — `executeStream` only writes a request log via `noRouteError()` (zero eligible routes) or `finish()` (after first chunk commits). If all attempts fail **before** the first chunk, it throws `lastError` with no `appendRequestLog`.
- Impact: pre-first-chunk stream failures never appear in `/api/requests`, unlike the non-stream path which logs `${requestId}:attempt${n}`.
- Fix: log failed attempts in the `executeStream` catch (or before throwing `lastError`), mirroring `execute()`.

### 6. Stream accounting records fewer metrics
- `src/core/router.ts:487-490` — `finish()` records `requests` + `total_tokens` only; the non-stream `accountUsage()` (`:629-683`) also records `input_tokens` / `output_tokens` and the tool metrics (searches/pages/crawl_units).
- Fix: mirror the `accountUsage()` metric set inside `finish()` (it already has `usage`).

## Low

### 7. Dead exports / dead code
- `src/shared/crypto.ts:49` `redactSecret` — exported, never used.
- `src/core/quota.ts:75` `hasHardExhaustion` — exported, never used (trivial wrapper around `.exhausted`).
- `src/core/router.ts:357-358` — `const latencyMs = Date.now() - opStart; void latencyMs;` computed and discarded in `execute()` catch.

### 8. Formatting
- `prettier --check "src/**/*.ts"` fails on ~18 files (project has `format`/`format:check` scripts).
- Statements jammed onto one line: `src/adapters/openai-compatible.ts:90`, `src/db/sqlite-store.ts:352/474/625`, `src/server/routes/management.ts:12` (two imports on one line), `src/server/boot.ts:145`.

### 9. Duplicated token-estimate logic
- `src/server/routes/llm.ts:231` `estimateTokens` (adds `maxTokens ?? 1024`) vs `src/core/router.ts:719` `estimateTokensOf` (no maxTokens term) — same concept, different behavior; consolidate.

### 10. Optional hardening (not enabled in tsconfig)
- `tsc --noUncheckedIndexedAccess` flags ~12 spots, e.g. `src/server/import-keys.ts:161` (`first.key` on possibly-empty `entries` — safe in practice because `byPlatform` only holds non-empty arrays, but unguarded), `tests/burn.test.ts:38`, `tests/dashboard.test.ts:55`.

### 11. Perf note (prototype-acceptable)
- `Router.candidates()` does per-route `getProviderResource` + `listQuotaWindows` + `sumUsage` queries (N+1). Fine for local SQLite; batch if route counts grow.

## Suggested fix order
1. #1 (one-line removal) → 2. #3 (wire existing function) → 3. #2 (quota scoping, touches Store interface + SQLite impl + 2 router call sites) → 4. #4 (reorder two conditions) → 5. #5/#6 (stream observability/accounting) → 6. #7-#10 cleanup.
