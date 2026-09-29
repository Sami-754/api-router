import {
  defineToolAdapter,
  pollCrawlJob,
  type ToolCall,
} from "./tool-base.js";
import type {
  AdapterContext,
  NormalizedRequest,
  ProviderAdapter,
  ResolvedRoute,
  StoredCredentialView,
} from "../provider-sdk/types.js";

// Firecrawl adapter — https://api.firecrawl.dev, auth `Bearer fc-...` (v2 API).
// Capabilities: web.search, web.scrape, web.extract (scrape fan-out),
// web.crawl (async job + polling), web.map. Same router core as everything else.

const DEFAULT_BASE = "https://api.firecrawl.dev";

interface FcSearchHit {
  url?: string;
  title?: string;
  description?: string;
  markdown?: string;
}

interface FcScrapeData {
  markdown?: string;
  content?: string;
  metadata?: { title?: string; sourceURL?: string; url?: string };
}

async function scrapeOne(call: ToolCall, url: string): Promise<{ url: string; title?: string; markdown: string }> {
  const { json } = await call.post<{ success?: boolean; data?: FcScrapeData }>(
    "/v2/scrape",
    { url, formats: ["markdown"], onlyMainContent: true },
  );
  const data = json.data ?? {};
  return {
    url: String(data.metadata?.sourceURL ?? data.metadata?.url ?? url),
    title: data.metadata?.title ? String(data.metadata.title) : undefined,
    markdown: String(data.markdown ?? data.content ?? ""),
  };
}

const probe = { path: "/v2/search", body: () => ({ query: "test", limit: 1 }) };

export const firecrawlAdapter = (defaultBaseUrl = DEFAULT_BASE) =>
  defineToolAdapter({
    providerId: "firecrawl",
    displayName: "Firecrawl",
    defaultBaseUrl,
    auth: { kind: "bearer" },
    handlers: [
      {
        capability: "web.search",
        description: "Firecrawl search with scraped content",
        probe,
        quotaMetric: "searches",
        run: async (call) => {
          if (call.normalized.kind !== "web.search") throw new Error("firecrawl search: wrong request kind");
          const q = call.normalized.body;
          const { json } = await call.post<{ success?: boolean; data?: FcSearchHit[] }>(
            "/v2/search",
            { query: q.query, limit: Math.min(q.maxResults, 10), sources: ["web"], scrapeOptions: { formats: ["markdown"] } },
          );
          return {
            kind: "web.search",
            body: {
              results: (json.data ?? []).map((r) => ({
                title: String(r.title ?? ""),
                url: String(r.url ?? ""),
                snippet: String(r.markdown ?? r.description ?? "").slice(0, 2000),
              })),
            },
          };
        },
      },
      {
        capability: "web.scrape",
        description: "Firecrawl single-page scrape (markdown)",
        probe,
        quotaMetric: "pages",
        run: async (call) => {
          if (call.normalized.kind !== "web.scrape") throw new Error("firecrawl scrape: wrong request kind");
          const page = await scrapeOne(call, call.normalized.body.url);
          return {
            kind: "web.scrape",
            body: { url: page.url, title: page.title, markdown: page.markdown.slice(0, call.normalized.body.maxChars ?? 50_000) },
          };
        },
      },
      {
        capability: "web.extract",
        description: "Firecrawl multi-URL extract (scrape fan-out)",
        probe,
        quotaMetric: "pages",
        run: async (call) => {
          if (call.normalized.kind !== "web.extract") throw new Error("firecrawl extract: wrong request kind");
          const pages = await Promise.all(
            call.normalized.body.urls.map(async (url) => {
              try {
                const p = await scrapeOne(call, url);
                return { url: p.url, title: p.title, content: p.markdown.slice(0, 200_000) };
              } catch (e) {
                return { url, content: "", error: e instanceof Error ? e.message : String(e) };
              }
            }),
          );
          return { kind: "web.extract", body: { results: pages } };
        },
      },
      {
        capability: "web.crawl",
        description: "Firecrawl async crawl (start + poll to completion)",
        probe,
        quotaMetric: "crawl_units",
        run: async (call) => {
          if (call.normalized.kind !== "web.crawl") throw new Error("firecrawl crawl: wrong request kind");
          const { url, limit, includePaths, excludePaths } = call.normalized.body;
          const { json: started } = await call.post<{ success?: boolean; id?: string }>(
            "/v2/crawl",
            {
              url,
              limit: limit ?? 20,
              includePaths,
              excludePaths,
              scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
            },
          );
          if (!started.id) throw new Error("firecrawl crawl returned no job id");
          const done = await pollCrawlJob<{
            status?: string;
            data?: Array<{ url?: string; markdown?: string; metadata?: { title?: string } }>;
          }>(call, started.id);
          return {
            kind: "web.crawl",
            body: {
              pages: (done.data ?? []).map((p) => ({
                url: String(p.url ?? ""),
                title: p.metadata?.title ? String(p.metadata.title) : undefined,
                markdown: p.markdown ? String(p.markdown).slice(0, 50_000) : undefined,
              })),
            },
          };
        },
      },
      {
        capability: "web.map",
        description: "Firecrawl URL discovery for a site",
        probe,
        quotaMetric: "crawl_units",
        run: async (call) => {
          if (call.normalized.kind !== "web.map") throw new Error("firecrawl map: wrong request kind");
          const { url, limit } = call.normalized.body;
          const { json } = await call.post<{
            success?: boolean;
            links?: Array<string | { url?: string; title?: string }>;
          }>("/v2/map", { url, limit: limit ?? 100 });
          return {
            kind: "web.map",
            body: {
              links: (json.links ?? [])
                .map((l) =>
                  typeof l === "string"
                    ? { url: l }
                    : { url: String(l.url ?? ""), title: l.title ? String(l.title) : undefined },
                )
                .filter((l) => l.url),
            },
          };
        },
      },
    ],
  });

// Class export (same shape as the other adapters).
export class FirecrawlAdapter implements ProviderAdapter {
  readonly id = "firecrawl";
  readonly displayName = "Firecrawl";
  private inner: ProviderAdapter;
  constructor(defaultBaseUrl = DEFAULT_BASE) {
    this.inner = firecrawlAdapter(defaultBaseUrl);
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
