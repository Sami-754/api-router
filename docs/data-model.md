# Data model

```
Resource (canonical: llm:model:nemotron-3-super-120b, web.search, …)
  └─ ProviderResource (provider + upstream id, e.g. groq → nvidia/nemotron-3-super-120b)
       └─ Route (executable: provider × account × credential × provider_resource)

Provider ─< Account ─< Credential (secret AES-256-GCM, see MASTER_KEY)
Credential ─< QuotaWindow (generic metric + window + reset_at)
(Credential, ProviderResource) ─< HealthSnapshot
RequestLog / UsageEvent (append-only observability)
```

## Tables

| Table | Notes |
|---|---|
| `providers` | `id`, `display_name`, `base_url`, `enabled`, `priority` |
| `accounts` | groups credentials under a provider |
| `credentials` | `secret_encrypted` only; status `active`/`disabled`/`invalid` |
| `resources` | canonical ids; `kind` = `llm_model` or `capability` |
| `provider_resources` | `UNIQUE(resource_id, provider_id, upstream_id)` |
| `quota_windows` | `metric`, `limit/used/remaining`, `window_kind`, `reset_at`, `hard`, `source` |
| `health_snapshots` | keyed `(credential_id, provider_resource_id)` |
| `usage_events` | per-request metric quantities |
| `request_logs` | who was asked, what was chosen, why, attempts, latency, usage |

## Key distinctions

- **Resource** = what the client wants. **ProviderResource** = how one
  provider names it. **Route** = how it can actually be executed right now.
- **Quota windows** are generic: `requests`, `*_tokens`, `credits`, `usd`,
  `searches`, `pages`, `crawl_units`, with `rolling_seconds`,
  `calendar_*`, or `fixed` windows and nullable `reset_at`.
- Multiple windows can constrain one route; **all** hard windows apply.
- `source` records provenance: `provider_api`, `response_headers`,
  `configured`, `learned`, `estimated`.

## Storage

SQLite (`better-sqlite3`) is the local prototype. All access goes through the
`Store` interface (`src/core/store.ts`); migrating to PostgreSQL means
implementing that interface — no caller imports the driver directly. Schema
lives in `src/db/schema.ts` and is applied idempotently on open
(`pnpm db:migrate`).
