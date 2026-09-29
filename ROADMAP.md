# ROADMAP.md

## Phase 0 — Repository foundation

Goal: establish clean project boundaries.

Deliverables:

- TypeScript project
- lint/format/test setup
- environment validation
- database layer
- migration system
- shared schemas
- base provider adapter interface
- basic CI

Exit condition:

```text
test suite runs
server starts
database migration succeeds
```

---

## Phase 1 — First LLM vertical slice

Goal: prove exact route selection.

Deliverables:

- provider registry
- account/credential storage
- resource registry
- provider-resource mapping
- one OpenAI-compatible provider adapter
- `/v1/chat/completions`
- canonical model request
- `provider::model` pinning
- normalized non-stream response
- request log
- `X-Router-Via`
- tests

Exit condition:

A client can point its OpenAI base URL to this router and successfully call one upstream provider.

---

## Phase 2 — Same model, multiple providers

Goal: solve the main original problem.

Deliverables:

- second LLM provider
- same canonical model mapped to both
- automatic provider choice
- exact provider pinning
- same-provider account/credential selection
- fallback
- health tracking
- cooldowns
- retry classification

Exit condition:

```text
model="nemotron-3-super-120b"
```

can use either route, while:

```text
model="groq::nemotron-3-super-120b"
```

always remains on Groq.

---

## Phase 3 — Quota engine

Goal: make routing reset-aware.

Deliverables:

- generic quota window schema
- manual quota configuration
- provider quota observation hooks
- response-header quota ingestion where possible
- usage accounting
- hard exhaustion checks
- reset timestamps
- quota dashboard/API

Exit condition:

Router can explain remaining quota and reset time for each route.

---

## Phase 4 — Burn policy

Goal: prevent free quota from expiring unused.

Deliverables:

- `burn` scorer
- reset urgency
- score explanation
- estimated request consumption support
- policy selection
- route simulation/debug endpoint

Suggested debug API:

```text
POST /api/routing/simulate
```

Input:

```json
{
  "resource": "llm:model:nemotron-3-super-120b",
  "policy": "burn"
}
```

Output should explain candidate filtering and scoring.

Exit condition:

A route with high remaining quota and near reset is predictably preferred over a route whose quota resets much later.

---

## Phase 5 — Search capability

Goal: prove router is not LLM-specific.

Implement:

```text
web.search
```

Suggested first providers:

- Exa
- Tavily

Deliverables:

- normalized search request
- normalized search result
- Exa adapter
- Tavily adapter
- capability routing
- provider pinning for tools
- quota accounting

Exit condition:

One `/v1/tools/search` request can route to either Exa or Tavily.

---

## Phase 6 — Firecrawl and web operations

Capabilities:

```text
web.search
web.extract
web.scrape
web.crawl
web.map
```

Only map capabilities that Firecrawl actually supports in the implementation version being targeted.

Exit condition:

The same provider registry/quota engine handles both LLMs and web tooling.

---

## Phase 7 — Dashboard

Core pages:

```text
Overview
Resources
Providers
Credentials
Quota
Requests
Routing Policies
Settings
```

Important resource detail page:

```text
Nemotron 3 Super 120B
3 providers
```

Show per route:

- provider
- account
- remaining quota
- reset time
- health
- latency
- request count
- current routing score
- score reason

Allow:

- provider enable/disable
- priority ordering
- routing policy selection
- exact route testing
- credential validation
- manual quota overrides

---

## Phase 8 — Protocol coverage

Possible additions:

- `/v1/responses`
- streaming
- tool calls
- embeddings
- vision
- Anthropic-compatible surface
- native provider passthrough where useful

Do not add these before the routing/quota core is stable.

---

## Later ideas

Not MVP:

- user/team multi-tenancy
- per-client budget limits
- billing
- API-key scoped policies
- provider cost optimization
- weighted traffic splitting
- routing rules DSL
- configuration import/export
- remote/self-hosted agents
- distributed deployment
- provider benchmark jobs
- learned request-cost estimation
