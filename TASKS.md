# TASKS.md

## Next session (saved 2026-09-29)

Key rotation per provider is in. Next time, add more upstreams on the same pattern: one provider, many API keys, rotate per request, fail over to the next key.

### More AI providers

- [ ] Add other AI providers the same way Gemini/Groq/OpenRouter work today (OpenAI-compatible chat where the API matches, a native adapter where it does not).
- [ ] Each new AI provider gets its own base URL, its own key pool, and the same per-request key rotation.
- [ ] Register models from that provider so a client can point at this router's base URL, send one key, and name the model.

### More tools (Firecrawl, Tavily, Exa, and other random tools)

- [ ] Firecrawl: adapter, credential check, and the capabilities it actually supports (`web.scrape`, `web.crawl`, `web.map`, search only if the API has it). See the unchecked P2 Firecrawl list below.
- [ ] Tavily and Exa: adapters and tests already exist for `web.search`. Next step is live keys in the pool and the same key rotation those LLM providers now use.
- [ ] Leave room for more one-off tools later (extract, scrape, crawl, and whatever else shows up). A new tool is a capability plus an adapter, not a change to route selection.
- [ ] Do not pretend these tools are interchangeable. A route is eligible only when that provider supports the capability being asked for.

---

## P0 — Start here (done 2026-09-22)

- [x] Initialize TypeScript project.
- [x] Select server framework. (Fastify)
- [x] Select DB layer. (better-sqlite3 behind `Store` interface; PG = new impl)
- [x] Add migrations. (idempotent schema, `pnpm db:migrate`)
- [x] Add Zod or equivalent runtime schemas.
- [x] Add Vitest.
- [x] Add lint/format commands. (eslint + prettier configured)
- [x] Add `.env.example`.
- [x] Add secure master-key mechanism for credential encryption. (AES-256-GCM)
- [x] Create health endpoint. (`GET /healthz`)

---

## P0 — Domain model (done)

- [x] Implement `Provider`.
- [x] Implement `Account`.
- [x] Implement `Credential`.
- [x] Implement `Resource`.
- [x] Implement `ProviderResource`.
- [x] Implement executable `Route`.
- [x] Add enable/disable state.
- [x] Add timestamps.
- [x] Add DB constraints and indexes.

Acceptance:

- one canonical resource can map to multiple providers
- one provider can have multiple accounts
- one account can have multiple credentials

---

## P0 — Provider SDK (done)

- [x] Define provider adapter interface.
- [x] Define normalized request/response types.
- [x] Define provider error categories.
- [x] Define credential validation result.
- [x] Define quota observation format.
- [x] Add provider registry.
- [x] Add adapter unit-test harness. (mocked `fetchImpl` in `tests/helpers.ts`)

---

## P0 — First LLM provider (done: generic OpenAI-compatible adapter serves Groq)

- [x] credential validation
- [x] chat completion request
- [x] normalized response
- [x] error classification
- [ ] optional model discovery
- [x] tests with mocked upstream

Do not depend on a real secret for automated tests.

---

## P0 — LLM API (done)

- [x] `POST /v1/chat/completions`
- [x] parse canonical model
- [x] parse `provider::model`
- [x] route resolution
- [x] actual provider execution
- [x] `X-Router-Via`
- [x] request ID
- [x] request log
- [x] OpenAI-style error response

---

## P0 — Routing semantics tests (done, `tests/routing.test.ts`)

Add tests for:

- [x] automatic route
- [x] provider pin
- [x] unknown provider
- [x] unknown model
- [x] disabled route
- [x] invalid credential
- [x] provider-pinned request never crosses provider
- [x] multiple credentials under one provider
- [x] retryable failure selects another eligible route
- [x] non-retryable bad request does not spray retries

---

## P1 — Second LLM provider (done: OpenRouter shares the generic adapter)

- [x] map same canonical model across two providers
- [x] automatic provider choice
- [x] provider-specific upstream model IDs
- [x] fallback between providers
- [x] per-provider request statistics (request logs + usage events)

---

## P1 — Health and cooldown (done)

- [x] latency tracking
- [x] success/failure tracking
- [x] failure classification
- [x] cooldown state
- [x] consecutive failure threshold (cooldown escalation)
- [x] route recovery (success clears cooldown)
- [ ] health status API (health visible via `/api/routes`; dedicated endpoint pending)

---

## P1 — Quotas (done, plus live rate windows 2026-09-22)

- [x] quota window table
- [x] generic quota metrics
- [x] reset timestamps
- [x] hard exhaustion
- [x] manual configured quota
- [ ] response-header observations
- [ ] provider quota polling hook (`getQuota` optional exists, not wired)
- [x] unknown quota handling
- [x] usage event storage
- [x] rolling rate enforcement from usage_events (minute/hour/rolling/configured-day)
- [x] usage stats API

---

## P1 — Burn routing (done, `tests/burn.test.ts`)

- [x] policy interface
- [x] `burn` policy
- [x] `priority` policy
- [x] balanced `auto` policy (plus `preserve`/`fast`/`reliable`/`cheap`)
- [x] human-readable score explanation
- [x] routing simulation endpoint (`POST /api/routing/simulate`)
- [x] tests around reset timing

Test scenario:

```text
A = 93% remaining, reset 3d
B = 15% remaining, reset 10d
C = 40% remaining, reset 18d
```

Expected:

Under `burn`, A should receive strong preference assuming it is healthy and otherwise eligible.

---

## P2 — Generic tool path (done 2026-09-22, `tests/search.test.ts`)

- [x] capability registry (`web.search` resource + provider mappings)
- [x] normalized `web.search`
- [x] `/v1/tools/search`
- [x] provider pin option
- [x] generic tool response envelope

---

## P2 — Exa (done: adapter + tests, no live key in export)

- [x] adapter
- [x] credential validation (minimal 1-result probe)
- [x] web.search
- [ ] supported quota discovery (no key to probe with)
- [x] tests

---

## P2 — Tavily (done: adapter + tests, no live key in export)

- [x] adapter
- [x] credential validation (minimal 1-result probe)
- [x] web.search
- [ ] supported quota discovery (no key to probe with)
- [x] tests

---

## P2 — Firecrawl (done 2026-09-29, `tests/tools.test.ts`)

- [x] adapter (`src/adapters/firecrawl.ts` via `defineToolAdapter`, v2 API, Bearer)
- [x] credential validation (minimal `/v2/search` probe)
- [x] supported capabilities (search/scrape/extract/crawl/map — no pretending)
- [x] web.search (with scraped markdown)
- [x] web.scrape (`/v2/scrape`)
- [x] web.extract (scrape fan-out, per-URL errors captured)
- [x] web.crawl (async job + server-side poll to completion)
- [x] web.map
- [x] quota observations (usage accounting: searches/pages/crawl_units; provider quota API polling still open)
- [x] tests

## P2 — Plug-and-play tools (done 2026-09-29)

- [x] `defineToolAdapter()` factory (`src/adapters/tool-base.ts`): auth builders, timeout fetch, error classification, validation probe, crawl polling
- [x] exa/tavily rewritten on the factory + extended (exa scrape/extract via `/contents`; tavily extract/crawl/map/scrape)
- [x] generic table-driven tool routes (`POST /v1/tools/{search,scrape,extract,crawl,map}`)
- [x] per-capability usage accounting in the router core
- [x] new provider = one adapter file + one boot line + mappings (proven by contract test)

## P2 — MCP server (done 2026-09-29, `tests/mcp.test.ts`)

- [x] stdio MCP wrapper (`src/server/mcp.ts`, `pnpm mcp`): `web_search/scrape/extract/crawl/map` + `chat`
- [x] thin forwarder — all routing stays in the core, zero routing logic in MCP layer
- [x] optional `provider`/`policy` passthroughs per tool
- [x] tests via in-memory transport against a live app (list/call/error paths)

---

## P3 — Dashboard (v1 done 2026-09-22, static UI at `/dashboard`)

- [x] resource list
- [x] resource detail (per-route quota, reset countdown, health, latency)
- [x] provider list (+ add/edit/enable/delete)
- [x] credential management (+ live validate, enable/disable)
- [x] quota display (+ add/delete)
- [x] reset countdown
- [x] routing policy editor (runtime default + per-request simulator)
- [x] request history (+ detail)
- [x] test request UI
- [x] health indicators (cooldown/fails/latency per route)
- [ ] account display-name editing (minor, skipped)

---

## Required quality gates

Before marking any milestone complete:

- [x] relevant tests pass (53/53, 2026-09-25)
- [x] no API keys appear in logs (redaction covered by `tests/security.test.ts`)
- [x] errors are normalized (OpenAI envelope + Anthropic shim, tested)
- [x] new provider adapter has tests (openai-compatible, exa, tavily)
- [x] `STATE.md` updated
- [x] API changes documented (`docs/api.md` + dashboard simulator)
