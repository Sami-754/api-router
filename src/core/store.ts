import type {
  Account,
  Capability,
  Credential,
  HealthSnapshot,
  Provider,
  ProviderErrorClass,
  ProviderResource,
  QuotaWindow,
  RequestLog,
  Resource,
  Route,
  UsageEvent,
} from "../shared/types.js";

// Storage abstraction. The SQLite implementation is the local prototype;
// migrating to PostgreSQL means implementing this interface with pg —
// callers must not import better-sqlite3 directly.

export interface CreateCredentialInput {
  id?: string;
  accountId: string;
  label?: string | null;
  secretEncrypted: string;
  status?: Credential["status"];
}

export interface Store {
  // -- providers --
  upsertProvider(p: Omit<Provider, "createdAt" | "updatedAt">): Provider;
  getProvider(id: string): Provider | undefined;
  listProviders(): Provider[];
  deleteProvider(id: string): void;

  // -- accounts --
  upsertAccount(a: Omit<Account, "createdAt" | "updatedAt">): Account;
  getAccount(id: string): Account | undefined;
  listAccounts(providerId?: string): Account[];
  deleteAccount(id: string): void;

  // -- credentials --
  createCredential(input: CreateCredentialInput): Credential;
  getCredential(id: string): Credential | undefined;
  listCredentials(accountId?: string): Credential[];
  updateCredentialStatus(id: string, status: Credential["status"]): void;
  markCredentialValidated(id: string, ok: boolean): void;

  // -- resources --
  upsertResource(r: Omit<Resource, "createdAt" | "updatedAt">): Resource;
  getResource(id: string): Resource | undefined;
  listResources(): Resource[];
  deleteResource(id: string): void;

  // -- provider resources --
  upsertProviderResource(
    r: Omit<ProviderResource, "createdAt" | "updatedAt" | "id"> & { id?: string },
  ): ProviderResource;
  getProviderResource(id: string): ProviderResource | undefined;
  listProviderResources(resourceId?: string, providerId?: string): ProviderResource[];
  setProviderResourceEnabled(id: string, enabled: boolean): void;
  deleteProviderResource(id: string): void;

  // -- route expansion --
  /** Materialize every executable route for a canonical resource/capability. */
  expandRoutes(resourceId: string, capability?: Capability): Route[];

  // -- quotas --
  upsertQuotaWindow(
    q: Omit<QuotaWindow, "id" | "createdAt" | "updatedAt" | "observedAt"> & {
      id?: string;
      observedAt?: string;
    },
  ): QuotaWindow;
  listQuotaWindows(credentialId?: string): QuotaWindow[];
  deleteQuotaWindow(id: string): void;
  recordQuotaObservation(
    q: Omit<QuotaWindow, "id" | "createdAt" | "updatedAt" | "observedAt"> & {
      id?: string;
      observedAt?: string;
    },
  ): QuotaWindow;
  incrementQuotaUsage(credentialId: string, metric: QuotaWindow["metric"], quantity: number): void;

  // -- health --
  getHealth(credentialId: string, providerResourceId?: string | null): HealthSnapshot | undefined;
  /**
   * Future cooldown that belongs to the whole API key (rate limit, quota, auth),
   * so one limited key is skipped for every model on that provider.
   */
  keyCooldownUntil(
    credentialId: string,
    nowMs?: number,
  ): { until: string; errorClass: ProviderErrorClass } | undefined;
  recordSuccess(credentialId: string, providerResourceId: string | null, latencyMs: number): void;
  recordFailure(
    credentialId: string,
    providerResourceId: string | null,
    errorClass: ProviderErrorClass,
    cooldownMs?: number,
  ): void;
  clearCooldown(credentialId: string, providerResourceId?: string | null): void;

  // -- usage + request logs --
  recordUsage(e: Omit<UsageEvent, "id" | "observedAt"> & { observedAt?: string }): UsageEvent;
  /** Sum of a metric for a credential since an ISO timestamp (rate windows). */
  sumUsage(credentialId: string, metric: UsageEvent["metric"], sinceIso: string): number;
  appendRequestLog(l: Omit<RequestLog, "createdAt">): RequestLog;
  listRequestLogs(limit?: number): RequestLog[];
  getRequestLog(id: string): RequestLog | undefined;
}
