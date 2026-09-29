# Routing

## Pipeline

1. **Candidate expansion** — canonical resource → provider mappings →
   executable routes (`provider × account × credential × provider_resource`).
2. **Hard eligibility** — remove routes that cannot serve the request.
3. **Policy scoring** — rank the survivors.
4. **Key rotation** — within each provider, eligible credentials take turns.
   Request N starts at the next key in a stable ring. Provider order is still
   the score order.
5. **Execution** — run that key's adapter against the provider base URL.
6. **Accounting** — health, usage, quota, request log.
7. **Fallback** — on a limit, auth failure, or upstream error, try the next
   key of that provider, then the next provider if the model is mapped there.

Eligibility and scoring are separate stages on purpose: a route is never
"slightly ineligible", and scoring never silently excludes a route.

## Eligibility (in order)

- user pinned another provider / account / credential
- provider disabled
- account disabled
- credential not `active`
- provider resource disabled
- capability unsupported by the route
- no adapter registered for the provider
- request exceeds known context (`requestedTokens > contextTokens`)
- cooldown active (`cooldownUntil` in the future)
- hard quota window exhausted (`remaining <= 0`)

Routes with **unknown quota** (no windows) stay eligible. Unknown is not zero.

## Policies

| Policy | Behavior |
|---|---|
| `auto` | balanced: remaining quota + reset urgency + reliability + latency + priority |
| `burn` | `remaining_fraction × urgency(reset)` — consumes quota that expires soon |
| `preserve` | favors long-lived headroom (inverse of burn) |
| `fast` | lowest latency EMA first |
| `reliable` | highest success score first |
| `cheap` | provider priority order (no cost model yet — documented in reason string) |
| `priority` | configured provider priority order |

Every score ships a human-readable `reason`, e.g.
`burn: 93% remaining, resets in 3d (urgency 0.74)`. The scoring formula lives
in `src/core/policies.ts` and is deliberately not persisted — tune freely.

## Fallback semantics

Every provider's keys rotate the same way. A request starts on the next
eligible key for that provider and, if that key fails, walks the rest of
the pool (capped at `maxAttempts`, 64).

- **Auto request**: after a provider's keys are exhausted, may fall back to
  another provider that maps the same canonical resource.
- **Provider-pinned**: stays on that provider's keys. Cross-provider fallback
  requires `allowCrossProviderFallback: true`.
- **Credential-pinned**: exactly one attempt, no substitution.

Key failures try the next key: `auth` (401/403), `rate_limit`,
`quota_exhausted`, `provider_unavailable`, `timeout`, `network`, `unknown`.
A 401 also marks that credential `invalid`. A 403 cools the key down for 10
minutes and leaves it in the pool.

`bad_request`, `unsupported`, and `context_limit` stop immediately. Another
key of the same provider would reject the same request.

## Health and cooldown

Per `(credential, provider_resource)`: success/failure counts, consecutive
failures, latency EMA, last error class, `cooldownUntil`. Defaults:

- `rate_limit` → 60s cooldown, and the whole key is skipped for every model
- `quota_exhausted` → 5min cooldown, whole key
- `auth` → 10min cooldown, whole key (401 also sets credential `invalid`)
- `provider_unavailable` / `timeout` / `network` → 30s cooldown for that model

An expired cooldown is replaced the next time that key fails. It does not
keep the old timestamp.
