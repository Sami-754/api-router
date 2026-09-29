import type {
  Capability,
  ProviderErrorClass,
  QuotaWindow,
  Route,
} from "../shared/types.js";

// Normalized LLM chat request (subset of OpenAI chat completions).
export interface NormalizedChatRequest {
  requestId: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string | string[];
  tools?: unknown[];
  toolChoice?: unknown;
  user?: string;
  estimatedCostTokens?: number;
}

export interface NormalizedChatResponse {
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finishReason: string | null;
  }>;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  raw?: unknown;
}

// Normalized generic tool requests/responses — same core path as LLM.
// Each capability has a portable subset; provider extras stay in adapters.
export interface NormalizedSearchRequest {
  requestId: string;
  query: string;
  maxResults: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  recencyDays?: number;
}

export interface NormalizedSearchResponse {
  results: Array<{ title: string; url: string; snippet: string; score?: number }>;
  raw?: unknown;
}

export interface NormalizedScrapeRequest {
  requestId: string;
  url: string;
  /** Max chars of returned markdown (router-side truncation guard). */
  maxChars?: number;
  onlyMainContent?: boolean;
}

export interface NormalizedScrapeResponse {
  url: string;
  title?: string;
  markdown: string;
  raw?: unknown;
}

export interface NormalizedExtractRequest {
  requestId: string;
  urls: string[];
  query?: string;
}

export interface NormalizedExtractResponse {
  results: Array<{ url: string; content: string; title?: string; error?: string }>;
  raw?: unknown;
}

export interface NormalizedCrawlRequest {
  requestId: string;
  url: string;
  limit?: number;
  includePaths?: string[];
  excludePaths?: string[];
}

export interface NormalizedCrawlResponse {
  pages: Array<{ url: string; markdown?: string; title?: string }>;
  raw?: unknown;
}

export interface NormalizedMapRequest {
  requestId: string;
  url: string;
  limit?: number;
}

export interface NormalizedMapResponse {
  links: Array<{ url: string; title?: string }>;
  raw?: unknown;
}

export type NormalizedRequest =
  | { kind: "llm.chat"; body: NormalizedChatRequest }
  | { kind: "web.search"; body: NormalizedSearchRequest }
  | { kind: "web.scrape"; body: NormalizedScrapeRequest }
  | { kind: "web.extract"; body: NormalizedExtractRequest }
  | { kind: "web.crawl"; body: NormalizedCrawlRequest }
  | { kind: "web.map"; body: NormalizedMapRequest };

export type NormalizedResponse =
  | { kind: "llm.chat"; body: NormalizedChatResponse }
  | { kind: "web.search"; body: NormalizedSearchResponse }
  | { kind: "web.scrape"; body: NormalizedScrapeResponse }
  | { kind: "web.extract"; body: NormalizedExtractResponse }
  | { kind: "web.crawl"; body: NormalizedCrawlResponse }
  | { kind: "web.map"; body: NormalizedMapResponse };

export interface StoredCredentialView {
  id: string;
  accountId: string;
  providerId: string;
  /** Decrypted secret — only handed to the adapter for execution, never logged. */
  secret: string;
}

export interface AdapterContext {
  requestId: string;
  baseUrl?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface CredentialValidationResult {
  ok: boolean;
  message?: string;
  accountHint?: string;
}

export interface DiscoveredResource {
  upstreamId: string;
  displayName?: string;
  capabilities: Capability[];
  contextTokens?: number;
}

export interface QuotaSnapshot {
  metric: QuotaWindow["metric"];
  limitValue: number;
  usedValue: number;
  remainingValue?: number | null;
  windowKind: QuotaWindow["windowKind"];
  windowSeconds?: number | null;
  resetAt?: string | null;
  source: QuotaWindow["source"];
}

export interface ProviderError {
  errorClass: ProviderErrorClass;
  message: string;
  retryable: boolean;
  statusCode?: number;
  providerCode?: string;
}

export interface CapabilityDescriptor {
  capability: Capability;
  description: string;
}

export interface ProviderAdapter {
  id: string;
  displayName: string;

  capabilities(): CapabilityDescriptor[];

  validateCredential(
    credential: StoredCredentialView,
    context: AdapterContext,
  ): Promise<CredentialValidationResult>;

  discoverResources?(
    credential: StoredCredentialView,
    context: AdapterContext,
  ): Promise<DiscoveredResource[]>;

  getQuota?(
    credential: StoredCredentialView,
    context: AdapterContext,
  ): Promise<QuotaSnapshot[]>;

  execute(
    request: NormalizedRequest,
    route: ResolvedRoute,
    context: AdapterContext,
  ): Promise<NormalizedResponse>;

  /** Optional streaming. Only llm.chat is streamed in this version. */
  executeStream?(
    request: NormalizedRequest,
    route: ResolvedRoute,
    context: AdapterContext,
  ): AsyncIterable<StreamChunk>;

  classifyError(error: unknown): ProviderError;
}

/** One streamed delta. Adapters yield content; the server frames SSE. */
export interface StreamChunk {
  delta: string;
  finishReason?: string | null;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/** Route enriched with decrypted credential for execution. Secret stays in memory only. */
export interface ResolvedRoute extends Route {
  credentialSecret: string;
  /** Effective upstream base URL (provider baseUrl or adapter default). */
  effectiveBaseUrl: string;
}
