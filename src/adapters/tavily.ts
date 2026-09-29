import { defineToolAdapter, type ToolCall } from "./tool-base.js";
import type {
  AdapterContext,
  NormalizedRequest,
  NormalizedResponse,
  ProviderAdapter,
  ResolvedRoute,
  StoredCredentialView,
} from "../provider-sdk/types.js";

// Tavily adapter — https://api.tavily.com, auth `Bearer tvly-...` header.
// Capabilities: web.search, web.extract, web.crawl, web.map. Same core path.

const DEFAULT_BASE = "https://api.tavily.com";

interface TavilySearchHit {
  title?: string;
  url?: string;
  content?: string;
  snippet?: string;
  score?: number;
}

interface TavilyExtractHit {
  url?: string;
  title?: string;
  raw_content?: string;
  content?: string;
}

async function runSearch(call: ToolCall): Promise<NormalizedResponse> {
  if (call.normalized.kind !== "web.search") throw new Error("tavily search: wrong request kind");
  const q = call.normalized.body;
  const upstream: Record<string, unknown> = { query: q.query, max_results: q.maxResults };
  if (q.includeDomains?.length) upstream.include_domains = q.includeDomains;
  if (q.excludeDomains?.length) upstream.exclude_domains = q.excludeDomains;
  const { json } = await call.post<{ results?: TavilySearchHit[] }>("/search", upstream);
  return {
    kind: "web.search",
    body: {
      results: (json.results ?? []).map((r) => ({
        title: String(r.title ?? ""),
        url: String(r.url ?? ""),
        snippet: String(r.content ?? r.snippet ?? "").slice(0, 2000),
        score: typeof r.score === "number" ? r.score : undefined,
      })),
    },
  };
}

const probe = { path: "/search", body: () => ({ query: "test", max_results: 1 }) };

export const tavilyAdapter = (defaultBaseUrl = DEFAULT_BASE) =>
  defineToolAdapter({
    providerId: "tavily",
    displayName: "Tavily",
    defaultBaseUrl,
    // Current docs use the Bearer header; `bodyKey` keeps the legacy
    // `api_key` body field for older keys that still expect it.
    auth: { kind: "bearer", bodyKey: "api_key" },
    handlers: [
      {
        capability: "web.search",
        description: "Tavily search API",
        probe,
        quotaMetric: "searches",
        run: runSearch,
      },
      {
        capability: "web.extract",
        description: "Tavily extract (up to 20 URLs per request)",
        probe,
        quotaMetric: "pages",
        run: async (call) => {
          if (call.normalized.kind !== "web.extract") throw new Error("tavily extract: wrong request kind");
          const { urls, query } = call.normalized.body;
          const { json } = await call.post<{
            results?: TavilyExtractHit[];
            failed_results?: Array<{ url?: string; error?: string }>;
          }>("/extract", { urls, query, format: "markdown" });
          const failed = new Map(
            (json.failed_results ?? []).map((f) => [String(f.url ?? ""), String(f.error ?? "extraction failed")]),
          );
          return {
            kind: "web.extract",
            body: {
              results: (json.results ?? []).map((r) => ({
                url: String(r.url ?? ""),
                title: r.title ? String(r.title) : undefined,
                content: String(r.raw_content ?? r.content ?? "").slice(0, 200_000),
                error: failed.get(String(r.url ?? "")),
              })),
            },
          };
        },
      },
      {
        capability: "web.scrape",
        description: "Tavily extract of a single URL",
        probe,
        quotaMetric: "pages",
        run: async (call) => {
          if (call.normalized.kind !== "web.scrape") throw new Error("tavily scrape: wrong request kind");
          const { url } = call.normalized.body;
          const { json } = await call.post<{
            results?: TavilyExtractHit[];
            failed_results?: Array<{ url?: string; error?: string }>;
          }>("/extract", { urls: [url], format: "markdown" });
          const hit = json.results?.[0];
          if (!hit) {
            const err = json.failed_results?.[0]?.error ?? "extraction failed";
            throw Object.assign(new Error(`tavily scrape failed: ${err}`), {
              providerError: { errorClass: "provider_unavailable", message: err, retryable: true },
            });
          }
          return {
            kind: "web.scrape",
            body: {
              url: String(hit.url ?? url),
              title: hit.title ? String(hit.title) : undefined,
              markdown: String(hit.raw_content ?? hit.content ?? "").slice(0, call.normalized.body.maxChars ?? 50_000),
            },
          };
        },
      },
      {
        capability: "web.crawl",
        description: "Tavily crawl (synchronous page batch)",
        probe,
        quotaMetric: "crawl_units",
        run: async (call) => {
          if (call.normalized.kind !== "web.crawl") throw new Error("tavily crawl: wrong request kind");
          const { url, limit, includePaths, excludePaths } = call.normalized.body;
          const { json } = await call.post<{ results?: TavilyExtractHit[] }>("/crawl", {
            url,
            max_depth: 2,
            max_breadth: 20,
            limit: limit ?? 20,
            select_paths: includePaths,
            exclude_paths: excludePaths,
          });
          return {
            kind: "web.crawl",
            body: {
              pages: (json.results ?? []).map((r) => ({
                url: String(r.url ?? ""),
                markdown: String(r.raw_content ?? r.content ?? "").slice(0, 50_000) || undefined,
              })),
            },
          };
        },
      },
      {
        capability: "web.map",
        description: "Tavily site map (URL discovery)",
        probe,
        quotaMetric: "crawl_units",
        run: async (call) => {
          if (call.normalized.kind !== "web.map") throw new Error("tavily map: wrong request kind");
          const { url, limit } = call.normalized.body;
          const { json } = await call.post<{ results?: Array<string | { url?: string }> }>("/map", {
            url,
            limit: limit ?? 100,
          });
          return {
            kind: "web.map",
            body: {
              links: (json.results ?? []).map((l) => ({
                url: typeof l === "string" ? l : String(l.url ?? ""),
              })).filter((l) => l.url),
            },
          };
        },
      },
    ],
  });

// Class export (existing imports/tests use `new TavilyAdapter()`).
export class TavilyAdapter implements ProviderAdapter {
  readonly id = "tavily";
  readonly displayName = "Tavily";
  private inner: ProviderAdapter;
  constructor(defaultBaseUrl = DEFAULT_BASE) {
    this.inner = tavilyAdapter(defaultBaseUrl);
  }
  capabilities() {
    return this.inner.capabilities();
  }
  validateCredential(c: StoredCredentialView, ctx: AdapterContext) {
    return this.inner.validateCredential(c, ctx);
  }
  execute(req: NormalizedRequest, route: ResolvedRoute, ctx: AdapterContext) {
    return this.inner.execute(req, route, ctx);
  }
  classifyError(e: unknown) {
    return this.inner.classifyError(e);
  }
}
