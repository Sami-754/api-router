import { defineToolAdapter, type ToolCall } from "./tool-base.js";
import type {
  AdapterContext,
  NormalizedRequest,
  NormalizedResponse,
  ProviderAdapter,
  ResolvedRoute,
  StoredCredentialView,
} from "../provider-sdk/types.js";

// Exa adapter — https://api.exa.ai, auth `x-api-key` header.
// Capabilities: web.search (POST /search), web.scrape + web.extract
// (POST /contents with {urls, text:true}). Same router core as LLMs.

const DEFAULT_BASE = "https://api.exa.ai";

interface ExaSearchHit {
  title?: string;
  url?: string;
  text?: string;
  snippet?: string;
  highlights?: string[];
  score?: number;
}

interface ExaContentHit {
  id?: string;
  url?: string;
  title?: string;
  text?: string;
}

function snippetOf(h: ExaSearchHit): string {
  const raw = h.text ?? h.snippet ?? h.highlights?.join("\n") ?? "";
  return String(raw).slice(0, 2000);
}

async function runSearch(call: ToolCall): Promise<NormalizedResponse> {
  if (call.normalized.kind !== "web.search") throw new Error("exa search: wrong request kind");
  const q = call.normalized.body;
  const upstream: Record<string, unknown> = { query: q.query, numResults: q.maxResults };
  if (q.includeDomains?.length) upstream.includeDomains = q.includeDomains;
  if (q.excludeDomains?.length) upstream.excludeDomains = q.excludeDomains;
  const { json } = await call.post<{ results?: ExaSearchHit[] }>("/search", upstream);
  return {
    kind: "web.search",
    body: {
      results: (json.results ?? []).map((r) => ({
        title: String(r.title ?? ""),
        url: String(r.url ?? ""),
        snippet: snippetOf(r),
        score: typeof r.score === "number" ? r.score : undefined,
      })),
    },
  };
}

async function runContents(
  call: ToolCall,
  urls: string[],
): Promise<Array<{ url: string; title?: string; content: string }>> {
  const { json } = await call.post<{ results?: ExaContentHit[] }>("/contents", {
    urls,
    text: true,
  });
  return (json.results ?? []).map((r, i) => ({
    url: String(r.url ?? r.id ?? urls[i] ?? ""),
    title: r.title ? String(r.title) : undefined,
    content: String(r.text ?? "").slice(0, 200_000),
  }));
}

export const exaAdapter = (defaultBaseUrl = DEFAULT_BASE) =>
  defineToolAdapter({
    providerId: "exa",
    displayName: "Exa",
    defaultBaseUrl,
    auth: { kind: "x-api-key" },
    handlers: [
      {
        capability: "web.search",
        description: "Exa neural web search",
        probe: { path: "/search", body: () => ({ query: "test", numResults: 1 }) },
        quotaMetric: "searches",
        run: runSearch,
      },
      {
        capability: "web.scrape",
        description: "Exa page contents (single URL)",
        probe: { path: "/search", body: () => ({ query: "test", numResults: 1 }) },
        quotaMetric: "pages",
        run: async (call) => {
          if (call.normalized.kind !== "web.scrape") throw new Error("exa scrape: wrong request kind");
          const [page] = await runContents(call, [call.normalized.body.url]);
          const markdown = (page?.content ?? "").slice(0, call.normalized.body.maxChars ?? 50_000);
          return { kind: "web.scrape", body: { url: page?.url ?? call.normalized.body.url, title: page?.title, markdown } };
        },
      },
      {
        capability: "web.extract",
        description: "Exa page contents (up to 20 URLs)",
        probe: { path: "/search", body: () => ({ query: "test", numResults: 1 }) },
        quotaMetric: "pages",
        run: async (call) => {
          if (call.normalized.kind !== "web.extract") throw new Error("exa extract: wrong request kind");
          const pages = await runContents(call, call.normalized.body.urls);
          return {
            kind: "web.extract",
            body: { results: pages.map((p) => ({ url: p.url, title: p.title, content: p.content })) },
          };
        },
      },
    ],
  });

// Class export (existing imports/tests use `new ExaAdapter()`).
export class ExaAdapter implements ProviderAdapter {
  readonly id = "exa";
  readonly displayName = "Exa";
  private inner: ProviderAdapter;
  constructor(defaultBaseUrl = DEFAULT_BASE) {
    this.inner = exaAdapter(defaultBaseUrl);
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
