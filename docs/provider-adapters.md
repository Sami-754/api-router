# Provider adapters

The core never contains provider-specific code. Each adapter owns: auth,
URL construction, request/response translation, quota discovery, and error
classification. The core owns: selection, retry, accounting, health, quota
state, logging.

## Contract

See `src/provider-sdk/types.ts` (`ProviderAdapter`) and
`src/provider-sdk/registry.ts` (`ProviderRegistry`).

```ts
interface ProviderAdapter {
  id: string;                       // "groq"
  displayName: string;
  capabilities(): CapabilityDescriptor[];
  validateCredential(credential, ctx): Promise<CredentialValidationResult>;
  discoverResources?(credential, ctx): Promise<DiscoveredResource[]>;
  getQuota?(credential, ctx): Promise<QuotaSnapshot[]>;
  execute(request, route, ctx): Promise<NormalizedResponse>;
  classifyError(error: unknown): ProviderError;
}
```

Shared HTTP-status classification lives in
`src/provider-sdk/error-classify.ts` — reuse it, then refine with
provider-specific body codes.

## Adding a provider (no core edits)

LLM (OpenAI-compatible):

1. Register one line in `src/server/boot.ts` with its default base URL
   (the generic `OpenAICompatibleAdapter` serves Groq, OpenRouter, …).
2. Add the provider row (`POST /api/providers`), account, credential, and
   `provider_resources` mappings.
3. Add tests with a mocked `fetchImpl` — never a real secret
   (see `tests/helpers.ts`).

Tool (search/scrape/extract/crawl/map):

1. Copy `src/adapters/firecrawl.ts` → `src/adapters/<name>.ts`, calling
   `defineToolAdapter()` from `src/adapters/tool-base.ts` with one `handlers`
   entry per capability the provider actually supports (see the verified
   base-URL/auth/endpoint table in `tool-base.ts`). Handlers declare their own
   path, body builder, response parser, validation probe, and quota metric.
   Async jobs (e.g. Firecrawl crawl) use the `pollCrawlJob()` helper.
2. Register one line in `src/server/boot.ts` (+ default base URL entry).
3. Add capability resources (auto-created on boot), provider row, account,
   credential, and `provider_resources` mappings **only for supported
   capabilities** — unsupported ones stay unmapped and therefore ineligible.
4. Add tests with a mocked `fetchImpl` (see `tests/tools.test.ts`,
   including the "plug-and-play provider contract" test).

A new capability (e.g. `web.scrape`) needs: normalized types
(`src/provider-sdk/types.ts`), a Zod schema (`src/shared/schemas.ts`), one
`TOOL_ROUTES` entry (`src/server/routes/tools.ts`), and handlers in the
adapters that support it — the routing core is untouched either way.

## Rules

- Adapters receive the **decrypted** secret in memory only; never log it.
- `classifyError` must set `retryable` correctly — it drives fallback.
  When in doubt, non-retryable is safer than retry storms.
- Custom `baseUrl` values are validated (`src/shared/config.ts`):
  http(s) only, no credentials in URL, no loopback/metadata hosts.
