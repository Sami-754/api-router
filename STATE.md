# STATE.md

## Current status

Project stage: **plug-and-play tools (2026-09-29)**

Tool APIs researched from live docs (base URLs, auth, endpoints, response
shapes — scrapings in `.firecrawl/`, gitignored): Exa (`https://api.exa.ai`,
`x-api-key`, `/search` + `/contents`), Tavily (`https://api.tavily.com`,
Bearer, `/search` `/extract` `/crawl` `/map`), Firecrawl
(`https://api.firecrawl.dev`, Bearer v2, `/v2/search` `/v2/scrape`
`/v2/crawl`+poll `/v2/map`).

New `defineToolAdapter()` factory (`src/adapters/tool-base.ts`): a new tool
provider is one adapter file + one boot line + mappings — no core/route/quota
edits (proven by contract test). Exa/Tavily rewritten on it and extended;
Firecrawl added with all five capabilities. Generic table-driven routes
`POST /v1/tools/{search,scrape,extract,crawl,map}`; per-capability usage
accounting (`searches`/`pages`/`crawl_units`). 67/67 tests green,
`pnpm typecheck` clean.

The running server must be restarted to pick this up (also runs
`ensureToolResources()` for the new `web.*` capability rows on boot).

Live on `http://127.0.0.1:4500` (PORT=4500 in `.env`, data in
`./data/router.db`, 14 providers / 206 credentials / 1457 mappings).
Dashboard at `/dashboard` (admin token = `ADMIN_TOKEN` in `.env`).

Last incident: dashboard resources page fired ~1300 `/api/routes` requests
(one per row) and tripped the global rate limiter (224× HTTP 429, recovered
on its own). Fixed with batched `GET /api/routes/counts`, one-shot 429
retry in the dashboard client, and global cap 300 → 1000/min. Lesson: list
views must never N+1 the routes endpoint.

## Dashboard rebuild (2026-09-29)

Full static-UI rewrite, still dependency-free (`public/index.html +
styles.css + app.js`, no build step — deliberately no CDN kit so the
dashboard works on offline/LAN setups). 8 pages → 6
(Overview, Playground, Resources, Providers & Keys, Quotas & Usage,
Requests) + Settings as a modal. Providers/Credentials merged into one
account→key tree; Playground promoted to first-class with chat + all five
tool tabs (search/scrape/extract/crawl/map); resource detail is
capability-aware with inline routing simulation. Design: ink + signal-lime
dark console, no inline handlers (delegated events). Preserved behaviors:
batched `/api/routes/counts`, one-shot 429 retry, 401 → token modal,
redacted secrets. Live on `:4500` with no restart (static read per request).
`node --check` clean, all `/api/*` calls verified against
`src/server/routes/management.ts`.

---

## Implemented

- Single-package TypeScript layout (`src/shared`, `src/provider-sdk`,
  `src/core`, `src/adapters`, `src/server`, `src/db`) — module boundaries
  preserved without monorepo tooling. Stack: Fastify, Zod, better-sqlite3,
  Vitest, pnpm.
- Canonical resources vs provider resources vs executable routes; route
  expansion over provider × account × credential.
- `ProviderRegistry`; generic `OpenAICompatibleAdapter` serving both Groq and
  OpenRouter (one class, two registrations — template for new providers).
- `POST /v1/chat/completions` (non-streaming), `GET /v1/models`,
  `X-Router-Via/Policy/Attempts/Request-ID`, OpenAI-style errors.
- Eligibility-before-scoring; pinned requests never cross providers unless
  `allowCrossProviderFallback: true`; credential-pinned = single attempt;
  non-retryable errors never spray retries; `auth` marks credential `invalid`.
- Health snapshots + cooldowns; generic quota windows with reset times;
  unknown quota stays eligible; usage + request logs with redacted secrets.
- AES-256-GCM credential encryption (`MASTER_KEY`), timing-safe admin token,
  1 MiB body limit, base-URL SSRF guards.
- Management APIs: providers, accounts, credentials (redacted), resources,
  provider-resources, routes, `POST /api/routing/simulate`, quotas, requests.
- Demo seed: `llm:model:nemotron-3-super-120b` → groq + openrouter mappings
  and `groq-main` / `openrouter-main` accounts (credentials via
  `POST /api/credentials` or `GROQ_API_KEY` / `OPENROUTER_API_KEY` env).

---

## Product definition

We are building a self-hosted API router and quota orchestrator.

Primary goals:

- route one logical resource across multiple providers
- allow exact provider pinning
- support multiple accounts/credentials/endpoints
- use quota intelligently before reset
- support graceful fallback
- expose OpenAI-compatible LLM APIs
- support non-LLM tools through the same routing core
- make new providers easy to add

The product is broader than an LLM router.

---

## Confirmed first use cases

### LLM routing

Example logical model:

```text
nemotron-3-super-120b
```

Possible provider routes:

```text
groq
openrouter
another provider/endpoint
```

The user needs both:

```text
nemotron-3-super-120b
```

for automatic routing, and:

```text
groq::nemotron-3-super-120b
```

for exact provider selection.

### Tool routing

Initial tool/provider candidates:

- Exa
- Tavily
- Firecrawl

Capabilities should be modeled independently, e.g.:

```text
web.search
web.extract
web.scrape
web.crawl
web.map
```

---

## Important product behavior

Quota must be reset-aware.

Example reasoning:

```text
Provider A: high remaining quota, resets in 3 days
Provider B: low remaining quota, resets in 10 days
```

It may be better to consume A aggressively before its quota disappears.

This routing policy is called `burn`.

---

## Decisions already made

- canonical resources are separate from provider-specific resource IDs
- provider separator for LLM model pinning: `::`
- provider-specific route selection is first-class
- quotas are represented as generic quota windows
- provider adapters isolate provider-specific behavior
- routing policies must be pluggable
- eligibility filtering happens before route scoring
- exact pinning should not silently cross providers
- non-LLM capabilities use the same router core
- OpenAI compatibility is important
- deterministic routing is preferred over an LLM classifier for MVP

---

## Suggested initial stack

Locked for Slice 1 (single-package, pnpm):

- TypeScript + Node 20+
- Fastify (+ @fastify/cors, @fastify/rate-limit)
- better-sqlite3 behind the `Store` interface (PostgreSQL migration = new
  `Store` implementation, no caller changes)
- Zod, Vitest, tsx
- No Redis, no ORM (hand-rolled SQL, idempotent schema in `src/db/schema.ts`)

---

## Test status

`pnpm test` — 70 tests, all passing (2026-09-29):

- `model-string` (5): canonical parse, `::` pin, slash ids, rejection cases
- `routing` (14): auto-route, provider pin, unknown provider/model, disabled
  route, invalid credential, multi-credential, pinned-no-crossing, fallback
  on 429, no-retry on 400, per-provider key rotation, 401 failover, full-pool
  walk on 429
- `burn` (3): A(93%/3d) preferred over B(15%/10d) and C(40%/18d); hard
  exhaustion ineligible; unknown quota eligible
- `security` (4): encryption round-trip, secrets never in API/logs, route
  recorded in history
- `api` (2): health/models/routes/quotas/requests; cooldown exclusion
- `tools` (10): scrape/extract/crawl/map across exa+tavily+firecrawl, fallback, validation, accounting, plug-and-play contract
- `mcp` (3): six tools listed/called through the routing core, unmapped capability surfaces as tool error

---

## Freellmapi import (2026-09-22)

Imported `/home/sami/Downloads/freellmapi-keys.json` (206 keys, source file
untouched) via `pnpm tsx src/server/import-keys.ts`: 206 credentials
(AES-256-GCM in `data/router.db`), 1 account per (platform, label), 1457
provider mappings from live `/models` discovery. `boot()` auto-registers an
OpenAI-compatible adapter per provider DB row — adding a provider is now one
DB row, no code.

Verified base URLs (all OpenAI-compatible `/v1`):

| provider | baseUrl | status |
|---|---|---|
| agnes | `https://apihub.agnes-ai.com/v1` | live (chat 200) |
| cloudflare | `https://api.cloudflare.com/client/v4/accounts/{acct}/ai/v1` (acct split from `acct:token` key) | live (chat 200) |
| cohere | `https://api.cohere.com/compatibility/v1` | creds only — `/v1/models` 200 on `cohere_` keys but compat chat 404s; no routes wired |
| lan-ollama | `http://192.168.0.117:11434/v1` (from export's `custom` entry) | live (chat 200) |
| google | `https://generativelanguage.googleapis.com/v1beta/openai/` | live — both `AIza` and `AQ.Ab` OAuth keys chat 200 |
| groq | `https://api.groq.com/openai/v1` | keys answer 403 error 1010 = Cloudflare edge block on this egress IP, may work elsewhere; 9 curated models, unverified |
| huggingface | `https://router.huggingface.co/v1` | live, but first key 402 (credits depleted); 402 classifies as quota_exhausted → fallback handles it |
| mistral | `https://api.mistral.ai/v1` | live (chat 200) |
| nara | `https://router.bynara.id/v1` (not `router.naraya.ai` — DNS dead) | live (chat 200) |
| ollama | `https://ollama.com/v1` (Ollama Cloud) | live (chat 200) |
| opencode | `https://opencode.ai/zen/v1` | 403/edge-blocked here; 14 curated free models, unverified |
| openrouter | `https://openrouter.ai/api/v1` | live (430 models discovered) |
| requesty | `https://router.requesty.ai/v1` (model ids need `vendor/model`) | live (670 models; free ones incl. `nvidia/nemotron-3-super-120b-a12b`) |
| xkiro | `https://api.xkiro.com/v1` | 403/edge-blocked here; 7 curated models, unverified |

Live E2E: `nvidia/nemotron-3-super-120b-a12b` auto-routed across 27 routes,
fell back over 2 dead keys, succeeded via openrouter on attempt 3; failed
keys now in cooldown (visible in `/api/routing/simulate` filtered list).

---

## Dashboard (2026-09-22)
`GET /dashboard` — dependency-free static UI (no build step,
`public/index.html + styles.css + app.js`), served by the router itself.
Pages: Overview, Resources (+ per-route quota/reset/health), Providers
(+ accounts/keys/validate), Credentials, Quotas, Requests, Routing simulator
+ test-request box, Settings (runtime default policy, token mgmt).
New APIs for it: `GET /api/overview`, `GET/PATCH /api/settings`,
`POST /api/credentials/:id/validate`, `DELETE /api/quotas/:id`,
`PATCH/DELETE /api/provider-resources/:id`, `DELETE /api/resources|accounts|providers/:id`
(all cascade). 30/30 tests green.

---

## Big-six build-out (2026-09-22, 52/52 tests green, live on :4500)

1. **Per-key rate tracking** — `usage_events` now drive rolling enforcement:
   `rolling_seconds`/`calendar_minute|hour` and router-configured daily caps
   are evaluated live (`isRateWindow` in `src/core/quota.ts`) and reset when
   the window rolls; explicit `remainingValue` and provider-reported
   week/month windows stay static. Pinned-but-pressured requests return 429
   (not 404). `GET /api/usage` exposes live sums.
2. **web.search slice** — `ExaAdapter` + `TavilyAdapter` through the unchanged
   core, `POST /v1/tools/search` with provider pin + fallback. No Exa/Tavily
   keys in the export, so adapters are live-ready but unmapped.
3. **Streaming** — `stream=true` SSE passthrough; router commits on first
   chunk, never retries across providers after commit; mid-stream failures end
   the stream and are logged against the committed route. Verified live.
4. **Protocols** — `POST /v1/responses` (OpenAI shim) and `POST /v1/messages`
   (Anthropic shim, native error envelope), both with minimal streaming event
   subsets and `provider::model` pins.
5. **Validation job** — `POST /api/maintenance/validate {provider?, limit?,
   maxAgeHours?}` (staggered, skips fresh); optional interval via
   `VALIDATE_INTERVAL_H`/`VALIDATE_BATCH` (off by default). Dashboard has a
   per-provider "Validate all stale keys" button.
6. **Dashboard v2** — visual overhaul (gradient cards, quota bars, 24h
   histogram, status pill) + search test box, live streaming test output,
   usage lookup, validation runner.

---

## Open decisions / next (Slice 3+)

- Response-header quota ingestion and provider quota polling hooks not yet
  wired (`QuotaSnapshot` shape exists, `getQuota` optional on adapters).
- Tool calling passthrough, embeddings, vision — deferred per ROADMAP Phase 8.
- Firecrawl scrape/crawl adapters next (search path already proves the pattern).

---

## Immediate next milestone

Saved 2026-09-29. See the "Next session" section at the top of `TASKS.md`.

1. More AI providers, each with its own base URL and key pool, using the same per-request key rotation.
2. More tools on the same router: Firecrawl (scrape/crawl/map), live Tavily and Exa search keys, and other one-off tools as they come up. A tool is a capability plus an adapter. Do not treat different tools as the same API.

---

## Current blockers

None known.

---

## Risks to watch

### Over-generalization

Do not build an enormous plugin framework before one end-to-end request works.

### Provider mismatch

Do not pretend similar providers expose identical features. Use capabilities.

### Secret leakage

Do not log or return raw upstream API keys.

### Ambiguous routing

Do not silently cross providers for explicitly pinned requests.

### Quota precision

Provider quota APIs may be incomplete or unavailable. The system must support:

- provider-reported quota
- learned quota
- manually configured quota
- unknown quota

Unknown quota must not be treated as zero.

---

## Session handoff (2026-09-25, bugfix + UI pass)

- Fixed `public/app.js`: `validateCred` was never closed — `loadStatus()`
  and the initial `router()` call were nested inside it, so the sidebar
  health pill never went online and validating a key re-rendered the page.
  Status now mirrors to the new topbar pill too.
- Fixed `pnpm lint`: flat config had no TS parser (every file errored).
  Added `typescript-eslint`, rewrote `eslint.config.js`, fixed lint script
  (`eslint src tests` — v9 has no `--ext`).
- Dashboard overhaul (still dependency-free, no build step): SVG nav icons
  instead of emoji soup, sticky mobile topbar + drawer nav, admin-token
  modal instead of the banner bar, loading skeletons, empty states,
  copy-to-clipboard on credential IDs, low-quota bar coloring, scrollable
  tables on small screens, focus-visible states, reduced-motion support.
- Docs: README now shows 53 tests + port 4500 examples; `docs/api.md`
  notes the configured-port default; gateway `HTTP-Referer` no longer
  claims `localhost:3000`; TASKS.md quality gates checked off.
- Server: was down at session start; restart the same way (never `pkill -f`
  the un-bracketed pattern — it matches its own command line and kills the
  shell; use `pkill -f "server/mai[n].ts"`).
- Env: `.env` (chmod 600) holds generated MASTER_KEY + ADMIN_TOKEN.
- Keys source: `/home/sami/Downloads/freellmapi-keys.json` (never copied
  into the repo); re-import with
  `KEYS_PATH=... pnpm tsx src/server/import-keys.ts` (idempotent).
- Gottchas: Fastify `app.inject` in tests vs hijacked SSE (covered by
  `tests/streaming.test.ts` pull-based mock); `ReadableStream.error()` in
  `start()` drops queued chunks; `@types/better-sqlite3` needs
  `declaration: false`; dashboard must use `/api/routes/counts`, not per-row
  `/api/routes`.
- Test status: 53/53 green, `pnpm typecheck` clean.

---

## Update rules for this file

After significant implementation work, update:

- current stage
- implemented features
- known bugs
- open decisions
- next milestone
- test status
- migrations/API changes

Keep this file concise enough that a new coding agent can understand project state in under two minutes.
