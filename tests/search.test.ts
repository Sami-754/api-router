import { describe, expect, it } from "vitest";
import { openTestDb } from "./helpers.js";
import { SqliteStore } from "../src/db/sqlite-store.js";
import { ProviderRegistry } from "../src/provider-sdk/registry.js";
import { ExaAdapter } from "../src/adapters/exa.js";
import { TavilyAdapter } from "../src/adapters/tavily.js";
import { Router } from "../src/core/router.js";
import { buildApp } from "../src/server/app.js";
import { encryptSecret } from "../src/shared/crypto.js";

process.env.MASTER_KEY ??= "test-master-key-0123456789abcdef0123456789";

function exaJson() {
  return { results: [{ title: "Exa hit", url: "https://exa.example/a", text: "exa snippet", score: 0.9 }] };
}
function tavilyJson() {
  return { results: [{ title: "Tavily hit", url: "https://tavily.example/b", content: "tavily snippet", score: 0.8 }] };
}

async function setupSearch(fetchImpl?: typeof fetch) {
  const db = openTestDb();
  const store = new SqliteStore(db);
  const registry = new ProviderRegistry();
  registry.register(new ExaAdapter());
  registry.register(new TavilyAdapter());
  const router = new Router({
    store, registry, defaultPolicy: "auto", maxAttempts: 4, timeoutMs: 5000,
    fetchImpl: fetchImpl ?? (async (url) => {
      const u = String(url);
      const body = u.includes("exa") ? exaJson() : tavilyJson();
      return new Response(JSON.stringify(body), { status: 200 });
    }),
    defaultBaseUrls: { exa: "https://api.exa.ai", tavily: "https://api.tavily.com" },
  });
  store.upsertProvider({ id: "exa", displayName: "Exa", baseUrl: "https://api.exa.ai", enabled: true, priority: 10 });
  store.upsertProvider({ id: "tavily", displayName: "Tavily", baseUrl: "https://api.tavily.com", enabled: true, priority: 20 });
  store.upsertResource({ id: "web.search", kind: "capability", displayName: "Web search", capabilities: ["web.search"] });
  store.upsertProviderResource({ resourceId: "web.search", providerId: "exa", upstreamId: "search", capabilities: ["web.search"], enabled: true });
  store.upsertProviderResource({ resourceId: "web.search", providerId: "tavily", upstreamId: "search", capabilities: ["web.search"], enabled: true });
  store.upsertAccount({ id: "exa-main", providerId: "exa", enabled: true });
  store.upsertAccount({ id: "tavily-main", providerId: "tavily", enabled: true });
  store.createCredential({ id: "cred-exa-1", accountId: "exa-main", secretEncrypted: encryptSecret("exa-k"), status: "active" });
  store.createCredential({ id: "cred-tavily-1", accountId: "tavily-main", secretEncrypted: encryptSecret("tavily-k"), status: "active" });
  const app = await buildApp({ store, registry, router, adminToken: "", settings: { defaultPolicy: "auto" }, fetchImpl: undefined });
  return { app, store };
}

describe("web.search slice (P2)", () => {
  it("auto-routes a search across exa and tavily", async () => {
    const { app } = await setupSearch();
    const res = await app.inject({
      method: "POST", url: "/v1/tools/search", payload: { query: "router test" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results.length).toBe(1);
    expect(res.headers["x-router-via"]).toMatch(/^(exa|tavily)\//);
  });

  it("pins a search provider via routing.provider", async () => {
    const { app } = await setupSearch();
    const res = await app.inject({
      method: "POST", url: "/v1/tools/search",
      payload: { query: "x", routing: { provider: "tavily" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-router-via"]).toBe("tavily/web.search");
    expect(res.json().results[0].title).toBe("Tavily hit");
  });

  it("falls back to the other search provider on retryable failure", async () => {
    const flaky: typeof fetch = async (url) => {
      if (String(url).includes("exa")) {
        return new Response(JSON.stringify({ error: "busy" }), { status: 429 });
      }
      return new Response(JSON.stringify(tavilyJson()), { status: 200 });
    };
    const { app } = await setupSearch(flaky);
    const res = await app.inject({
      method: "POST", url: "/v1/tools/search",
      payload: { query: "x", routing: { policy: "priority" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results[0].title).toBe("Tavily hit");
    expect(Number(res.headers["x-router-attempts"])).toBeGreaterThanOrEqual(2);
  });

  it("pinned search never crosses providers", async () => {
    const dead: typeof fetch = async () => new Response("down", { status: 500 });
    const { app } = await setupSearch(dead);
    const res = await app.inject({
      method: "POST", url: "/v1/tools/search", payload: { query: "x", routing: { provider: "exa" } },
    });
    expect(res.statusCode).toBe(502);
  });

  it("adding a search provider needs no core changes (registry only)", async () => {
    const { store } = await setupSearch();
    // Same canonical capability, second exa account/cred → new executable route.
    store.upsertAccount({ id: "exa-second", providerId: "exa", enabled: true });
    store.createCredential({ id: "cred-exa-2", accountId: "exa-second", secretEncrypted: encryptSecret("k2"), status: "active" });
    expect(store.expandRoutes("web.search", "web.search").length).toBe(3);
  });
});
