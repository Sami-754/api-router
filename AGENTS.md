# AGENTS.md

## Project

Build a self-hosted, extensible API router that can route requests across multiple providers, accounts, endpoints, and credentials while tracking quota, reset windows, provider health, and routing policy.

The first major use case is LLM routing. The architecture must also support non-LLM tools such as web search, extraction, scraping, crawling, and future API categories without redesigning the core.

This project is not merely an "AI model auto-router." Its core purpose is **resource routing + credential/quota orchestration**.

---

## Primary user problem

A single logical model or capability may be available from multiple providers.

Example:

- `nemotron-3-super-120b`
  - Groq
  - OpenRouter
  - another endpoint/provider

The user must be able to:

1. Request the logical model and let the router choose a provider.
2. Pin the request to one exact provider.
3. Optionally pin an account/credential.
4. Prefer quota that is closest to reset so free quota is not wasted.
5. Fall back when a route is exhausted, rate-limited, unhealthy, or unavailable.
6. Add new providers and new tool categories later with minimal core changes.

The same design must work for tools such as:

- Exa
- Tavily
- Firecrawl

Those providers overlap in some capabilities but are not identical, so routing must be capability-based rather than pretending every provider implements the same API.

---

## Core design principles

### 1. Separate canonical resource identity from provider route identity

Never model these as three unrelated resources:

- `nemotron-openrouter`
- `nemotron-groq`
- `nemotron-provider-c`

Instead:

```text
Canonical resource:
llm:model:nemotron-3-super-120b

Routes:
- groq -> provider-specific model ID
- openrouter -> provider-specific model ID
- provider-c -> provider-specific model ID
```

The router must distinguish:

- what the user wants
- where it will be served from

---

### 2. The core abstraction is:

```text
Resource / Capability
    -> Provider
        -> Account / Endpoint
            -> Credential
```

Examples:

```text
llm:model:nemotron-3-super-120b
    -> groq
        -> default
            -> credential A

web.search
    -> exa
        -> default
            -> credential B

web.search
    -> tavily
        -> default
            -> credential C

web.crawl
    -> firecrawl
        -> default
            -> credential D
```

---

### 3. Provider-specific routing must be first-class

OpenAI-compatible LLM requests should support:

```text
model = "nemotron-3-super-120b"
```

Meaning:

> Route this logical model automatically.

And:

```text
model = "groq::nemotron-3-super-120b"
```

Meaning:

> Use this logical model specifically through Groq.

The separator should be `::`, not `/`, because provider model IDs often contain `/`.

Examples:

```text
groq::nvidia/nemotron-3-super-120b
openrouter::nvidia/nemotron-3-super-120b
```

Account-level pinning should be supported through an explicit routing extension or header rather than making the normal model string excessively complex.

Suggested optional extension:

```json
{
  "routing": {
    "provider": "groq",
    "account": "groq-main",
    "credential": "credential-id"
  }
}
```

Do not require clients to use router-specific fields for normal OpenAI-compatible operation.

---

### 4. Quotas are generic windows, not "monthly usage"

Different providers expose different limits:

- RPM
- RPD
- TPM
- TPD
- weekly requests
- monthly tokens
- credits
- dollar credits
- searches
- crawl credits
- rolling windows
- concurrency
- hard expiry/reset timestamps

Represent quota generically.

Example:

```json
{
  "metric": "tokens",
  "limit": 3000000,
  "used": 900000,
  "remaining": 2100000,
  "window_kind": "calendar_month",
  "reset_at": "2026-10-01T00:00:00Z",
  "source": "provider_api"
}
```

The routing engine should reason about:

- remaining capacity
- reset time
- utilization
- health
- latency
- cost
- configured priority

---

### 5. "Burn before reset" is a key routing mode

If route A has lots of quota remaining and resets sooner than route B, route A should generally be consumed more aggressively.

Example:

```text
Route A: 93% remaining, resets in 3 days
Route B: 15% remaining, resets in 10 days
Route C: 40% remaining, resets in 18 days
```

The router should consider quota expiry pressure rather than simply picking the route with the most remaining quota.

A production formula can evolve, but the first implementation should derive a normalized urgency score from:

- remaining fraction
- time until reset
- estimated request cost
- optional recent consumption rate

Do not hardcode one formula deeply into the architecture. Make routing policies pluggable.

---

### 6. The router core must not know provider-specific API details

Provider adapters own:

- authentication
- URL construction
- request translation
- response normalization
- quota discovery
- provider-specific error classification
- provider-specific model/resource discovery if supported

The core owns:

- route selection
- retry/fallback
- policy
- usage accounting
- health state
- quota state
- request logging
- public API
- provider registration

---

## Recommended repository structure

```text
.
├── AGENTS.md
├── README.md
├── STATE.md
├── ARCHITECTURE.md
├── ROADMAP.md
├── TASKS.md
├── docs/
│   ├── api.md
│   ├── routing.md
│   ├── provider-adapters.md
│   └── data-model.md
├── apps/
│   ├── server/
│   └── web/
├── packages/
│   ├── core/
│   ├── shared/
│   ├── db/
│   ├── provider-sdk/
│   └── adapters/
│       ├── llm/
│       ├── search/
│       └── web/
└── tests/
```

Do not create unnecessary monorepo complexity if a simpler layout is clearly better during implementation. Preserve module boundaries even if everything initially lives in one application.

---

## Suggested technology choices

The agent may choose equivalents if justified, but default preferences:

- TypeScript
- Node.js
- Fastify or Hono for the API server
- PostgreSQL for durable state
- Redis optional, only when justified
- Drizzle or Prisma for DB access
- Zod for runtime schemas
- React/Next.js or Vite React for dashboard
- Vitest for unit/integration tests

SQLite is acceptable for an early local prototype if the storage layer is written so PostgreSQL migration is straightforward.

Avoid introducing distributed infrastructure before it is required.

---

## Minimum public API

### LLM compatibility

```text
GET  /v1/models
POST /v1/chat/completions
POST /v1/responses
```

Initial implementation may begin with `/v1/chat/completions` only, but architecture must not prevent adding the others.

### Generic tools

```text
POST /v1/tools/search
POST /v1/tools/extract
POST /v1/tools/scrape
POST /v1/tools/crawl
```

Only expose endpoints for implemented capabilities.

### Management

```text
GET    /api/providers
POST   /api/providers
GET    /api/resources
GET    /api/routes
PUT    /api/routes
GET    /api/quotas
GET    /api/usage
GET    /api/requests
POST   /api/credentials
PATCH  /api/credentials/:id
```

Exact endpoint names can change, but semantics should stay clean.

---

## Capability model

Start with capabilities similar to:

```text
llm.chat
llm.responses
llm.tools
llm.vision
llm.embeddings

web.search
web.extract
web.scrape
web.crawl
web.map
```

A provider declares its supported capabilities.

A route is eligible only if the provider/endpoint supports the requested capability.

Do not assume Exa, Tavily, and Firecrawl are interchangeable for all operations.

---

## Provider adapter contract

Design an adapter contract approximately like:

```ts
interface ProviderAdapter {
  id: string
  displayName: string

  capabilities(): CapabilityDescriptor[]

  validateCredential(
    credential: StoredCredential,
    context: AdapterContext
  ): Promise<CredentialValidationResult>

  discoverResources?(
    credential: StoredCredential,
    context: AdapterContext
  ): Promise<DiscoveredResource[]>

  getQuota?(
    credential: StoredCredential,
    context: AdapterContext
  ): Promise<QuotaSnapshot[]>

  execute(
    request: NormalizedRequest,
    route: ResolvedRoute,
    context: AdapterContext
  ): Promise<NormalizedResponse>

  classifyError(
    error: unknown
  ): ProviderError
}
```

This is illustrative, not frozen.

Adapters should be independently testable.

Adding a provider should normally require:

1. one adapter
2. capability registration
3. resource mappings
4. quota parsing if available
5. tests

It should not require editing central route-selection logic.

---

## Routing policies

Implement policies as replaceable strategies.

Initial policy names:

```text
auto
burn
preserve
fast
reliable
cheap
priority
```

Meaning:

- `auto`: sensible balanced default
- `burn`: favor quota that will expire/reset soon
- `preserve`: favor routes with better long-term remaining headroom
- `fast`: favor measured latency/throughput
- `reliable`: favor recent success
- `cheap`: favor lower monetary/request cost
- `priority`: configured route order

Manual provider pinning overrides automatic ranking.

Manual account/credential pinning overrides provider-level selection where permitted.

---

## Routing eligibility order

Before scoring, eliminate ineligible routes.

A route is ineligible when:

- provider disabled
- account disabled
- credential disabled/invalid
- capability unsupported
- canonical resource not mapped
- endpoint unhealthy beyond configured threshold
- hard quota exhausted
- known cooldown active
- request exceeds context/capability constraints
- user explicitly pinned another provider/account

Then score remaining candidates according to routing policy.

Do not mix "eligibility" and "preference score" into one opaque formula.

---

## Fallback behavior

For unpinned automatic requests:

1. choose best eligible route
2. execute
3. classify failure
4. update health/quota state
5. if retryable, select next eligible route
6. stop at configured attempt/time budget

For provider-pinned requests:

- fallback may use another account/credential for the same provider by default
- do not silently cross to another provider unless explicitly configured

For fully pinned credential requests:

- no route substitution unless explicitly requested

This distinction is important.

---

## Observability requirements

Every request should be able to answer:

- requested canonical resource/capability
- selected provider
- selected account
- selected endpoint
- selected credential ID, redacted in UI/logs where appropriate
- routing policy
- why this route was selected
- fallback attempts
- latency
- status
- token/request/credit usage if known
- quota snapshot before/after when available

For LLM responses, return a header such as:

```text
X-Router-Via: groq/nemotron-3-super-120b
```

Optional debug headers:

```text
X-Router-Policy
X-Router-Attempts
X-Router-Request-ID
```

Never expose secrets.

---

## Security rules

- Never log raw API keys.
- Encrypt credentials at rest.
- Redact credentials from errors.
- Keep credential IDs separate from secret values.
- Do not return provider secrets through management APIs.
- Avoid putting API keys in URLs.
- Add request size limits.
- Validate user-supplied custom base URLs.
- Protect against SSRF if arbitrary/custom endpoints are supported.
- Management APIs have no auth (local-first single-user service) — bind to
  loopback / trust the local network instead. Do not reintroduce token auth
  unless the owner asks for multi-user or internet-exposed operation.
- Keep inference/API-client keys separate from upstream provider credentials.

---

## Data model guidance

Core entities:

```text
providers
accounts
credentials
resources
provider_resources
routes
quota_windows
health_snapshots
request_logs
usage_events
routing_policies
```

Important distinction:

- `resource` = canonical thing requested by the client
- `provider_resource` = provider-specific representation of that resource
- `route` = executable path through provider/account/credential/endpoint

A single provider resource may have multiple executable routes if multiple accounts or credentials exist.

---

## Development sequence

The agent should work in vertical slices.

### Slice 1

Implement:

- provider registry
- canonical resources
- accounts/credentials
- route resolution
- one OpenAI-compatible LLM provider
- `/v1/chat/completions`
- provider pinning syntax
- request log
- tests

### Slice 2

Add:

- multiple provider routes for one canonical model
- fallback
- health/cooldown
- quota windows
- `burn` routing

### Slice 3

Add:

- first non-LLM capability
- Exa or Tavily `web.search`
- generic normalized tool request/response path

### Slice 4

Add:

- Firecrawl
- scrape/crawl capabilities
- dashboard

Do not begin by implementing every provider.

---

## Coding-agent behavior

Before making major architectural changes:

1. read `AGENTS.md`
2. read `STATE.md`
3. read `ARCHITECTURE.md`
4. read `TASKS.md`
5. inspect existing implementation
6. update `STATE.md` after meaningful work

When completing a task:

- run relevant tests
- add tests for new behavior
- update docs when API behavior changes
- record important decisions in `STATE.md`
- avoid unrelated refactors

If requirements conflict, preserve these priorities:

1. exact provider control
2. generic extensibility
3. quota-aware routing
4. reliable fallback
5. OpenAI compatibility
6. dashboard polish

---

## Non-goals for the first version

Do not spend early development time on:

- billing users
- multi-region deployment
- Kubernetes
- enterprise RBAC
- marketplace/provider monetization
- advanced ML-based routing
- automatic prompt classification using another LLM
- every OpenAI endpoint
- every provider

A deterministic, inspectable router is preferred over an opaque "AI routing brain."

---

## Definition of MVP

The MVP is complete when all of the following work:

1. Two providers can expose the same canonical LLM model.
2. `model="canonical-model"` can auto-route.
3. `model="provider::canonical-model"` pins a provider.
4. Multiple credentials for a provider are supported.
5. Quota windows and reset times can be stored.
6. `burn` mode prefers useful quota that expires sooner.
7. Retryable failure can fall back safely.
8. Request history shows the actual provider route used.
9. One non-LLM capability can route across at least two providers.
10. Adding a new provider does not require changes to route-selection core.
