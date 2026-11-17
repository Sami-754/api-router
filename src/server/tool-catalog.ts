import type { Store } from "../core/store.js";
import type { ProviderRegistry } from "../provider-sdk/registry.js";
import type { ProviderAdapter } from "../provider-sdk/types.js";
import type { Capability } from "../shared/types.js";
import { ExaAdapter } from "../adapters/exa.js";
import { TavilyAdapter } from "../adapters/tavily.js";
import { FirecrawlAdapter } from "../adapters/firecrawl.js";

export interface ToolRouteSpec {
  capability: Capability;
  upstreamId: string;
}

export interface ToolProviderSpec {
  id: string;
  displayName: string;
  baseUrl: string;
  routes: ToolRouteSpec[];
}

export interface AdapterCatalogEntry {
  id: string;
  displayName: string;
  baseUrl: string | null;
  kind: "llm" | "tool";
  capabilities: Capability[];
}

/** Providers whose adapters can be provisioned from a key without a boot restart. */
export const TOOL_PROVIDERS: Record<string, ToolProviderSpec> = {
  exa: {
    id: "exa",
    displayName: "Exa",
    baseUrl: "https://api.exa.ai",
    routes: [
      { capability: "web.search", upstreamId: "search" },
      { capability: "web.scrape", upstreamId: "contents" },
      { capability: "web.extract", upstreamId: "contents" },
    ],
  },
  tavily: {
    id: "tavily",
    displayName: "Tavily",
    baseUrl: "https://api.tavily.com",
    routes: [
      { capability: "web.search", upstreamId: "search" },
      { capability: "web.scrape", upstreamId: "extract" },
      { capability: "web.extract", upstreamId: "extract" },
      { capability: "web.crawl", upstreamId: "crawl" },
      { capability: "web.map", upstreamId: "map" },
    ],
  },
  firecrawl: {
    id: "firecrawl",
    displayName: "Firecrawl",
    baseUrl: "https://api.firecrawl.dev",
    routes: [
      { capability: "web.search", upstreamId: "search" },
      { capability: "web.scrape", upstreamId: "scrape" },
      { capability: "web.extract", upstreamId: "scrape" },
      { capability: "web.crawl", upstreamId: "crawl" },
      { capability: "web.map", upstreamId: "map" },
    ],
  },
};

const TOOL_RESOURCES: Array<{ id: Capability; displayName: string }> = [
  { id: "web.search", displayName: "Web search" },
  { id: "web.scrape", displayName: "Web scrape" },
  { id: "web.extract", displayName: "Web extract" },
  { id: "web.crawl", displayName: "Web crawl" },
  { id: "web.map", displayName: "Web map" },
];

export function ensureToolResources(store: Store): void {
  for (const resource of TOOL_RESOURCES) {
    if (!store.getResource(resource.id)) {
      store.upsertResource({
        id: resource.id,
        kind: "capability",
        displayName: resource.displayName,
        capabilities: [resource.id],
      });
    }
  }
}

/** Idempotently create the capability mappings a tool provider supports. */
export function ensureToolMappings(
  store: Store,
  providerId: string,
): Capability[] {
  const spec = TOOL_PROVIDERS[providerId.toLowerCase()];
  if (!spec) return [];
  ensureToolResources(store);
  for (const route of spec.routes) {
    store.upsertProviderResource({
      resourceId: route.capability,
      providerId: spec.id,
      upstreamId: route.upstreamId,
      capabilities: [route.capability],
      enabled: true,
    });
  }
  return [...new Set(spec.routes.map((route) => route.capability))];
}

export function createToolAdapter(
  providerId: string,
  baseUrl: string,
): ProviderAdapter | null {
  const id = providerId.toLowerCase();
  if (id === "exa") return new ExaAdapter(baseUrl);
  if (id === "tavily") return new TavilyAdapter(baseUrl);
  if (id === "firecrawl") return new FirecrawlAdapter(baseUrl);
  return null;
}

/**
 * Runtime adapters plus known installable tool adapters (which have no
 * provider row until a key is added). Used by the Add page provider picker.
 */
export function adapterCatalog(
  registry: ProviderRegistry,
): AdapterCatalogEntry[] {
  const entries = new Map<string, AdapterCatalogEntry>();

  for (const adapter of registry.list()) {
    const tool = TOOL_PROVIDERS[adapter.id];
    entries.set(adapter.id, {
      id: adapter.id,
      displayName: adapter.displayName,
      baseUrl: tool?.baseUrl ?? null,
      kind: tool ? "tool" : "llm",
      capabilities: adapter.capabilities().map((item) => item.capability),
    });
  }

  for (const tool of Object.values(TOOL_PROVIDERS)) {
    if (entries.has(tool.id)) continue;
    entries.set(tool.id, {
      id: tool.id,
      displayName: tool.displayName,
      baseUrl: tool.baseUrl,
      kind: "tool",
      capabilities: [...new Set(tool.routes.map((route) => route.capability))],
    });
  }

  return [...entries.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "tool" ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
}
