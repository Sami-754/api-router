import type Database from "better-sqlite3";
import { loadConfig } from "../shared/config.js";
import { encryptSecret } from "../shared/crypto.js";
import { SqliteStore, openDatabase } from "../db/sqlite-store.js";
import { ProviderRegistry } from "../provider-sdk/registry.js";
import { Router } from "../core/router.js";
import type { RoutingPolicyName } from "../shared/types.js";
import { OpenAICompatibleAdapter } from "../adapters/openai-compatible.js";
import { ExaAdapter } from "../adapters/exa.js";
import { TavilyAdapter } from "../adapters/tavily.js";
import { FirecrawlAdapter } from "../adapters/firecrawl.js";
import { syncProviderModels } from "./free-models.js";
import { buildApp } from "./app.js";

export interface BootOptions {
  databasePath?: string;
  db?: Database.Database;
  fetchImpl?: typeof fetch;
  seed?: boolean;
}

/** Extra headers for gateway providers that recommend them. */
const EXTRA_HEADERS: Record<string, Record<string, string>> = {
  openrouter: {
    "HTTP-Referer": "https://github.com/api-router",
    "X-Title": "api-router",
  },
  requesty: {
    "HTTP-Referer": "https://github.com/api-router",
    "X-Title": "api-router",
  },
};

export async function boot(opts: BootOptions = {}) {
  const config = loadConfig();
  const db = opts.db ?? openDatabase(opts.databasePath ?? config.databasePath);
  const store = new SqliteStore(db);

  const registry = new ProviderRegistry();

  if (opts.seed ?? true) seedDemo(store);
  ensureToolResources(store);

  // Every provider row gets an adapter using its stored baseUrl. Adapter
  // class is chosen by provider id (exa/tavily/firecrawl have tool adapters;
  // everything else speaks OpenAI-compatible chat). Adding a provider = one
  // DB row (+ credentials + mappings); no core edits.
  const baseUrls: Record<string, string> = {
    groq: "https://api.groq.com/openai/v1",
    openrouter: "https://openrouter.ai/api/v1",
    exa: "https://api.exa.ai",
    tavily: "https://api.tavily.com",
    firecrawl: "https://api.firecrawl.dev",
  };
  for (const p of store.listProviders()) {
    if (p.baseUrl) baseUrls[p.id] = p.baseUrl;
    // Providers without any base URL get no adapter → their routes are
    // filtered as "no adapter" instead of failing at execution time.
    if (!registry.get(p.id) && (p.baseUrl || baseUrls[p.id])) {
      const base = (p.baseUrl ?? baseUrls[p.id]) as string;
      if (p.id === "exa") registry.register(new ExaAdapter(base));
      else if (p.id === "tavily") registry.register(new TavilyAdapter(base));
      else if (p.id === "firecrawl")
        registry.register(new FirecrawlAdapter(base));
      else {
        registry.register(
          new OpenAICompatibleAdapter({
            providerId: p.id,
            displayName: p.displayName,
            defaultBaseUrl: base,
            extraHeaders: EXTRA_HEADERS[p.id],
          }),
        );
      }
    }
  }

  const router = new Router({
    store,
    registry,
    defaultPolicy: (config.defaultPolicy as RoutingPolicyName) ?? "auto",
    maxAttempts: 64,
    timeoutMs: 60_000,
    fetchImpl: opts.fetchImpl,
    defaultBaseUrls: baseUrls,
  });

  // Model sync: every boot re-pulls each provider's live /models, maps all
  // advertised chat models (free or not — the dashboard badges free ones),
  // and prunes models the provider no longer lists. Providers whose
  // discovery fails keep existing mappings (never wipe on a network blip).
  try {
    const sync = await syncProviderModels({ store, fetchImpl: opts.fetchImpl });
    console.log(
      `[api-router] model sync: ${sync.mapped} mappings, ${sync.pruned} stale pruned` +
        (sync.skipped.length
          ? `, discovery failed: ${sync.skipped.join(",")}`
          : ""),
    );
  } catch (e) {
    console.warn(
      `[api-router] model sync failed: ${e instanceof Error ? e.message : String(e)} (existing mappings kept)`,
    );
  }

  const app = await buildApp({
    store,
    registry,
    router,
    settings: { defaultPolicy: config.defaultPolicy },
    fetchImpl: opts.fetchImpl,
  });

  return { app, config, store, registry, router, db };
}

/**
 * Capability resources for the generic tool path. Runs on every boot
 * (idempotent) — unlike seedDemo, which returns early once providers exist.
 * Provider mappings (exa/tavily/…) are added with credentials; nothing routes
 * until a mapping row exists for that provider.
 */
const TOOL_RESOURCES: Array<{ id: string; displayName: string }> = [
  { id: "web.search", displayName: "Web search" },
  { id: "web.scrape", displayName: "Web scrape" },
  { id: "web.extract", displayName: "Web extract" },
  { id: "web.crawl", displayName: "Web crawl" },
  { id: "web.map", displayName: "Web map" },
];

function ensureToolResources(store: SqliteStore): void {
  for (const t of TOOL_RESOURCES) {
    if (!store.getResource(t.id)) {
      store.upsertResource({
        id: t.id,
        kind: "capability",
        displayName: t.displayName,
        capabilities: [t.id as "web.search"],
      });
    }
  }
}

/** Minimal demo seed: canonical model + two provider mappings. Idempotent. */
function seedDemo(store: SqliteStore): void {
  if (store.listProviders().length > 0) return;
  store.upsertProvider({
    id: "groq",
    displayName: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    enabled: true,
    priority: 10,
  });
  store.upsertProvider({
    id: "openrouter",
    displayName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    enabled: true,
    priority: 20,
  });

  const canonical = "llm:model:nemotron-3-super-120b";
  store.upsertResource({
    id: canonical,
    kind: "llm_model",
    displayName: "Nemotron 3 Super 120B",
    capabilities: ["llm.chat", "llm.tools"],
  });
  store.upsertProviderResource({
    resourceId: canonical,
    providerId: "groq",
    upstreamId: "nvidia/nemotron-3-super-120b",
    capabilities: ["llm.chat", "llm.tools"],
    enabled: true,
  });
  store.upsertProviderResource({
    resourceId: canonical,
    providerId: "openrouter",
    upstreamId: "nvidia/nemotron-3-super-120b",
    capabilities: ["llm.chat", "llm.tools"],
    enabled: true,
  }); // Accounts are routing-level groupings; credentials attach here.
  store.upsertAccount({
    id: "groq-main",
    providerId: "groq",
    displayName: "Groq main",
    enabled: true,
  });
  store.upsertAccount({
    id: "openrouter-main",
    providerId: "openrouter",
    displayName: "OpenRouter main",
    enabled: true,
  });

  // Generic tool capability — same routing core as LLMs. Provider mappings
  // (exa/tavily/…) are added with credentials; nothing to seed without keys.
  if (!store.getResource("web.search")) {
    store.upsertResource({
      id: "web.search",
      kind: "capability",
      displayName: "Web search",
      capabilities: ["web.search"],
    });
  }

  // Optional: import demo credentials from env (never committed).
  const groqKey = process.env.GROQ_API_KEY;
  const orKey = process.env.OPENROUTER_API_KEY;
  if (groqKey && !process.env.MASTER_KEY) {
    // skip: cannot encrypt without MASTER_KEY
  } else {
    if (groqKey) {
      try {
        store.createCredential({
          id: "cred-groq-main",
          accountId: "groq-main",
          label: "groq main (env)",
          secretEncrypted: encryptSecret(groqKey),
          status: "active",
        });
      } catch {
        /* already seeded */
      }
    }
    if (orKey) {
      try {
        store.createCredential({
          id: "cred-openrouter-main",
          accountId: "openrouter-main",
          label: "openrouter main (env)",
          secretEncrypted: encryptSecret(orKey),
          status: "active",
        });
      } catch {
        /* already seeded */
      }
    }
  }
}
