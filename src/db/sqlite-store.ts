import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "./schema.js";
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
import { newId, nowIso } from "../shared/crypto.js";
import type { CreateCredentialInput, Store } from "../core/store.js";

const bool = (v: unknown) => (v ? 1 : 0);
const unbool = (v: unknown) => v === 1 || v === true;

function mapHealth(row: Record<string, unknown>): HealthSnapshot {
  return {
    credentialId: String(row.credential_id),
    providerResourceId: (row.provider_resource_id as string | null) ?? null,
    successCount: Number(row.success_count),
    failureCount: Number(row.failure_count),
    consecutiveFailures: Number(row.consecutive_failures),
    lastSuccessAt: (row.last_success_at as string | null) ?? null,
    lastFailureAt: (row.last_failure_at as string | null) ?? null,
    lastErrorClass: (row.last_error_class as ProviderErrorClass | null) ?? null,
    cooldownUntil: (row.cooldown_until as string | null) ?? null,
    latencyEmaMs: (row.latency_ema_ms as number | null) ?? null,
    updatedAt: String(row.updated_at),
  };
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function mapProvider(row: Record<string, unknown>): Provider {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    baseUrl: (row.base_url as string | null) ?? null,
    enabled: unbool(row.enabled),
    priority: Number(row.priority),
    metadata: parseJson(row.metadata, undefined),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapAccount(row: Record<string, unknown>): Account {
  return {
    id: String(row.id),
    providerId: String(row.provider_id),
    displayName: (row.display_name as string | null) ?? null,
    enabled: unbool(row.enabled),
    metadata: parseJson(row.metadata, undefined),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapCredential(row: Record<string, unknown>): Credential {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    providerId: String(row.provider_id),
    label: (row.label as string | null) ?? null,
    secretEncrypted: String(row.secret_encrypted),
    status: row.status as Credential["status"],
    lastValidatedAt: (row.last_validated_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapResource(row: Record<string, unknown>): Resource {
  return {
    id: String(row.id),
    kind: row.kind as Resource["kind"],
    displayName: String(row.display_name),
    capabilities: parseJson<Capability[]>(row.capabilities, []),
    contextTokens: (row.context_tokens as number | null) ?? null,
    metadata: parseJson(row.metadata, undefined),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProviderResource(row: Record<string, unknown>): ProviderResource {
  return {
    id: String(row.id),
    resourceId: String(row.resource_id),
    providerId: String(row.provider_id),
    upstreamId: String(row.upstream_id),
    capabilities: parseJson<Capability[]>(row.capabilities, []),
    contextTokens: (row.context_tokens as number | null) ?? null,
    enabled: unbool(row.enabled),
    metadata: parseJson(row.metadata, undefined),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapQuotaWindow(row: Record<string, unknown>): QuotaWindow {
  return {
    id: String(row.id),
    credentialId: String(row.credential_id),
    providerResourceId: (row.provider_resource_id as string | null) ?? null,
    metric: row.metric as QuotaWindow["metric"],
    limitValue: Number(row.limit_value),
    usedValue: Number(row.used_value),
    remainingValue:
      row.remaining_value == null ? null : Number(row.remaining_value),
    windowKind: row.window_kind as QuotaWindow["windowKind"],
    windowSeconds: (row.window_seconds as number | null) ?? null,
    windowStartedAt: (row.window_started_at as string | null) ?? null,
    resetAt: (row.reset_at as string | null) ?? null,
    hard: unbool(row.hard),
    source: row.source as QuotaWindow["source"],
    confidence: (row.confidence as number | null) ?? null,
    observedAt: String(row.observed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapRequestLog(row: Record<string, unknown>): RequestLog {
  return {
    id: String(row.id),
    requestedResourceId: String(row.requested_resource_id),
    requestedCapability:
      (row.requested_capability as RequestLog["requestedCapability"]) ?? null,
    providerPin: (row.provider_pin as string | null) ?? null,
    accountPin: (row.account_pin as string | null) ?? null,
    credentialPin: (row.credential_pin as string | null) ?? null,
    policy: String(row.policy),
    selectedProviderId: (row.selected_provider_id as string | null) ?? null,
    selectedAccountId: (row.selected_account_id as string | null) ?? null,
    selectedCredentialId: (row.selected_credential_id as string | null) ?? null,
    selectedUpstreamId: (row.selected_upstream_id as string | null) ?? null,
    selectionReason: (row.selection_reason as string | null) ?? null,
    attempts: Number(row.attempts),
    status: row.status as RequestLog["status"],
    errorClass: (row.error_class as RequestLog["errorClass"]) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    latencyMs: Number(row.latency_ms),
    promptTokens: (row.prompt_tokens as number | null) ?? null,
    completionTokens: (row.completion_tokens as number | null) ?? null,
    totalTokens: (row.total_tokens as number | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export function openDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA_SQL);
  return db;
}

export class SqliteStore implements Store {
  constructor(private db: Database.Database) {}

  // ---------- providers ----------
  upsertProvider(p: Omit<Provider, "createdAt" | "updatedAt">): Provider {
    const now = nowIso();
    const existing = this.getProvider(p.id);
    this.db
      .prepare(
        `INSERT INTO providers (id, display_name, base_url, enabled, priority, metadata, created_at, updated_at)
         VALUES (@id, @displayName, @baseUrl, @enabled, @priority, @metadata, @now, @now)
         ON CONFLICT(id) DO UPDATE SET display_name=@displayName, base_url=@baseUrl, enabled=@enabled, priority=@priority, metadata=@metadata, updated_at=@now`,
      )
      .run({
        id: p.id.toLowerCase(),
        displayName: p.displayName,
        baseUrl: p.baseUrl ?? null,
        enabled: bool(p.enabled),
        priority: p.priority,
        metadata: p.metadata ? JSON.stringify(p.metadata) : null,
        now: existing?.createdAt ?? now,
      });
    return this.getProvider(p.id)!;
  }

  getProvider(id: string): Provider | undefined {
    const r = this.db
      .prepare(`SELECT * FROM providers WHERE id = ?`)
      .get(id.toLowerCase()) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return mapProvider(r);
  }

  listProviders(): Provider[] {
    const rows = this.db
      .prepare(`SELECT * FROM providers ORDER BY priority ASC, id ASC`)
      .all() as Record<string, unknown>[];
    return rows.map(mapProvider);
  }

  deleteProvider(id: string): void {
    this.db.prepare(`DELETE FROM providers WHERE id = ?`).run(id);
  }

  // ---------- accounts ----------
  upsertAccount(a: Omit<Account, "createdAt" | "updatedAt">): Account {
    const now = nowIso();
    const existing = this.getAccount(a.id);
    if (existing && existing.providerId !== a.providerId.toLowerCase()) {
      throw new Error(
        "an existing account cannot be moved to a different provider",
      );
    }
    this.db
      .prepare(
        `INSERT INTO accounts (id, provider_id, display_name, enabled, metadata, created_at, updated_at)
         VALUES (@id, @providerId, @displayName, @enabled, @metadata, @now, @now)
         ON CONFLICT(id) DO UPDATE SET provider_id=@providerId, display_name=@displayName, enabled=@enabled, metadata=@metadata, updated_at=@now`,
      )
      .run({
        id: a.id,
        providerId: a.providerId.toLowerCase(),
        displayName: a.displayName ?? null,
        enabled: bool(a.enabled),
        metadata: a.metadata ? JSON.stringify(a.metadata) : null,
        now: existing?.createdAt ?? now,
      });
    return this.getAccount(a.id)!;
  }

  getAccount(id: string): Account | undefined {
    const r = this.db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    if (!r) return undefined;
    return mapAccount(r);
  }

  listAccounts(providerId?: string): Account[] {
    const rows = providerId
      ? (this.db
          .prepare(`SELECT * FROM accounts WHERE provider_id = ? ORDER BY id`)
          .all(providerId.toLowerCase()) as Record<string, unknown>[])
      : (this.db.prepare(`SELECT * FROM accounts ORDER BY id`).all() as Record<
          string,
          unknown
        >[]);
    return rows.map(mapAccount);
  }

  deleteAccount(id: string): void {
    this.db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
  }

  // ---------- credentials ----------
  createCredential(input: CreateCredentialInput): Credential {
    const account = this.getAccount(input.accountId);
    if (!account) throw new Error(`unknown account: ${input.accountId}`);
    const now = nowIso();
    const id = input.id ?? newId("cred");
    this.db
      .prepare(
        `INSERT INTO credentials (id, account_id, provider_id, label, secret_encrypted, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        account.id,
        account.providerId,
        input.label ?? null,
        input.secretEncrypted,
        input.status ?? "active",
        now,
        now,
      );
    return this.getCredential(id)!;
  }

  getCredential(id: string): Credential | undefined {
    const r = this.db
      .prepare(`SELECT * FROM credentials WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return mapCredential(r);
  }

  listCredentials(accountId?: string): Credential[] {
    const rows = accountId
      ? (this.db
          .prepare(`SELECT * FROM credentials WHERE account_id = ? ORDER BY id`)
          .all(accountId) as Record<string, unknown>[])
      : (this.db
          .prepare(`SELECT * FROM credentials ORDER BY id`)
          .all() as Record<string, unknown>[]);
    return rows.map(mapCredential);
  }

  updateCredentialStatus(id: string, status: Credential["status"]): void {
    this.db
      .prepare(`UPDATE credentials SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, nowIso(), id);
  }

  updateCredentialLabel(id: string, label: string | null): void {
    this.db
      .prepare(`UPDATE credentials SET label = ?, updated_at = ? WHERE id = ?`)
      .run(label, nowIso(), id);
  }

  markCredentialValidated(id: string, ok: boolean): void {
    this.db
      .prepare(
        `UPDATE credentials SET status = CASE WHEN status = 'disabled' THEN status ELSE ? END, last_validated_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(ok ? "active" : "invalid", nowIso(), nowIso(), id);
  }

  deleteCredential(id: string): void {
    this.db.prepare(`DELETE FROM credentials WHERE id = ?`).run(id);
  }

  deleteResource(id: string): void {
    this.db.prepare(`DELETE FROM resources WHERE id = ?`).run(id);
  }

  // ---------- resources ----------
  upsertResource(r: Omit<Resource, "createdAt" | "updatedAt">): Resource {
    const now = nowIso();
    const existing = this.getResource(r.id);
    this.db
      .prepare(
        `INSERT INTO resources (id, kind, display_name, capabilities, context_tokens, metadata, created_at, updated_at)
         VALUES (@id, @kind, @displayName, @caps, @ctx, @metadata, @now, @now)
         ON CONFLICT(id) DO UPDATE SET kind=@kind, display_name=@displayName, capabilities=@caps, context_tokens=@ctx, metadata=@metadata, updated_at=@now`,
      )
      .run({
        id: r.id,
        kind: r.kind,
        displayName: r.displayName,
        caps: JSON.stringify(r.capabilities ?? []),
        ctx: r.contextTokens ?? null,
        metadata: r.metadata ? JSON.stringify(r.metadata) : null,
        now: existing?.createdAt ?? now,
      });
    return this.getResource(r.id)!;
  }

  getResource(id: string): Resource | undefined {
    const r = this.db
      .prepare(`SELECT * FROM resources WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return mapResource(r);
  }

  resolveResourceByModel(
    logicalModel: string,
    providerPin?: string | null,
  ): Resource | undefined {
    const canonicalId = `llm:model:${logicalModel.toLowerCase()}`;
    const direct = this.getResource(canonicalId);
    if (direct) return direct;

    let sql = `SELECT resource_id FROM provider_resources WHERE LOWER(upstream_id) = ?`;
    const params: string[] = [logicalModel.toLowerCase()];
    if (providerPin) {
      sql += ` AND provider_id = ?`;
      params.push(providerPin.toLowerCase());
    }
    sql += ` ORDER BY enabled DESC LIMIT 1`;
    const row = this.db.prepare(sql).get(...params) as
      { resource_id: string } | undefined;
    if (row) {
      return this.getResource(row.resource_id);
    }
    return undefined;
  }

  listResources(): Resource[] {
    const rows = this.db
      .prepare(`SELECT * FROM resources ORDER BY id`)
      .all() as Record<string, unknown>[];
    return rows.map(mapResource);
  }

  // ---------- provider resources ----------
  upsertProviderResource(
    r: Omit<ProviderResource, "createdAt" | "updatedAt" | "id"> & {
      id?: string;
    },
  ): ProviderResource {
    const now = nowIso();
    const id =
      r.id ??
      `${r.resourceId}::${r.providerId}::${r.upstreamId}`
        .toLowerCase()
        .replace(/[^a-z0-9:_\-./]+/g, "-");
    const existing = this.getProviderResource(id);
    this.db
      .prepare(
        `INSERT INTO provider_resources (id, resource_id, provider_id, upstream_id, capabilities, context_tokens, enabled, metadata, created_at, updated_at)
         VALUES (@id, @resourceId, @providerId, @upstreamId, @caps, @ctx, @enabled, @metadata, @now, @now)
         ON CONFLICT(id) DO UPDATE SET resource_id=@resourceId, provider_id=@providerId, upstream_id=@upstreamId, capabilities=@caps, context_tokens=@ctx, enabled=@enabled, metadata=@metadata, updated_at=@now`,
      )
      .run({
        id,
        resourceId: r.resourceId,
        providerId: r.providerId.toLowerCase(),
        upstreamId: r.upstreamId,
        caps: JSON.stringify(r.capabilities ?? []),
        ctx: r.contextTokens ?? null,
        enabled: bool(r.enabled),
        metadata: r.metadata ? JSON.stringify(r.metadata) : null,
        now: existing?.createdAt ?? now,
      });
    // unique(resource_id, provider_id, upstream_id) may collide on different id casing — upsert by id is primary path.
    return this.getProviderResource(id)!;
  }

  getProviderResource(id: string): ProviderResource | undefined {
    const r = this.db
      .prepare(`SELECT * FROM provider_resources WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return mapProviderResource(r);
  }

  listProviderResources(
    resourceId?: string,
    providerId?: string,
  ): ProviderResource[] {
    let sql = `SELECT * FROM provider_resources`;
    const args: string[] = [];
    const conds: string[] = [];
    if (resourceId) {
      conds.push(`resource_id = ?`);
      args.push(resourceId);
    }
    if (providerId) {
      conds.push(`provider_id = ?`);
      args.push(providerId.toLowerCase());
    }
    if (conds.length) sql += ` WHERE ` + conds.join(" AND ");
    sql += ` ORDER BY resource_id, provider_id, upstream_id`;
    const rows = this.db.prepare(sql).all(...args) as Record<string, unknown>[];
    return rows.map(mapProviderResource);
  }

  setProviderResourceEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare(
        `UPDATE provider_resources SET enabled = ?, updated_at = ? WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, nowIso(), id);
  }

  deleteProviderResource(id: string): void {
    this.db.prepare(`DELETE FROM provider_resources WHERE id = ?`).run(id);
  }

  expandRoutes(resourceId: string, capability?: Capability): Route[] {
    const prs = this.listProviderResources(resourceId);
    const providers = new Map(this.listProviders().map((p) => [p.id, p]));
    const accounts = this.listAccounts();
    const accountsByProvider = new Map<string, Account[]>();
    for (const a of accounts) {
      const list = accountsByProvider.get(a.providerId) ?? [];
      list.push(a);
      accountsByProvider.set(a.providerId, list);
    }
    const credsByAccount = new Map<string, Credential[]>();
    for (const c of this.listCredentials()) {
      const list = credsByAccount.get(c.accountId) ?? [];
      list.push(c);
      credsByAccount.set(c.accountId, list);
    }
    const out: Route[] = [];
    for (const pr of prs) {
      const aliasOf = pr.metadata?.aliasOf;
      const source =
        typeof aliasOf === "string" ? this.getProviderResource(aliasOf) : pr;
      const validSource =
        source &&
        source.providerId === pr.providerId &&
        source.upstreamId === pr.upstreamId;
      const capabilities = validSource ? source.capabilities : [];
      if (capability && !capabilities.includes(capability)) continue;
      const provider = providers.get(pr.providerId);
      if (!provider) continue;
      for (const account of accountsByProvider.get(pr.providerId) ?? []) {
        for (const cred of credsByAccount.get(account.id) ?? []) {
          out.push({
            routeId: `${pr.providerId}:${account.id}:${cred.id}:${pr.id}`,
            providerId: pr.providerId,
            accountId: account.id,
            credentialId: cred.id,
            providerResourceId: validSource ? source.id : pr.id,
            resourceId: pr.resourceId,
            upstreamId: pr.upstreamId,
            capabilities,
            providerEnabled: provider.enabled,
            accountEnabled: account.enabled,
            credentialStatus: cred.status,
            providerResourceEnabled:
              pr.enabled && Boolean(validSource && source.enabled),
            providerPriority: provider.priority,
          });
        }
      }
    }
    return out;
  }

  // ---------- quotas ----------
  upsertQuotaWindow(
    q: Omit<QuotaWindow, "id" | "createdAt" | "updatedAt" | "observedAt"> & {
      id?: string;
      observedAt?: string;
    },
  ): QuotaWindow {
    const now = nowIso();
    const id = q.id ?? newId("quota");
    const existing = this.db
      .prepare(`SELECT created_at FROM quota_windows WHERE id = ?`)
      .get(id) as { created_at: string } | undefined;
    this.db
      .prepare(
        `INSERT INTO quota_windows (id, credential_id, provider_resource_id, metric, limit_value, used_value, remaining_value, window_kind, window_seconds, window_started_at, reset_at, hard, source, confidence, observed_at, created_at, updated_at)
         VALUES (@id, @credentialId, @prId, @metric, @limitValue, @usedValue, @remainingValue, @windowKind, @windowSeconds, @windowStartedAt, @resetAt, @hard, @source, @confidence, @observedAt, @now, @now)
         ON CONFLICT(id) DO UPDATE SET credential_id=@credentialId, provider_resource_id=@prId, metric=@metric, limit_value=@limitValue, used_value=@usedValue, remaining_value=@remainingValue, window_kind=@windowKind, window_seconds=@windowSeconds, window_started_at=@windowStartedAt, reset_at=@resetAt, hard=@hard, source=@source, confidence=@confidence, observed_at=@observedAt, updated_at=@now`,
      )
      .run({
        id,
        credentialId: q.credentialId,
        prId: q.providerResourceId ?? null,
        metric: q.metric,
        limitValue: q.limitValue,
        usedValue: q.usedValue,
        remainingValue: q.remainingValue ?? null,
        windowKind: q.windowKind,
        windowSeconds: q.windowSeconds ?? null,
        windowStartedAt: q.windowStartedAt ?? null,
        resetAt: q.resetAt ?? null,
        hard: bool(q.hard),
        source: q.source,
        confidence: q.confidence ?? null,
        observedAt: q.observedAt ?? now,
        now: existing?.created_at ?? now,
      });
    return this.listQuotaWindows(q.credentialId).find((w) => w.id === id)!;
  }

  listQuotaWindows(credentialId?: string): QuotaWindow[] {
    const rows = credentialId
      ? (this.db
          .prepare(
            `SELECT * FROM quota_windows WHERE credential_id = ? ORDER BY reset_at ASC`,
          )
          .all(credentialId) as Record<string, unknown>[])
      : (this.db
          .prepare(`SELECT * FROM quota_windows ORDER BY reset_at ASC`)
          .all() as Record<string, unknown>[]);
    return rows.map(mapQuotaWindow);
  }

  listQuotaWindowsForCredentials(credentialIds: string[]): QuotaWindow[] {
    return this.queryByCredentialIds(
      "SELECT * FROM quota_windows WHERE credential_id IN",
      "ORDER BY reset_at ASC",
      credentialIds,
      mapQuotaWindow,
    );
  }

  deleteQuotaWindow(id: string): void {
    this.db.prepare(`DELETE FROM quota_windows WHERE id = ?`).run(id);
  }

  recordQuotaObservation(
    q: Omit<QuotaWindow, "id" | "createdAt" | "updatedAt" | "observedAt"> & {
      id?: string;
      observedAt?: string;
    },
  ): QuotaWindow {
    return this.upsertQuotaWindow(q);
  }

  incrementQuotaUsage(
    credentialId: string,
    metric: QuotaWindow["metric"],
    quantity: number,
    providerResourceId?: string,
  ): void {
    // Scoped updates touch global windows plus windows scoped to the
    // given provider resource — never another resource's windows.
    const scope = providerResourceId
      ? " AND (provider_resource_id IS NULL OR provider_resource_id = ?)"
      : "";
    this.db
      .prepare(
        `UPDATE quota_windows SET used_value = used_value + ?, remaining_value = CASE WHEN remaining_value IS NULL THEN NULL ELSE MAX(0, remaining_value - ?) END, observed_at = ?, updated_at = ? WHERE credential_id = ? AND metric = ?${scope}`,
      )
      .run(
        quantity,
        quantity,
        nowIso(),
        nowIso(),
        credentialId,
        metric,
        ...(providerResourceId ? [providerResourceId] : []),
      );
  }

  // ---------- health ----------
  getHealth(
    credentialId: string,
    providerResourceId?: string | null,
  ): HealthSnapshot | undefined {
    const key = providerResourceId ?? null;
    // Exact pair only. A miss must not inherit some other model's snapshot.
    const row = this.db
      .prepare(
        `SELECT * FROM health_snapshots WHERE credential_id = ? AND provider_resource_id IS ?`,
      )
      .get(credentialId, key) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return mapHealth(row);
  }

  listHealthForCredentials(credentialIds: string[]): HealthSnapshot[] {
    return this.queryByCredentialIds(
      "SELECT * FROM health_snapshots WHERE credential_id IN",
      "",
      credentialIds,
      mapHealth,
    );
  }

  private queryByCredentialIds<T>(
    prefix: string,
    suffix: string,
    credentialIds: string[],
    map: (row: Record<string, unknown>) => T,
  ): T[] {
    const ids = [...new Set(credentialIds)];
    if (!ids.length) return [];
    const out: T[] = [];
    // SQLite's default host-parameter limit is 999; stay comfortably below it.
    for (let index = 0; index < ids.length; index += 500) {
      const chunk = ids.slice(index, index + 500);
      const placeholders = chunk.map(() => "?").join(",");
      const sql = `${prefix} (${placeholders})${suffix ? ` ${suffix}` : ""}`;
      const rows = this.db.prepare(sql).all(...chunk) as Record<
        string,
        unknown
      >[];
      out.push(...rows.map(map));
    }
    return out;
  }

  keyCooldownUntil(
    credentialId: string,
    nowMs = Date.now(),
  ): { until: string; errorClass: ProviderErrorClass } | undefined {
    const rows = this.db
      .prepare(
        `SELECT cooldown_until, last_error_class FROM health_snapshots
         WHERE credential_id = ? AND cooldown_until IS NOT NULL
           AND last_error_class IN ('rate_limit', 'quota_exhausted', 'auth')`,
      )
      .all(credentialId) as Array<{
      cooldown_until: string;
      last_error_class: string;
    }>;
    let best: { until: string; errorClass: ProviderErrorClass } | undefined;
    for (const row of rows) {
      const untilMs = Date.parse(row.cooldown_until);
      if (!Number.isFinite(untilMs) || untilMs <= nowMs) continue;
      if (!best || row.cooldown_until > best.until) {
        best = {
          until: row.cooldown_until,
          errorClass: row.last_error_class as ProviderErrorClass,
        };
      }
    }
    return best;
  }

  recordSuccess(
    credentialId: string,
    providerResourceId: string | null,
    latencyMs: number,
  ): void {
    const now = nowIso();
    const existing = this.getHealth(credentialId, providerResourceId);
    const ema =
      existing?.latencyEmaMs == null
        ? latencyMs
        : existing.latencyEmaMs * 0.8 + latencyMs * 0.2;
    this.db
      .prepare(
        `INSERT INTO health_snapshots (credential_id, provider_resource_id, success_count, failure_count, consecutive_failures, last_success_at, last_failure_at, last_error_class, cooldown_until, latency_ema_ms, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(credential_id, provider_resource_id) DO UPDATE SET success_count=success_count+1, consecutive_failures=0, last_success_at=excluded.last_success_at, cooldown_until=NULL, latency_ema_ms=excluded.latency_ema_ms, updated_at=excluded.updated_at`,
      )
      .run(
        credentialId,
        providerResourceId,
        (existing?.successCount ?? 0) + 1,
        existing?.failureCount ?? 0,
        0,
        now,
        existing?.lastFailureAt ?? null,
        existing?.lastErrorClass ?? null,
        null,
        ema,
        now,
      );
  }

  recordFailure(
    credentialId: string,
    providerResourceId: string | null,
    errorClass: ProviderErrorClass,
    cooldownMs = 0,
  ): void {
    const now = nowIso();
    const nowMs = Date.now();
    const existing = this.getHealth(credentialId, providerResourceId);
    // Rate-limit / quota / auth cool the key down. A new failure always arms a
    // fresh window when the previous one has already expired.
    const defaultCooldown =
      errorClass === "rate_limit"
        ? 60_000
        : errorClass === "quota_exhausted"
          ? 5 * 60_000
          : errorClass === "auth"
            ? 10 * 60_000
            : errorClass === "provider_unavailable" ||
                errorClass === "timeout" ||
                errorClass === "network"
              ? 30_000
              : 0;
    const requestedUntil = cooldownMs > 0 ? nowMs + cooldownMs : 0;
    const existingUntil = existing?.cooldownUntil
      ? Date.parse(existing.cooldownUntil)
      : 0;
    const activeExisting =
      Number.isFinite(existingUntil) && existingUntil > nowMs
        ? existingUntil
        : 0;
    const freshUntil = defaultCooldown > 0 ? nowMs + defaultCooldown : 0;
    const untilMs = Math.max(requestedUntil, activeExisting, freshUntil);
    const effectiveCooldown =
      untilMs > nowMs ? new Date(untilMs).toISOString() : null;
    this.db
      .prepare(
        `INSERT INTO health_snapshots (credential_id, provider_resource_id, success_count, failure_count, consecutive_failures, last_success_at, last_failure_at, last_error_class, cooldown_until, latency_ema_ms, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(credential_id, provider_resource_id) DO UPDATE SET failure_count=failure_count+1, consecutive_failures=consecutive_failures+1, last_failure_at=excluded.last_failure_at, last_error_class=excluded.last_error_class, cooldown_until=excluded.cooldown_until, updated_at=excluded.updated_at`,
      )
      .run(
        credentialId,
        providerResourceId,
        existing?.successCount ?? 0,
        (existing?.failureCount ?? 0) + 1,
        (existing?.consecutiveFailures ?? 0) + 1,
        existing?.lastSuccessAt ?? null,
        now,
        errorClass,
        effectiveCooldown,
        existing?.latencyEmaMs ?? null,
        now,
      );
  }

  clearCooldown(
    credentialId: string,
    providerResourceId?: string | null,
  ): void {
    if (providerResourceId) {
      this.db
        .prepare(
          `UPDATE health_snapshots SET cooldown_until = NULL, consecutive_failures = 0, updated_at = ? WHERE credential_id = ? AND provider_resource_id = ?`,
        )
        .run(nowIso(), credentialId, providerResourceId);
    } else {
      this.db
        .prepare(
          `UPDATE health_snapshots SET cooldown_until = NULL, consecutive_failures = 0, updated_at = ? WHERE credential_id = ?`,
        )
        .run(nowIso(), credentialId);
    }
  }

  // ---------- usage + logs ----------
  sumUsage(
    credentialId: string,
    metric: UsageEvent["metric"],
    sinceIso: string,
    providerResourceId?: string,
  ): number {
    const scope = providerResourceId
      ? " AND (provider_resource_id IS NULL OR provider_resource_id = ?)"
      : "";
    const r = this.db
      .prepare(
        `SELECT COALESCE(SUM(quantity), 0) AS total FROM usage_events WHERE credential_id = ? AND metric = ? AND observed_at >= ?${scope}`,
      )
      .get(
        credentialId,
        metric,
        sinceIso,
        ...(providerResourceId ? [providerResourceId] : []),
      ) as { total: number };
    return Number(r.total);
  }
  recordUsage(
    e: Omit<UsageEvent, "id" | "observedAt"> & { observedAt?: string },
  ): UsageEvent {
    const row: UsageEvent = {
      id: newId("use"),
      requestId: e.requestId,
      credentialId: e.credentialId,
      providerResourceId: e.providerResourceId ?? null,
      metric: e.metric,
      quantity: e.quantity,
      observedAt: e.observedAt ?? nowIso(),
    };
    this.db
      .prepare(
        `INSERT INTO usage_events (id, request_id, credential_id, provider_resource_id, metric, quantity, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.requestId,
        row.credentialId,
        row.providerResourceId,
        row.metric,
        row.quantity,
        row.observedAt,
      );
    return row;
  }

  appendRequestLog(l: Omit<RequestLog, "createdAt">): RequestLog {
    const row: RequestLog = { ...l, createdAt: nowIso() };
    this.db
      .prepare(
        `INSERT INTO request_logs (id, requested_resource_id, requested_capability, provider_pin, account_pin, credential_pin, policy, selected_provider_id, selected_account_id, selected_credential_id, selected_upstream_id, selection_reason, attempts, status, error_class, error_message, latency_ms, prompt_tokens, completion_tokens, total_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.requestedResourceId,
        row.requestedCapability ?? null,
        row.providerPin ?? null,
        row.accountPin ?? null,
        row.credentialPin ?? null,
        row.policy,
        row.selectedProviderId ?? null,
        row.selectedAccountId ?? null,
        row.selectedCredentialId ?? null,
        row.selectedUpstreamId ?? null,
        row.selectionReason ?? null,
        row.attempts,
        row.status,
        row.errorClass ?? null,
        row.errorMessage ?? null,
        row.latencyMs,
        row.promptTokens ?? null,
        row.completionTokens ?? null,
        row.totalTokens ?? null,
        row.createdAt,
      );
    return row;
  }

  listRequestLogs(limit = 100): RequestLog[] {
    const rows = this.db
      .prepare(`SELECT * FROM request_logs ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapRequestLog);
  }

  getRequestLog(id: string): RequestLog | undefined {
    const r = this.db
      .prepare(`SELECT * FROM request_logs WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return mapRequestLog(r);
  }
}
