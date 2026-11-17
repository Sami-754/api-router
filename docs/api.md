# API reference

Base URL: `http://127.0.0.1:4500` by default (see `PORT`/`HOST` in `.env`;
`.env.example` ships `PORT=4500` — the examples below use your configured port).

No auth: `/api/*`, `/v1/*` and `/healthz` are all public by design.
This is a local-first single-user service — bind to loopback (`HOST=127.0.0.1`)
or trust the local network instead of adding tokens.

## LLM compatibility

### `GET /v1/models`

Lists canonical LLM resources in OpenAI list shape. `id` is the logical model
name (canonical id minus the `llm:model:` prefix).

### `POST /v1/chat/completions`

OpenAI-compatible chat completion (non-streaming). Body is the usual OpenAI
shape plus an optional router extension:

```json
{
  "model": "nemotron-3-super-120b",
  "messages": [{"role": "user", "content": "hello"}],
  "routing": {
    "provider": "groq",
    "account": "groq-main",
    "credential": "cred-groq-main",
    "policy": "burn",
    "allowCrossProviderFallback": false,
    "estimatedCost": 2000
  }
}
```

Model forms:

- `"nemotron-3-super-120b"` — auto-route the canonical model.
- `"groq::nemotron-3-super-120b"` — pin to provider `groq`.
- `"auto:free"` — virtual alias fanning out across every enabled free-tier
  model (rebuilt from live mappings on each boot).
- `"openrouter::nvidia/nemotron-3-super-120b"` — `::` separator keeps working
  when ids contain `/`.

Equivalent routing headers: `X-Router-Provider`, `X-Router-Account`,
`X-Router-Credential`, `X-Router-Policy`. Body `routing` wins over headers;
the `provider::model` pin applies when neither sets a provider.

Response headers:

- `X-Router-Via: groq/nvidia/nemotron-3-super-120b`
- `X-Router-Policy`, `X-Router-Attempts`, `X-Router-Request-ID`

Errors use the OpenAI envelope: `{ "error": { "message", "type", "code" } }`.

`stream=true` is supported (SSE `text/event-stream`, OpenAI chunk shape +
`[DONE]`). The router commits to one route on the first upstream chunk — no
cross-provider retry after the client has headers. Mid-stream failures end
the stream and are logged against the committed route.

## Protocols

- `POST /v1/responses` — OpenAI Responses API shim (`{model, input, stream?}`).
- `POST /v1/messages` — Anthropic Messages API shim (`{model, messages, max_tokens, stream?}`).
  Errors use Anthropic's `{type: "error", error: {...}}` envelope.

## Generic tools

Same routing core as LLMs (eligibility → policy score → key rotation →
fallback), capability-addressed. Provider pin via `routing.provider` or
`X-Router-Provider`. Capabilities overlap but are NOT identical per provider:

| Capability | Exa | Tavily | Firecrawl |
|---|---|---|---|
| `web.search` | ✅ `/search` | ✅ `/search` | ✅ `/v2/search` |
| `web.scrape` | ✅ `/contents` | ✅ `/extract` | ✅ `/v2/scrape` |
| `web.extract` | ✅ `/contents` | ✅ `/extract` | ✅ scrape fan-out |
| `web.crawl` | ❌ | ✅ `/crawl` | ✅ `/v2/crawl` (async, polled) |
| `web.map` | ❌ | ✅ `/map` | ✅ `/v2/map` |

- `POST /v1/tools/search` — `{query, maxResults?, includeDomains?, excludeDomains?, recencyDays?, routing?}`
- `POST /v1/tools/scrape` — `{url, maxChars?, onlyMainContent?, routing?}` → `{object: "scrape.result", url, title?, markdown}`
- `POST /v1/tools/extract` — `{urls[1..20], query?, routing?}` → `{object: "extract.results", results: [{url, content, title?, error?}]}`
- `POST /v1/tools/crawl` — `{url, limit?, includePaths?, excludePaths?, routing?}` → `{object: "crawl.results", pages: [{url, markdown?, title?}]}` (Firecrawl jobs are polled to completion server-side, up to the request timeout)
- `POST /v1/tools/map` — `{url, limit?, routing?}` → `{object: "map.results", links: [{url, title?}]}`

Usage accounting per capability: `searches` (search), `pages` (scrape/extract),
`crawl_units` (crawl/map) — all visible via `GET /api/usage` and enforced by
live rate windows like LLM tokens.

## Management

| Method | Path | Description |
|---|---|---|
| GET | `/api/adapters` | runtime + installable tool adapters (`kind`, base URL, capabilities) |
| GET/POST | `/api/providers` | list / upsert provider |
| PATCH | `/api/providers/:id` | enable/disable, priority, baseUrl |
| GET/POST | `/api/accounts` | list (optional `?provider=`) / upsert account |
| GET | `/api/credentials` | list (redacted, optional `?account=`); secrets never returned |
| POST | `/api/keys` | key-first provisioning (`{providerId, secret, label?, accountId?}`): creates provider/account if missing, stores the encrypted key, registers known tool adapters live and creates tool capability mappings |
| POST | `/api/credentials` | store a secret for an existing account (`{accountId, secret, label?}`); encrypted at rest |
| PATCH | `/api/credentials/:id` | change `status` (`active`/`disabled`/`invalid`) or `label` |
| DELETE | `/api/credentials/:id` | delete a key (quotas, health, usage cascade) |
| GET | `/api/resources/:id` | single canonical resource (404 if unknown) |
| GET/POST | `/api/resources` | list / upsert canonical resources |
| GET/POST | `/api/provider-resources` | canonical ↔ upstream mappings |
| GET | `/api/routes?resource=&capability=` | expanded executable routes + quotas + health |
| GET | `/api/routes/counts?capability=` | per-resource route counts in one request (dashboard list views must use this, never one `/api/routes` call per row) |
| POST | `/api/routing/simulate` | ranked candidates with scores and filter reasons |
| GET/POST | `/api/quotas` | list (optional `?credential=`) / configure a quota window |
| GET | `/api/requests?limit=` | per-attempt history with actual routes and credential IDs; secrets excluded |
| GET | `/api/requests/:id` | single request detail |
| GET | `/api/usage?credential=&metric=&since=` | live usage sums over usage_events |
| GET | `/api/overview` | dashboard aggregation (counts, 24h stats) |
| GET/PATCH | `/api/settings` | runtime default policy (resets on restart) |
| POST | `/api/credentials/:id/validate` | live probe; definitive 401 marks invalid, inconclusive probes leave state unchanged |
| POST | `/api/maintenance/validate` | staggered batch: `{provider?, limit?, maxAgeHours?}`; summary includes `inconclusive` |
| POST | `/api/maintenance/sync` | re-pull live provider catalogs, prune stale mappings, rebuild `auto:free`; returns `{mapped, pruned, skipped, autoFreeMappings}` |
| DELETE | `/api/quotas/:id` | delete a quota window |
| PATCH/DELETE | `/api/provider-resources/:id` | enable/disable or delete a mapping |
| DELETE | `/api/resources/:id`, `/api/accounts/:id`, `/api/providers/:id` | deletes (FK cascades) |

Dashboard UI at `GET /dashboard` (React/Vite build in `web/dist`; run
`pnpm web:build`, or `pnpm dev:web` for the Vite dev server with API proxy).
The dashboard and `/api/*` are unauthenticated by design. The dashboard exposes
key/account/quota operations, route inspection and an Add page for key-first
provisioning plus manual canonical-model/route creation. Adding a new provider
adapter or tool integration is still a backend change; known tool adapters
(Exa/Tavily/Firecrawl) can be materialized from a key through `/api/keys`.

Provider and credential PATCH bodies are validated; invalid status/type
values return 400. Credential labels are trimmed and capped at 128 chars.
Moving an existing account to another provider returns
409; create a new account instead. Individual credential probes return
`definitive: false` when inconclusive, and successful validation preserves
an explicitly disabled key. Model sync preserves disabled mappings, tools
and custom canonical mappings; failed discovery can add curated models
without pruning existing routes.

## MCP server

`pnpm mcp` runs a stdio MCP wrapper around the running router
(`src/server/mcp.ts`, `@modelcontextprotocol/sdk`). Thin forwarder only —
every call flows through the same routing core, so rotation, fallback, and
accounting apply unchanged.

Tools: `web_search`, `web_scrape`, `web_extract`, `web_crawl`, `web_map`,
`chat`. Each accepts optional `provider` (pin) and `policy` passthroughs.

Client config:

```json
{ "command": "pnpm", "args": ["mcp"], "cwd": "/path/to/router" }
```

Env: `ROUTER_URL` (default `http://127.0.0.1:4500`),
`ROUTER_TIMEOUT_MS` (default 90000).

### Simulate example

```json
POST /api/routing/simulate
{"resource": "llm:model:nemotron-3-super-120b", "capability": "llm.chat", "policy": "burn"}
```

Returns `eligible` (ranked, with `score`, `reason`, `details`) and `filtered`
(routes excluded by hard eligibility, with reasons).
