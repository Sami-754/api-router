export type Capability =
  | "llm.chat"
  | "llm.responses"
  | "llm.tools"
  | "llm.vision"
  | "llm.embeddings"
  | "web.search"
  | "web.extract"
  | "web.scrape"
  | "web.crawl"
  | "web.map";

export type CredentialStatus = "active" | "disabled" | "invalid";

export interface Provider {
  id: string;
  displayName: string;
  baseUrl?: string | null;
  enabled: boolean;
  priority: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Account {
  id: string;
  providerId: string;
  displayName?: string | null;
  enabled: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Credential {
  id: string;
  accountId: string;
  providerId: string;
  label?: string | null;
  redacted?: string;
  status: CredentialStatus;
  lastValidatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Resource {
  id: string;
  kind: "llm_model" | "capability";
  displayName: string;
  capabilities: Capability[];
  contextTokens?: number | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderResource {
  id: string;
  resourceId: string;
  providerId: string;
  upstreamId: string;
  capabilities: Capability[];
  contextTokens?: number | null;
  enabled: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type QuotaMetric =
  | "requests"
  | "input_tokens"
  | "output_tokens"
  | "total_tokens"
  | "credits"
  | "usd"
  | "searches"
  | "pages"
  | "crawl_units";

export type QuotaWindowKind =
  | "rolling_seconds"
  | "calendar_minute"
  | "calendar_hour"
  | "calendar_day"
  | "calendar_week"
  | "calendar_month"
  | "fixed";

export type QuotaSource =
  "provider_api" | "response_headers" | "configured" | "learned" | "estimated";

export interface QuotaWindow {
  id: string;
  credentialId: string;
  providerResourceId?: string | null;
  metric: QuotaMetric;
  limitValue: number;
  usedValue: number;
  remainingValue?: number | null;
  windowKind: QuotaWindowKind;
  windowSeconds?: number | null;
  windowStartedAt?: string | null;
  resetAt?: string | null;
  hard: boolean;
  source: QuotaSource;
  confidence?: number | null;
  observedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface HealthSnapshot {
  credentialId: string;
  providerResourceId?: string | null;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  lastErrorClass?: string | null;
  cooldownUntil?: string | null;
  latencyEmaMs?: number | null;
  updatedAt: string;
}

export interface Route {
  routeId: string;
  providerId: string;
  accountId: string;
  credentialId: string;
  providerResourceId: string;
  resourceId: string;
  upstreamId: string;
  capabilities: Capability[];
  providerEnabled: boolean;
  accountEnabled: boolean;
  credentialStatus: CredentialStatus;
  providerResourceEnabled: boolean;
  providerPriority: number;
  quotas: QuotaWindow[];
  health?: HealthSnapshot | null;
}

export interface RequestLog {
  id: string;
  requestedResourceId: string;
  requestedCapability?: Capability | null;
  providerPin?: string | null;
  accountPin?: string | null;
  credentialPin?: string | null;
  policy: string;
  selectedProviderId?: string | null;
  selectedAccountId?: string | null;
  selectedCredentialId?: string | null;
  selectedUpstreamId?: string | null;
  selectionReason?: string | null;
  attempts: number;
  status: "success" | "error";
  errorClass?: string | null;
  errorMessage?: string | null;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  createdAt: string;
}

export interface Overview {
  providers: number;
  providersEnabled: number;
  accounts: number;
  credentials: number;
  credentialsByStatus: {
    active: number;
    disabled: number;
    invalid: number;
  };
  resources: number;
  mappings: number;
  requests24h: number;
  successRate24h: number | null;
  tokens24h: number;
}

export interface AdapterInfo {
  id: string;
  displayName: string;
  baseUrl?: string | null;
  kind?: "llm" | "tool";
  capabilities: Capability[];
}

export interface ModelSyncSummary {
  mapped: number;
  pruned: number;
  skipped: string[];
  autoFreeMappings: number;
}

export interface Settings {
  defaultPolicy: string;
  note?: string;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
}

export interface ModelInfo {
  id: string;
  object: string;
  owned_by?: string;
  capabilities?: Capability[];
}

export interface ValidationSummary {
  checked: number;
  ok: number;
  invalid: number;
  inconclusive?: number;
  skippedFresh: number;
}

export interface CredentialValidation {
  ok: boolean;
  definitive?: boolean;
  message?: string;
}

export interface UsageSummary {
  credential: string;
  since: string;
  requests?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  searches?: number;
}

export interface SearchResult {
  title?: string;
  url: string;
  snippet?: string;
  score?: number;
}

export interface ScrapeResult {
  object?: string;
  url: string;
  title?: string;
  markdown: string;
}

export interface ExtractResult {
  object?: string;
  results: Array<{
    url: string;
    content?: string;
    title?: string;
    error?: string;
  }>;
}

export interface CrawlResult {
  object?: string;
  pages: Array<{ url: string; title?: string; markdown?: string }>;
}

export interface MapResult {
  object?: string;
  links: Array<{ url: string; title?: string }>;
}
