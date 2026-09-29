import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { openTestDb } from "./helpers.js";
import { SqliteStore } from "../src/db/sqlite-store.js";
import { ProviderRegistry } from "../src/provider-sdk/registry.js";
import { TavilyAdapter } from "../src/adapters/tavily.js";
import { Router } from "../src/core/router.js";
import { buildApp } from "../src/server/app.js";
import { createMcpServer } from "../src/server/mcp.js";
import { encryptSecret } from "../src/shared/crypto.js";
import type { FastifyInstance } from "fastify";

process.env.MASTER_KEY ??= "test-master-key-0123456789abcdef0123456789";

// Bridge MCP's fetch to a live Fastify app (no network, no secrets).
function appFetch(app: FastifyInstance): typeof fetch {
  return (async (url, init) => {
    const u = new URL(String(url));
    const res = await app.inject({
      method: ((init as RequestInit)?.method ?? "GET") as "POST",
      url: u.pathname,
      payload: (init as RequestInit)?.body ? JSON.parse(String((init as RequestInit).body)) : undefined,
    });
    return new Response(res.body, { status: res.statusCode });
  }) as typeof fetch;
}

async function setupMcp() {
  const db = openTestDb();
  const store = new SqliteStore(db);
  const registry = new ProviderRegistry();
  registry.register(new TavilyAdapter());
  const router = new Router({
    store, registry, defaultPolicy: "auto", maxAttempts: 4, timeoutMs: 5000,
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({ results: [{ title: "T hit", url: "https://t.example/a", content: "snippet", score: 1 }] }),
        { status: 200 },
      )) as typeof fetch,
    defaultBaseUrls: { tavily: "https://api.tavily.com" },
  });
  store.upsertProvider({ id: "tavily", displayName: "Tavily", baseUrl: "https://api.tavily.com", enabled: true, priority: 10 });
  store.upsertAccount({ id: "tavily-main", providerId: "tavily", enabled: true });
  store.createCredential({ id: "cred-t-1", accountId: "tavily-main", secretEncrypted: encryptSecret("k"), status: "active" });
  // Only web.search is mapped — scrape must report "not configured", proving
  // MCP calls flow through real router eligibility.
  store.upsertResource({ id: "web.search", kind: "capability", displayName: "Web search", capabilities: ["web.search"] });
  store.upsertProviderResource({ resourceId: "web.search", providerId: "tavily", upstreamId: "search", capabilities: ["web.search"], enabled: true });
  const app = await buildApp({ store, registry, router, adminToken: "", settings: { defaultPolicy: "auto" }, fetchImpl: undefined });

  const server = createMcpServer({ routerUrl: "http://router.test", fetchImpl: appFetch(app) });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return { client };
}

describe("MCP wrapper", () => {
  it("lists the six router tools", async () => {
    const { client } = await setupMcp();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["chat", "web_crawl", "web_extract", "web_map", "web_scrape", "web_search"],
    );
    await client.close();
  });

  it("web_search forwards through the routing core", async () => {
    const { client } = await setupMcp();
    const res = await client.callTool({ name: "web_search", arguments: { query: "hi" } });
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(text).results[0].title).toBe("T hit");
    await client.close();
  });

  it("unmapped capabilities surface as tool errors, not crashes", async () => {
    const { client } = await setupMcp();
    const res = await client.callTool({ name: "web_scrape", arguments: { url: "https://t.example/a" } });
    expect(res.isError).toBe(true);
    await client.close();
  });
});
