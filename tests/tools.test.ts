import { describe, expect, it } from "vitest";
import { openTestDb } from "./helpers.js";
import { SqliteStore } from "../src/db/sqlite-store.js";
import { ProviderRegistry } from "../src/provider-sdk/registry.js";
import { ExaAdapter } from "../src/adapters/exa.js";
import { TavilyAdapter } from "../src/adapters/tavily.js";
import { FirecrawlAdapter } from "../src/adapters/firecrawl.js";
import { defineToolAdapter } from "../src/adapters/tool-base.js";
import { Router } from "../src/core/router.js";
import { buildApp } from "../src/server/app.js";
import { encryptSecret } from "../src/shared/crypto.js";

process.env.MASTER_KEY ??= "test-master-key-0123456789abcdef0123456789";

const CAPS = ["web.search", "web.scrape", "web.extract", "web.crawl", "web.map"] as const;

function toolFetch(): typeof fetch {
  return (async (url, init) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    const hit = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status });

    // ---- exa ----
    if (u.includes("exa")) {
      if (u.endsWith("/search")) {
        return hit({ results: [{ title: "Exa hit", url: "https://exa.example/a", text: "exa snippet", score: 0.9 }] });
      }
      if (u.endsWith("/contents")) {
        return hit({ results: [{ url: "https://exa.example/a", title: "Exa page", text: "# hello exa" }] });
      }
    }
    // ---- tavily ----
    if (u.includes("tavily")) {
      if (u.endsWith("/search")) {
        return hit({ results: [{ title: "Tavily hit", url: "https://tavily.example/b", content: "tavily snippet", score: 0.8 }] });
      }
      if (u.endsWith("/extract")) {
        return hit({ results: [{ url: "https://tavily.example/b", title: "T page", raw_content: "# tavily content" }], failed_results: [] });
      }
      if (u.endsWith("/crawl")) {
        return hit({ base_url: "tavily.example", results: [{ url: "https://tavily.example/b", raw_content: "crawled" }] });
      }
      if (u.endsWith("/map")) {
        return hit({ base_url: "tavily.example", results: ["https://tavily.example/b", "https://tavily.example/c"] });
      }
    }
    // ---- firecrawl ----
    if (u.includes("firecrawl")) {
      if (u.endsWith("/v2/search")) {
        return hit({ success: true, data: [{ url: "https://fc.example/a", title: "FC hit", description: "fc desc" }] });
      }
      if (u.endsWith("/v2/scrape")) {
        return hit({ success: true, data: { markdown: "# fc markdown", metadata: { title: "FC page", sourceURL: "https://fc.example/a" } } });
      }
      if (u.endsWith("/v2/crawl") && method === "POST") {
        return hit({ success: true, id: "crawl-1", url: "https://fc.example" });
      }
      if (u.includes("/v2/crawl/crawl-1")) {
        return hit({ status: "completed", data: [{ url: "https://fc.example/a", markdown: "# crawled", metadata: { title: "C" } }] });
      }
      if (u.endsWith("/v2/map")) {
        return hit({ success: true, links: [{ url: "https://fc.example/a" }, { url: "https://fc.example/b" }] });
      }
    }
    return hit({ error: "not found" }, 404);
  }) as typeof fetch;
}

async function setupTools() {
  const db = openTestDb();
  const store = new SqliteStore(db);
  const registry = new ProviderRegistry();
  registry.register(new ExaAdapter());
  registry.register(new TavilyAdapter());
  registry.register(new FirecrawlAdapter());
  const fetchImpl = toolFetch();
  const router = new Router({
    store, registry, defaultPolicy: "auto", maxAttempts: 8, timeoutMs: 5000,
    fetchImpl,
    defaultBaseUrls: { exa: "https://api.exa.ai", tavily: "https://api.tavily.com", firecrawl: "https://api.firecrawl.dev" },
  });
  for (const p of [
    { id: "exa", name: "Exa", base: "https://api.exa.ai" },
    { id: "tavily", name: "Tavily", base: "https://api.tavily.com" },
    { id: "firecrawl", name: "Firecrawl", base: "https://api.firecrawl.dev" },
  ]) {
    store.upsertProvider({ id: p.id, displayName: p.name, baseUrl: p.base, enabled: true, priority: 10 });
    store.upsertAccount({ id: `${p.id}-main`, providerId: p.id, enabled: true });
    store.createCredential({ id: `cred-${p.id}-1`, accountId: `${p.id}-main`, secretEncrypted: encryptSecret(`${p.id}-k`), status: "active" });
  }
  for (const cap of CAPS) {
    store.upsertResource({ id: cap, kind: "capability", displayName: cap, capabilities: [cap] });
  }
  // Overlapping but NOT identical capabilities — the point of the model.
  const mappings: Array<[string, string, string[]]> = [
    ["exa", "search", ["web.search"]],
    ["exa", "contents", ["web.scrape", "web.extract"]],
    ["tavily", "search", ["web.search"]],
    ["tavily", "extract", ["web.scrape", "web.extract"]],
    ["tavily", "crawl", ["web.crawl"]],
    ["tavily", "map", ["web.map"]],
    ["firecrawl", "search", ["web.search"]],
    ["firecrawl", "scrape", ["web.scrape", "web.extract"]],
    ["firecrawl", "crawl", ["web.crawl"]],
    ["firecrawl", "map", ["web.map"]],
  ];
  for (const [provider, upstream, caps] of mappings) {
    for (const cap of caps) {
      store.upsertProviderResource({
        resourceId: cap, providerId: provider, upstreamId: upstream,
        capabilities: [cap as (typeof CAPS)[number]], enabled: true,
      });
    }
  }
  const app = await buildApp({ store, registry, router, adminToken: "", settings: { defaultPolicy: "auto" }, fetchImpl: undefined });
  return { app, store };
}

describe("generic tool capabilities", () => {
  it("scrapes via firecrawl when pinned", async () => {
    const { app } = await setupTools();
    const res = await app.inject({
      method: "POST", url: "/v1/tools/scrape",
      payload: { url: "https://fc.example/a", routing: { provider: "firecrawl" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().object).toBe("scrape.result");
    expect(res.json().markdown).toContain("fc markdown");
    expect(res.headers["x-router-via"]).toBe("firecrawl/web.scrape");
  });

  it("scrapes via exa contents endpoint", async () => {
    const { app } = await setupTools();
    const res = await app.inject({
      method: "POST", url: "/v1/tools/scrape",
      payload: { url: "https://exa.example/a", routing: { provider: "exa" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().markdown).toContain("hello exa");
  });

  it("extracts multiple URLs via tavily", async () => {
    const { app } = await setupTools();
    const res = await app.inject({
      method: "POST", url: "/v1/tools/extract",
      payload: { urls: ["https://tavily.example/b"], routing: { provider: "tavily" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().object).toBe("extract.results");
    expect(res.json().results[0].content).toContain("tavily content");
  });

  it("crawls via firecrawl (async job + poll)", async () => {
    const { app } = await setupTools();
    const res = await app.inject({
      method: "POST", url: "/v1/tools/crawl",
      payload: { url: "https://fc.example", limit: 5, routing: { provider: "firecrawl" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().object).toBe("crawl.results");
    expect(res.json().pages.length).toBe(1);
  });

  it("maps via tavily", async () => {
    const { app } = await setupTools();
    const res = await app.inject({
      method: "POST", url: "/v1/tools/map",
      payload: { url: "https://tavily.example", routing: { provider: "tavily" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().object).toBe("map.results");
    expect(res.json().links.length).toBe(2);
  });

  it("falls back across providers for the same capability", async () => {
    const { app } = await setupTools();
    const res = await app.inject({
      method: "POST", url: "/v1/tools/scrape",
      payload: { url: "https://fc.example/a", routing: { policy: "priority" } },
    });
    expect(res.statusCode).toBe(200);
    expect(Number(res.headers["x-router-attempts"])).toBeGreaterThanOrEqual(1);
  });

  it("rejects invalid tool input with 400", async () => {
    const { app } = await setupTools();
    const res = await app.inject({
      method: "POST", url: "/v1/tools/scrape", payload: { url: "not-a-url" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404/503 when no provider supports the capability", async () => {
    const { app, store } = await setupTools();
    // Remove every web.map mapping → no routes at all.
    for (const pr of store.listProviderResources("web.map")) store.deleteProviderResource(pr.id);
    const res = await app.inject({
      method: "POST", url: "/v1/tools/map", payload: { url: "https://example.com" },
    });
    expect([404, 503]).toContain(res.statusCode);
  });

  it("records pages/crawl_units usage per capability", async () => {
    const { app, store } = await setupTools();
    await app.inject({
      method: "POST", url: "/v1/tools/scrape",
      payload: { url: "https://fc.example/a", routing: { provider: "firecrawl" } },
    });
    const since = new Date(Date.now() - 60_000).toISOString();
    expect(store.sumUsage("cred-firecrawl-1", "pages", since)).toBe(1);
    expect(store.sumUsage("cred-firecrawl-1", "requests", since)).toBe(1);
  });
});

describe("plug-and-play provider contract", () => {
  it("a new tool provider needs only defineToolAdapter + registration", async () => {
    const db = openTestDb();
    const store = new SqliteStore(db);
    const registry = new ProviderRegistry();
    // A brand-new provider in ~20 lines, no core/route/quota edits.
    registry.register(
      defineToolAdapter({
        providerId: "acme",
        displayName: "Acme Search",
        defaultBaseUrl: "https://api.acme.test",
        auth: { kind: "bearer" },
        handlers: [
          {
            capability: "web.search",
            description: "Acme search",
            probe: { path: "/search", body: () => ({ q: "x" }) },
            quotaMetric: "searches",
            run: async (call) => {
              if (call.normalized.kind !== "web.search") throw new Error("wrong kind");
              await call.post("/search", { q: call.normalized.body.query });
              return { kind: "web.search", body: { results: [{ title: "acme", url: "https://acme.test", snippet: "s" }] } };
            },
          },
        ],
      }),
    );
    const fetchImpl = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
    const router = new Router({ store, registry, fetchImpl, defaultBaseUrls: { acme: "https://api.acme.test" } });
    store.upsertProvider({ id: "acme", displayName: "Acme", baseUrl: "https://api.acme.test", enabled: true, priority: 10 });
    store.upsertAccount({ id: "acme-main", providerId: "acme", enabled: true });
    store.createCredential({ id: "cred-acme-1", accountId: "acme-main", secretEncrypted: encryptSecret("k"), status: "active" });
    store.upsertResource({ id: "web.search", kind: "capability", displayName: "Web search", capabilities: ["web.search"] });
    store.upsertProviderResource({ resourceId: "web.search", providerId: "acme", upstreamId: "search", capabilities: ["web.search"], enabled: true });
    const app = await buildApp({ store, registry, router, adminToken: "", settings: { defaultPolicy: "auto" }, fetchImpl: undefined });
    const res = await app.inject({ method: "POST", url: "/v1/tools/search", payload: { query: "hi" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().results[0].title).toBe("acme");
  });
});
