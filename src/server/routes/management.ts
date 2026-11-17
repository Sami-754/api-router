import type { FastifyInstance } from "fastify";
import {
  accountSchema,
  credentialCreateSchema,
  credentialPatchSchema,
  keyProvisionSchema,
  policySchema,
  providerResourceSchema,
  providerSchema,
  providerPatchSchema,
  quotaWindowSchema,
  resourceSchema,
} from "../../shared/schemas.js";
import {
  encryptSecret,
  newId,
  redactCredentialId,
} from "../../shared/crypto.js";
import { validateBaseUrl } from "../../shared/config.js";
import { runValidationJob, validateCredentialById } from "../validate.js";
import {
  AUTO_FREE_RESOURCE_ID,
  syncProviderModels,
  type ModelSyncSummary,
} from "../free-models.js";
import type { AppDeps } from "../deps.js";
import { adapterCatalog } from "../tool-catalog.js";
import { ProvisionError, provisionKey } from "../provision.js";

function bad(
  reply: { code(n: number): { send(b: unknown): unknown } },
  message: string,
  status = 400,
) {
  return reply
    .code(status)
    .send({ error: { message, type: "invalid_request", code: status } });
}

export async function registerManagementRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  const { store, router } = deps;
  type SyncResult = ModelSyncSummary & { autoFreeMappings: number };
  let syncInFlight: Promise<SyncResult> | null = null;

  // ---- registered adapters (dashboard: provider suggestions / health) ----
  app.get("/api/adapters", async () => ({
    data: adapterCatalog(deps.registry),
  }));

  // ---- providers ----
  app.get("/api/providers", async () => ({ data: store.listProviders() }));
  app.post("/api/providers", async (req, reply) => {
    const parsed = providerSchema.safeParse(req.body);
    if (!parsed.success)
      return bad(reply, parsed.error.issues[0]?.message ?? "invalid provider");
    if (parsed.data.baseUrl) {
      try {
        validateBaseUrl(parsed.data.baseUrl);
      } catch (e) {
        return bad(reply, e instanceof Error ? e.message : String(e));
      }
    }
    const p = store.upsertProvider({
      id: parsed.data.id.toLowerCase(),
      displayName: parsed.data.displayName,
      baseUrl: parsed.data.baseUrl ?? null,
      enabled: parsed.data.enabled ?? true,
      priority: parsed.data.priority ?? 100,
      metadata: parsed.data.metadata,
    });
    return reply.code(201).send({ data: p });
  });
  app.patch("/api/providers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = store.getProvider(id);
    if (!existing) return bad(reply, `unknown provider: ${id}`, 404);
    const parsed = providerPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return bad(
        reply,
        parsed.error.issues[0]?.message ?? "invalid provider patch",
      );
    const body = parsed.data;
    if (typeof body.baseUrl === "string") {
      try {
        validateBaseUrl(body.baseUrl);
      } catch (e) {
        return bad(reply, e instanceof Error ? e.message : String(e));
      }
    }
    const updated = store.upsertProvider({
      ...existing,
      displayName: body.displayName ?? existing.displayName,
      baseUrl: body.baseUrl !== undefined ? body.baseUrl : existing.baseUrl,
      enabled: body.enabled ?? existing.enabled,
      priority: body.priority ?? existing.priority,
    });
    return { data: updated };
  });

  // ---- accounts ----
  app.get("/api/accounts", async (req) => {
    const q = req.query as { provider?: string };
    return { data: store.listAccounts(q.provider) };
  });
  app.post("/api/accounts", async (req, reply) => {
    const parsed = accountSchema.safeParse(req.body);
    if (!parsed.success)
      return bad(reply, parsed.error.issues[0]?.message ?? "invalid account");
    if (!store.getProvider(parsed.data.providerId)) {
      return bad(reply, `unknown provider: ${parsed.data.providerId}`, 404);
    }
    const existing = store.getAccount(parsed.data.id);
    if (
      existing &&
      existing.providerId !== parsed.data.providerId.toLowerCase()
    ) {
      return bad(
        reply,
        "an existing account cannot be moved to a different provider; create a new account",
        409,
      );
    }
    const a = store.upsertAccount({
      id: parsed.data.id,
      providerId: parsed.data.providerId.toLowerCase(),
      displayName: parsed.data.displayName ?? null,
      enabled: parsed.data.enabled ?? true,
      metadata: parsed.data.metadata,
    });
    return reply.code(201).send({ data: a });
  });

  // ---- credentials (secrets never leave the server) ----
  app.get("/api/credentials", async (req) => {
    const q = req.query as { account?: string };
    const creds = store.listCredentials(q.account).map((c) => ({
      id: c.id,
      accountId: c.accountId,
      providerId: c.providerId,
      label: c.label,
      redacted: redactCredentialId(c.id),
      status: c.status,
      lastValidatedAt: c.lastValidatedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
    return { data: creds };
  });
  app.post("/api/keys", async (req, reply) => {
    const parsed = keyProvisionSchema.safeParse(req.body);
    if (!parsed.success)
      return bad(reply, parsed.error.issues[0]?.message ?? "invalid key");
    try {
      return reply.code(201).send({
        data: provisionKey(deps.store, deps.registry, parsed.data),
      });
    } catch (e) {
      return bad(
        reply,
        e instanceof Error ? e.message : String(e),
        e instanceof ProvisionError ? e.statusCode : 400,
      );
    }
  });
  app.post("/api/credentials", async (req, reply) => {
    const parsed = credentialCreateSchema.safeParse(req.body);
    if (!parsed.success)
      return bad(
        reply,
        parsed.error.issues[0]?.message ?? "invalid credential",
      );
    try {
      const c = store.createCredential({
        id: parsed.data.id ?? newId("cred"),
        accountId: parsed.data.accountId,
        label: parsed.data.label ?? null,
        secretEncrypted: encryptSecret(parsed.data.secret),
        status: parsed.data.status ?? "active",
      });
      return reply.code(201).send({
        data: {
          id: c.id,
          accountId: c.accountId,
          providerId: c.providerId,
          status: c.status,
        },
      });
    } catch (e) {
      return bad(reply, e instanceof Error ? e.message : String(e), 404);
    }
  });
  app.patch("/api/credentials/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = store.getCredential(id);
    if (!existing) return bad(reply, `unknown credential: ${id}`, 404);
    const parsed = credentialPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return bad(
        reply,
        parsed.error.issues[0]?.message ?? "invalid credential patch",
      );
    const body = parsed.data;
    if (body.status) store.updateCredentialStatus(id, body.status);
    if (body.label !== undefined) store.updateCredentialLabel(id, body.label);
    return {
      data: store.getCredential(id)
        ? { ...store.getCredential(id), secretEncrypted: undefined }
        : null,
    };
  });

  // ---- resources ----
  app.get("/api/resources", async () => ({ data: store.listResources() }));
  app.get("/api/resources/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const resource = store.getResource(id);
    if (!resource) return bad(reply, `unknown resource: ${id}`, 404);
    return { data: resource };
  });
  app.post("/api/resources", async (req, reply) => {
    const parsed = resourceSchema.safeParse(req.body);
    if (!parsed.success)
      return bad(reply, parsed.error.issues[0]?.message ?? "invalid resource");
    const r = store.upsertResource({
      id: parsed.data.id,
      kind: parsed.data.kind,
      displayName: parsed.data.displayName,
      capabilities: parsed.data.capabilities ?? [],
      contextTokens: parsed.data.contextTokens ?? null,
      metadata: parsed.data.metadata,
    });
    return reply.code(201).send({ data: r });
  });

  // ---- provider resources (canonical ↔ upstream mappings) ----
  app.get("/api/provider-resources", async (req) => {
    const q = req.query as { resource?: string; provider?: string };
    return { data: store.listProviderResources(q.resource, q.provider) };
  });
  app.post("/api/provider-resources", async (req, reply) => {
    const parsed = providerResourceSchema.safeParse(req.body);
    if (!parsed.success)
      return bad(reply, parsed.error.issues[0]?.message ?? "invalid mapping");
    if (!store.getResource(parsed.data.resourceId)) {
      return bad(reply, `unknown resource: ${parsed.data.resourceId}`, 404);
    }
    if (!store.getProvider(parsed.data.providerId)) {
      return bad(reply, `unknown provider: ${parsed.data.providerId}`, 404);
    }
    const pr = store.upsertProviderResource({
      id: parsed.data.id,
      resourceId: parsed.data.resourceId,
      providerId: parsed.data.providerId.toLowerCase(),
      upstreamId: parsed.data.upstreamId,
      capabilities: parsed.data.capabilities ?? ["llm.chat"],
      contextTokens: parsed.data.contextTokens ?? null,
      enabled: parsed.data.enabled ?? true,
      metadata: parsed.data.metadata,
    });
    return reply.code(201).send({ data: pr });
  });

  // ---- routes: expanded executable routes + simulation ----
  app.get("/api/routes/counts", async (req) => {
    // Single-pass route counts per canonical resource (the dashboard must
    // NOT fetch /api/routes per row — that trips the rate limiter).
    const q = req.query as { capability?: string };
    const cap = q.capability as never as
      import("../../shared/types.js").Capability | undefined;
    const counts: Record<string, number> = {};
    const credsByAccount = new Map<string, number>();
    for (const c of store.listCredentials()) {
      if (c.status !== "active") continue;
      credsByAccount.set(
        c.accountId,
        (credsByAccount.get(c.accountId) ?? 0) + 1,
      );
    }
    const activeAccountsByProvider = new Map<string, number>();
    const enabledProviders = new Set(
      store
        .listProviders()
        .filter((p) => p.enabled)
        .map((p) => p.id),
    );
    for (const a of store.listAccounts()) {
      if (!a.enabled || !enabledProviders.has(a.providerId)) continue;
      activeAccountsByProvider.set(
        a.providerId,
        (activeAccountsByProvider.get(a.providerId) ?? 0) +
          (credsByAccount.get(a.id) ?? 0),
      );
    }
    for (const pr of store.listProviderResources()) {
      if (!pr.enabled || !enabledProviders.has(pr.providerId)) continue;
      if (cap && !(pr.capabilities as string[]).includes(cap)) continue;
      const n = activeAccountsByProvider.get(pr.providerId) ?? 0;
      if (n > 0) counts[pr.resourceId] = (counts[pr.resourceId] ?? 0) + n;
    }
    return { data: counts };
  });
  app.get("/api/routes", async (req) => {
    const q = req.query as { resource?: string; capability?: string };
    if (!q.resource)
      return {
        data: [],
        hint: "pass ?resource=<canonical-id>&capability=<cap>",
      };
    const routes = store.expandRoutes(
      q.resource,
      (q.capability as never) ?? undefined,
    );
    const credentialIds = [...new Set(routes.map((r) => r.credentialId))];
    const quotas = store.listQuotaWindowsForCredentials(credentialIds);
    const quotasByCredential = new Map<string, typeof quotas>();
    for (const quota of quotas) {
      const list = quotasByCredential.get(quota.credentialId) ?? [];
      list.push(quota);
      quotasByCredential.set(quota.credentialId, list);
    }
    const health = store.listHealthForCredentials(credentialIds);
    const healthByRoute = new Map<string, (typeof health)[number]>();
    for (const snapshot of health) {
      healthByRoute.set(
        `${snapshot.credentialId}\u0000${snapshot.providerResourceId ?? ""}`,
        snapshot,
      );
    }
    return {
      data: routes.map((r) => ({
        ...r,
        quotas: quotasByCredential.get(r.credentialId) ?? [],
        health:
          healthByRoute.get(
            `${r.credentialId}\u0000${r.providerResourceId ?? ""}`,
          ) ?? null,
      })),
    };
  });
  app.post("/api/routing/simulate", async (req, reply) => {
    const body = (req.body ?? {}) as {
      resource?: string;
      capability?: string;
      policy?: string;
      provider?: string;
      account?: string;
      credential?: string;
      requestedTokens?: number;
    };
    if (!body.resource) return bad(reply, "resource is required");
    const capability = (body.capability ?? "llm.chat") as never;
    const result = router.candidates(
      body.resource,
      capability,
      {
        provider: body.provider ?? null,
        account: body.account ?? null,
        credential: body.credential ?? null,
        policy: (body.policy as never) ?? null,
      },
      body.requestedTokens ?? null,
    );
    return {
      data: {
        policy: body.policy ?? deps.settings.defaultPolicy,
        eligible: result.eligible.map((e) => ({
          routeId: e.route.routeId,
          provider: e.route.providerId,
          account: e.route.accountId,
          upstream: e.route.upstreamId,
          score: +e.score.toFixed(4),
          reason: e.reason,
          details: e.details,
        })),
        filtered: result.filtered.map((f) => ({
          routeId: f.route.routeId,
          provider: f.route.providerId,
          account: f.route.accountId,
          reason: f.reason,
        })),
      },
    };
  });

  // ---- quotas ----
  app.get("/api/quotas", async (req) => {
    const q = req.query as { credential?: string };
    return { data: store.listQuotaWindows(q.credential) };
  });
  app.post("/api/quotas", async (req, reply) => {
    const parsed = quotaWindowSchema.safeParse(req.body);
    if (!parsed.success)
      return bad(
        reply,
        parsed.error.issues[0]?.message ?? "invalid quota window",
      );
    if (!store.getCredential(parsed.data.credentialId)) {
      return bad(reply, `unknown credential: ${parsed.data.credentialId}`, 404);
    }
    const w = store.upsertQuotaWindow({
      id: parsed.data.id,
      credentialId: parsed.data.credentialId,
      providerResourceId: parsed.data.providerResourceId ?? null,
      metric: parsed.data.metric,
      limitValue: parsed.data.limitValue,
      usedValue: parsed.data.usedValue ?? 0,
      remainingValue: parsed.data.remainingValue ?? null,
      windowKind: parsed.data.windowKind,
      windowSeconds: parsed.data.windowSeconds ?? null,
      windowStartedAt: parsed.data.windowStartedAt ?? null,
      resetAt: parsed.data.resetAt ?? null,
      hard: parsed.data.hard ?? true,
      source: parsed.data.source ?? "configured",
      confidence: parsed.data.confidence ?? null,
    });
    return reply.code(201).send({ data: w });
  });

  // ---- usage stats (live sums over usage_events) ----
  app.get("/api/usage", async (req, reply) => {
    const q = req.query as {
      credential?: string;
      metric?: string;
      since?: string;
    };
    if (!q.credential) return bad(reply, "credential is required");
    if (!store.getCredential(q.credential))
      return bad(reply, `unknown credential: ${q.credential}`, 404);
    const metrics = [
      "requests",
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "searches",
    ] as const;
    const since = q.since ?? new Date(Date.now() - 86_400_000).toISOString();
    const wanted = q.metric ? [q.metric] : [...metrics];
    const data: Record<string, number> = {};
    for (const m of wanted) {
      data[m] = store.sumUsage(q.credential, m as never, since);
    }
    return { data: { credential: q.credential, since, ...data } };
  });

  // ---- observability ----
  app.get("/api/requests", async (req) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(500, Math.max(1, Number(q.limit ?? 100)));
    // Local-first service, no auth: list views carry the full credential id
    // (it's an identifier, not the secret) so the dashboard can show which
    // key served each request.
    return { data: store.listRequestLogs(limit) };
  });
  app.get("/api/requests/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const l = store.getRequestLog(id);
    if (!l) return bad(reply, `unknown request: ${id}`, 404);
    return { data: l };
  });

  // ---- overview (dashboard aggregation) ----
  app.get("/api/overview", async () => {
    const providers = store.listProviders();
    const creds = store.listCredentials();
    const resources = store.listResources();
    const mappings = store.listProviderResources();
    const logs = store.listRequestLogs(500);
    const dayAgo = Date.now() - 86_400_000;
    const recent = logs.filter((l) => Date.parse(l.createdAt) > dayAgo);
    const ok = recent.filter((l) => l.status === "success").length;
    return {
      data: {
        providers: providers.length,
        providersEnabled: providers.filter((p) => p.enabled).length,
        accounts: store.listAccounts().length,
        credentials: creds.length,
        credentialsByStatus: {
          active: creds.filter((c) => c.status === "active").length,
          disabled: creds.filter((c) => c.status === "disabled").length,
          invalid: creds.filter((c) => c.status === "invalid").length,
        },
        resources: resources.length,
        mappings: mappings.length,
        requests24h: recent.length,
        successRate24h: recent.length ? +(ok / recent.length).toFixed(3) : null,
        tokens24h: recent.reduce((n, l) => n + (l.totalTokens ?? 0), 0),
      },
    };
  });

  // ---- runtime settings (in-memory; restart resets to env) ----
  app.get("/api/settings", async () => ({
    data: { ...deps.settings, note: "in-memory; restart resets to env" },
  }));
  app.patch("/api/settings", async (req, reply) => {
    const body = (req.body ?? {}) as { defaultPolicy?: string };
    if (body.defaultPolicy !== undefined) {
      const parsed = policySchema.safeParse(body.defaultPolicy);
      if (!parsed.success)
        return bad(
          reply,
          `invalid policy (auto|burn|preserve|fast|reliable|cheap|priority)`,
        );
      deps.settings.defaultPolicy = parsed.data;
      router.setDefaultPolicy(parsed.data);
    }
    return { data: { ...deps.settings } };
  });

  // ---- credential validation (live probe, marks invalid on auth failure) ----
  app.post("/api/credentials/:id/validate", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await validateCredentialById(
        store,
        deps.registry,
        id,
        deps.fetchImpl,
      );
      return { data: result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = /unknown credential/.test(msg)
        ? 404
        : /no adapter/.test(msg)
          ? 400
          : 500;
      return bad(reply, msg, code);
    }
  });

  // ---- model catalog sync (single-flight; boot runs the same routine) ----
  app.post("/api/maintenance/sync", async () => {
    if (!syncInFlight) {
      syncInFlight = syncProviderModels({
        store,
        fetchImpl: deps.fetchImpl,
      })
        .then((summary) => ({
          ...summary,
          autoFreeMappings: store.listProviderResources(AUTO_FREE_RESOURCE_ID)
            .length,
        }))
        .finally(() => {
          syncInFlight = null;
        });
    }
    return { data: await syncInFlight };
  });

  // ---- batch validation job (staggered, skips fresh credentials) ----
  app.post("/api/maintenance/validate", async (req) => {
    const body = (req.body ?? {}) as {
      provider?: string;
      limit?: number;
      maxAgeHours?: number;
    };
    const summary = await runValidationJob({
      store,
      registry: deps.registry,
      fetchImpl: deps.fetchImpl,
      provider: body.provider,
      limit: Math.min(500, Math.max(1, body.limit ?? 25)),
      maxAgeHours: body.maxAgeHours ?? 24,
      staggerMs: 300,
    });
    return { data: summary };
  });

  // ---- deletes (all cascade cleanly via FKs) ----
  app.delete("/api/quotas/:id", async (req) => {
    const { id } = req.params as { id: string };
    store.deleteQuotaWindow(id);
    return { data: { deleted: id } };
  });
  app.patch("/api/provider-resources/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = store.getProviderResource(id);
    if (!existing) return bad(reply, `unknown mapping: ${id}`, 404);
    const body = (req.body ?? {}) as { enabled?: boolean };
    if (typeof body.enabled === "boolean")
      store.setProviderResourceEnabled(id, body.enabled);
    return { data: store.getProviderResource(id) };
  });
  app.delete("/api/provider-resources/:id", async (req) => {
    const { id } = req.params as { id: string };
    store.deleteProviderResource(id);
    return { data: { deleted: id } };
  });
  app.delete("/api/resources/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getResource(id))
      return bad(reply, `unknown resource: ${id}`, 404);
    store.deleteResource(id); // provider mappings cascade
    return { data: { deleted: id } };
  });
  app.delete("/api/accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getAccount(id)) return bad(reply, `unknown account: ${id}`, 404);
    store.deleteAccount(id); // credentials, quotas, health cascade
    return { data: { deleted: id } };
  });
  app.delete("/api/credentials/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getCredential(id))
      return bad(reply, `unknown credential: ${id}`, 404);
    store.deleteCredential(id); // quotas, health, usage cascade
    return { data: { deleted: id } };
  });
  app.delete("/api/providers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getProvider(id))
      return bad(reply, `unknown provider: ${id}`, 404);
    store.deleteProvider(id); // accounts, credentials, mappings cascade
    return {
      data: {
        deleted: id,
        note: "restart the server to drop its in-memory adapter registration",
      },
    };
  });
}
