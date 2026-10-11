// Shared domain types. The router core distinguishes:
//   resource           = canonical thing the client wants (e.g. llm:model:nemotron-3-super-120b, web.search)
//   provider_resource  = provider-specific representation of that resource
//   route              = executable path: provider + account + credential + endpoint + provider_resource

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

export interface Provider {
  id: string; // e.g. "groq", "openrouter", "exa"
  displayName: string;
  baseUrl?: string | null;
  enabled: boolean;
  priority: number; // lower = preferred for `priority` policy
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Account {
  id: string; // e.g. "groq-main"
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
  /** Encrypted at rest. Never returned by management APIs. */
  secretEncrypted: string;
  status: "active" | "disabled" | "invalid";
  lastValidatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Resource {
  /** Canonical id, e.g. "llm:model:nemotron-3-super-120b" or capability "web.search". */
  id: string;
  kind: "llm_model" | "capability";
  displayName: string;
  capabilities: Capability[];
  /** Max context tokens, if known (used for eligibility). */
  contextTokens?: number | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderResource {
  id: string;
  resourceId: string; // canonical
  providerId: string;
  /** Upstream model id or endpoint path fragment, e.g. "nvidia/nemotron-3-super-120b". */
  upstreamId: string;
  capabilities: Capability[];
  contextTokens?: number | null;
  enabled: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** One executable route candidate. Materialized by joining provider/account/credential/provider_resource. */
export interface Route {
  routeId: string; // stable synthetic id: providerId:accountId:credentialId:providerResourceId
  providerId: string;
  accountId: string;
  credentialId: string;
  providerResourceId: string;
  resourceId: string;
  upstreamId: string;
  capabilities: Capability[];
  providerEnabled: boolean;
  accountEnabled: boolean;
  credentialStatus: Credential["status"];
  providerResourceEnabled: boolean;
  providerPriority: number;
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
  /** Hard exhaustion blocks routing; soft is advisory. */
  hard: boolean;
  source: QuotaSource;
  confidence?: number | null;
  observedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type ProviderErrorClass =
  | "auth"
  | "rate_limit"
  | "quota_exhausted"
  | "provider_unavailable"
  | "timeout"
  | "bad_request"
  | "unsupported"
  | "context_limit"
  | "network"
  | "unknown";

export interface HealthSnapshot {
  credentialId: string;
  providerResourceId?: string | null;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  lastErrorClass?: ProviderErrorClass | null;
  cooldownUntil?: string | null;
  latencyEmaMs?: number | null;
  updatedAt: string;
}

export interface UsageEvent {
  id: string;
  requestId: string;
  credentialId: string;
  providerResourceId?: string | null;
  metric: QuotaMetric;
  quantity: number;
  observedAt: string;
}

export interface RequestLog {
  id: string; // request id
  requestedResourceId: string;
  requestedCapability?: Capability | null;
  providerPin?: string | null;
  accountPin?: string | null;
  credentialPin?: string | null;
  policy: string;
  selectedProviderId?: string | null;
  selectedAccountId?: string | null;
  selectedCredentialId?: string | null; // stored, redacted in API list? we return truncated
  selectedUpstreamId?: string | null;
  selectionReason?: string | null;
  attempts: number;
  status: "success" | "error";
  errorClass?: ProviderErrorClass | null;
  errorMessage?: string | null;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  createdAt: string;
}

export type RoutingPolicyName =
  "auto" | "burn" | "preserve" | "fast" | "reliable" | "cheap" | "priority";

export interface RoutingHint {
  provider?: string | null;
  account?: string | null;
  credential?: string | null;
  policy?: RoutingPolicyName | null;
  /** When true, a provider-pinned request may cross providers on fallback. Default false. */
  allowCrossProviderFallback?: boolean | null;
  /** Estimated cost used by quota-aware scorers (e.g. tokens). */
  estimatedCost?: number | null;
}
