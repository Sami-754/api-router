# API Router

Self-hosted, quota-aware API routing across multiple providers, accounts, credentials, endpoints, and capabilities.

## Why

The same logical model or API capability may be available from multiple upstream providers, but their quotas, reset dates, health, pricing, and limits differ.

This router lets clients use one local API while retaining exact control over the upstream route when needed.

Example:

```text
nemotron-3-super-120b
├── Groq
├── OpenRouter
└── another provider
```

Automatic:

```json
{
  "model": "nemotron-3-super-120b"
}
```

Provider-pinned:

```json
{
  "model": "groq::nemotron-3-super-120b"
}
```

## Key feature

The router can prefer quota that is likely to expire/reset soon, helping avoid wasting unused free-tier capacity.

## Beyond LLMs

The same routing core is intended to support API capabilities such as:

```text
web.search
web.extract
web.scrape
web.crawl
```

with providers such as Exa, Tavily, and Firecrawl.

## Architecture

See:

- `AGENTS.md`
- `ARCHITECTURE.md`
- `STATE.md`
- `ROADMAP.md`
- `TASKS.md`
- `docs/api.md`, `docs/routing.md`, `docs/provider-adapters.md`, `docs/data-model.md`

## Project status

Router core + dashboard + protocols working (2026-11-17): chat completions
(auto-route, `provider::model` pin, **streaming**), `/v1/responses`,
`/v1/messages` (Anthropic), `/v1/tools/search` (Exa/Tavily adapters),
fallback, health/cooldown, quota windows + live rate limits, `burn` routing,
batch key validation, plug-and-play tools (`/v1/tools/{search,scrape,extract,crawl,map}`
across Exa/Tavily/Firecrawl) + MCP server (`pnpm mcp`: `web_search/scrape/extract/crawl/map`, `chat`).
127 tests green (`pnpm test`).

Dashboard: `GET /dashboard` (React + Vite build; no auth — local-first,
bind to loopback). The **Add** page is key-first: pick a provider (including
Exa/Tavily/Firecrawl), paste the key and label it. Tool providers are
provisioned with their routes automatically. A second tab creates a canonical
model + provider route when catalog sync misses one. The old dependency-free
`public/` dashboard has been replaced by the app in `web/`.

## Quickstart (pnpm)

```sh
cp .env.example .env
# put a long random value in MASTER_KEY, e.g. openssl rand -base64 32
pnpm install
pnpm db:migrate
pnpm dev        # API on :4500
pnpm dev:web    # dashboard on :5173 (proxies /api, /v1, /healthz)
```

For a single production-style process:

```sh
pnpm build      # builds web/dist, then dist/server
pnpm start
# open http://127.0.0.1:4500/dashboard
```

Seeded on first boot: `llm:model:nemotron-3-super-120b` mapped to Groq and
OpenRouter, with `groq-main` / `openrouter-main` accounts. Add a credential:

```sh
curl -X POST localhost:4500/api/credentials \
  -H 'Content-Type: application/json' \
  -d '{"accountId":"groq-main","secret":"<GROQ_KEY>","label":"main"}'
```

Then route (use your `PORT` from `.env`):

```sh
curl -X POST localhost:4500/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"nemotron-3-super-120b","messages":[{"role":"user","content":"hi"}]}'

# pinned:
curl -X POST localhost:4500/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"groq::nemotron-3-super-120b","messages":[{"role":"user","content":"hi"}]}'
```

The first target is a small end-to-end LLM routing slice with exact provider pinning, followed by quota-aware multi-provider routing.
