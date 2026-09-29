# ARCHITECTURE.md

## System overview

```text
Clients
  |
  +-- OpenAI-compatible LLM clients
  +-- generic tool clients
  +-- dashboard/admin
  |
  v
API Layer
  |
  v
Request Normalization
  |
  v
Routing Core
  |
  +-- eligibility filters
  +-- routing policy
  +-- quota engine
  +-- health/cooldown
  +-- fallback engine
  |
  v
Resolved Route
  |
  v
Provider Adapter
  |
  v
Upstream Provider
```

Shared infrastructure:

```text
Credential Store
Quota State
Usage Events
Health State
Request Logs
Resource Registry
Provider Registry
```

---

## Domain model

### Provider

A provider is an upstream API implementation.

Examples:

```text
groq
openrouter
exa
tavily
firecrawl
```

### Account

A user-defined grouping under a provider.

Examples:

```text
groq-main
groq-secondary
openrouter-personal
```

An account may represent a real upstream account, project, workspace, or endpoint scope.

### Credential

Secret material used to authenticate a route.

Credentials are separate from account metadata.

### Resource

A canonical resource requested by clients.

Examples:

```text
llm:model:nemotron-3-super-120b
llm:model:llama-3.3-70b
web.search
web.crawl
```

### Provider resource

Mapping between canonical resource and upstream provider representation.

Example:

```text
resource:
llm:model:nemotron-3-super-120b

provider:
openrouter

upstream ID:
nvidia/nemotron-3-super-120b
```

### Route

An executable combination of:

```text
provider
account
endpoint
credential
provider resource
```

The route is what the router actually selects.

---

## Request flow

### Automatic LLM request

Input:

```json
{
  "model": "nemotron-3-super-120b",
  "messages": [
    {"role": "user", "content": "hello"}
  ]
}
```

Flow:

```text
parse logical model
-> resolve canonical resource
-> find provider resource mappings
-> expand executable routes
-> filter ineligible routes
-> score by active routing policy
-> execute highest-ranked route
-> record result
-> fallback if retryable
-> normalize response
```

### Provider-pinned LLM request

Input:

```json
{
  "model": "groq::nemotron-3-super-120b",
  "messages": [...]
}
```

Flow:

```text
parse provider pin
-> resolve canonical resource
-> restrict candidates to groq
-> choose account/credential within groq
-> execute
-> same-provider fallback if configured
-> never cross provider automatically
```

---

## Capability requests

Generic capabilities use normalized request types.

Example:

```ts
type SearchRequest = {
  query: string
  maxResults?: number
  includeDomains?: string[]
  excludeDomains?: string[]
  recencyDays?: number
}
```

Adapters translate normalized requests into provider-native requests.

Provider-specific features may be exposed through an `extensions` object, but the core API should prefer portable fields.

---

## Routing pipeline

### Phase 1: candidate expansion

From canonical resource/capability, find all provider mappings and executable routes.

### Phase 2: hard eligibility

Remove routes that cannot serve the request.

Examples:

- disabled
- credential invalid
- unsupported capability
- exhausted hard quota
- cooldown
- context too small
- route does not match provider pin

### Phase 3: policy scoring

Score eligible routes.

Common scoring inputs:

- reset urgency
- remaining quota
- latency
- reliability
- monetary cost
- configured priority
- recent failures
- estimated request cost

### Phase 4: execution

Execute the selected adapter.

### Phase 5: accounting

Record:

- route
- latency
- success/failure
- provider usage metadata
- normalized usage
- quota observations
- retry classification

### Phase 6: fallback

If failure is retryable, repeat selection excluding unsuitable prior attempts.

---

## Quota engine

Quota records are generic.

Suggested fields:

```text
id
credential_id
provider_resource_id nullable
metric
limit_value
used_value
remaining_value
window_kind
window_seconds nullable
window_started_at nullable
reset_at nullable
observed_at
source
confidence
```

Possible `source` values:

```text
provider_api
response_headers
configured
learned
estimated
```

Possible metrics:

```text
requests
input_tokens
output_tokens
total_tokens
credits
usd
searches
pages
crawl_units
```

Multiple quota windows may apply to one route simultaneously.

Eligibility must respect all hard windows.

---

## Burn policy

Purpose:

> consume valuable quota before it resets and disappears.

A simple first implementation can calculate one pressure value per route.

Conceptual inputs:

```text
remaining_fraction
time_to_reset
estimated_request_consumption
recent_burn_rate
```

Example conceptual score:

```text
reset_pressure =
    remaining_fraction
    * urgency(time_to_reset)
```

Where urgency rises as reset approaches.

Do not freeze the exact formula into schemas or persistence.

The scorer should expose a human-readable explanation such as:

```text
selected because 82% of monthly quota remains and resets in 2.4 days
```

---

## Health model

Track health separately from quota.

Suggested data:

```text
success_rate
consecutive_failures
last_success_at
last_failure_at
last_error_class
cooldown_until
latency_ema_ms
```

Failure classes should include:

```text
auth
rate_limit
quota_exhausted
provider_unavailable
timeout
bad_request
unsupported
context_limit
network
unknown
```

Provider adapters classify native errors into these categories.

---

## Fallback semantics

### Auto request

May fallback across providers.

### Provider-pinned request

May fallback across credentials/accounts within that provider.

Should not cross providers unless request explicitly opts in.

### Credential-pinned request

No substitution unless explicitly enabled.

These semantics must be visible in tests.

---

## Provider adapter boundary

Adapters may perform:

- resource discovery
- quota fetch
- credential validation
- request conversion
- response conversion
- streaming conversion
- error classification

Adapters must not decide global routing policy.

---

## Persistence

Prefer explicit tables rather than storing the whole config as opaque JSON.

JSON columns are acceptable for:

- provider-specific metadata
- capability metadata
- optional extensions

Core routing fields should remain queryable.

---

## Streaming

Streaming should preserve route selection for the life of one request.

Do not retry across providers after a response stream has been committed to the client unless a protocol-specific safe mechanism exists.

Failures before headers/body commitment may fallback.

---

## Caching

Not required for MVP.

If added later, cache keys must include enough information to prevent cross-model/provider semantic mistakes.

---

## Extensibility rule

A new provider should not require edits to:

- route scoring algorithms
- quota schema
- fallback engine
- canonical resource semantics

It may require registration and adapter-specific code.

A new capability category should require normalized request/response schemas and adapters, not a rewrite of existing routing logic.
