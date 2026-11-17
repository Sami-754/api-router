# Routing

## Pipeline

1. **Candidate expansion** — canonical resource → provider mappings →
   executable routes (`provider × account × credential × provider_resource`).
2. **Hard eligibility** — remove routes that cannot serve the request.
3. **Policy scoring** — rank the survivors.
4. **Key rotation** — rotate equal-scored credentials within a provider.
   Keep higher scores ahead of lower scores. An explicit provider pin is
   tried first, including when cross-provider fallback is enabled.
5. **Execution** — run that key's adapter against the provider base URL.
6. **Accounting** — health, usage, quota, request log.
7. **Fallback** — recheck eligibility and try the next ranked route when
   the adapter classifies the failure as retryable. Auth failures may use
   another key. Respect both the attempt limit and the total time budget.

Eligibility and scoring are separate stages on purpose: a route is never
"slightly ineligible", and scoring never silently excludes a route.

## Eligibility (in order)

- user pinned another provider / account / credential
- provider disabled
- account disabled
- credential not `active`
- provider resource disabled
- capability unsupported by the route or registered adapter
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

The execution order preserves routing-policy scores. Only equal-scored
routes rotate; use `priority` for rotation based on configured provider
order rather than measured health or quota. Attempts are capped at
`maxAttempts` (64 by default) and share one execution budget (60 seconds
by default). HTTP deadlines remain active through response-body reads.

- **Auto request**: may fall back across providers in score order.
- **Provider-pinned**: stays on that provider's keys. Cross-provider fallback
  requires `allowCrossProviderFallback: true`.
- **Credential-pinned**: exactly one attempt, no substitution.

Retryable key failures try the next route: `rate_limit`, `quota_exhausted`,
`provider_unavailable`, `timeout`, `network`. `unknown` errors retry only
when the adapter explicitly marks them retryable. Auth errors may try
another credential even when retrying the same credential would not help.
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

## Quota resets and aliases

Rate-policy scores use current-window usage, matching eligibility checks.
Configured calendar windows with an explicit `resetAt` renew when that
timestamp passes, carrying forward only usage from the new window.
Provider-reported credit balances and fixed expiry windows remain
conservative until a fresh observation; the router does not assume a refill.

`auto:free` executable routes use their source mapping's scoped quotas,
health, capabilities and context limit. Disabling the source makes the alias
ineligible immediately. Alias refresh preserves unchanged rows and source
accounting state.

Request history records each attempted route, including failures before a
successful fallback. Streams commit on the first normalized chunk and never
fall back after commitment. Empty streams may fall back; streams closed
without a completion marker are logged as failures.
