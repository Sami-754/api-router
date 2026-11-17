import { decryptSecret, newId, redactSecrets } from "../shared/crypto.js";
import type {
  Capability,
  ProviderErrorClass,
  QuotaWindow,
  Route,
  RoutingHint,
  RoutingPolicyName,
} from "../shared/types.js";
import type {
  AdapterContext,
  NormalizedRequest,
  NormalizedResponse,
  ProviderError,
  ResolvedRoute,
  StreamChunk,
} from "../provider-sdk/types.js";
import type { ProviderRegistry } from "../provider-sdk/registry.js";
import { POLICIES, scoreRoute } from "./policies.js";
import { quotaViewForRoute, rateChecksFor } from "./quota.js";
import { estimateTokensFromChars } from "../shared/tokens.js";
import type { Store } from "./store.js";

export interface RouterOptions {
  store: Store;
  registry: ProviderRegistry;
  defaultPolicy?: RoutingPolicyName;
  maxAttempts?: number;
  /** Total execution budget across fallback attempts, including response-body reads. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Resolve provider base URL: provider record baseUrl or adapter default. */
  defaultBaseUrls?: Record<string, string>;
}

export interface EligibilityResult {
  eligible: ScoredCandidate[];
  filtered: Array<{ route: Route; reason: string }>;
}

export interface ScoredCandidate {
  route: Route;
  score: number;
  reason: string;
  details: Record<string, number | string | null>;
}

export interface ExecuteOptions {
  requestId?: string;
  resourceId: string;
  capability: Capability;
  hint?: RoutingHint;
  normalized: NormalizedRequest;
  /** Max tokens requested (for context-limit eligibility). */
  requestedTokens?: number | null;
}

export interface ExecuteOutcome {
  requestId: string;
  response: NormalizedResponse;
  route: ResolvedRoute;
  attempts: number;
  policy: RoutingPolicyName;
  selectionReason: string;
}

export interface StreamOutcome {
  requestId: string;
  /** First chunk already received — the route is committed, no more fallback. */
  stream: AsyncIterable<StreamChunk>;
  route: ResolvedRoute;
  attempts: number;
  policy: RoutingPolicyName;
  selectionReason: string;
  /** Called by the server when the stream finishes or aborts (accounting). */
  finish: (info: {
    fullText: string;
    usage: StreamChunk["usage"];
    aborted: boolean;
    error?: string;
  }) => void;
  /** Immediately cancels the upstream stream reader when the client disconnects. */
  cancel?: () => void;
}

export class RouterError extends Error {
  statusCode: number;
  code: string;
  errorClass: ProviderErrorClass;
  retryable = false;
  attempts: number;
  constructor(
    message: string,
    opts: {
      statusCode?: number;
      code?: string;
      errorClass?: ProviderErrorClass;
      attempts?: number;
    } = {},
  ) {
    super(message);
    this.statusCode = opts.statusCode ?? 500;
    this.code = opts.code ?? "router_error";
    this.errorClass = opts.errorClass ?? "unknown";
    this.attempts = opts.attempts ?? 0;
  }
}

/** Failures of the request itself. Another key on the same provider will not fix these. */
const STOP_FAILOVER: ReadonlySet<ProviderErrorClass> = new Set([
  "bad_request",
  "unsupported",
  "context_limit",
]);

export class Router {
  private store: Store;
  private registry: ProviderRegistry;
  private defaultPolicy: RoutingPolicyName;
  private maxAttempts: number;
  private timeoutMs: number;
  private fetchImpl?: typeof fetch;
  private defaultBaseUrls: Record<string, string>;
  /** Next start slot for equal-scored credentials of each provider. */
  private keyCursor = new Map<string, number>();

  constructor(opts: RouterOptions) {
    this.store = opts.store;
    this.registry = opts.registry;
    this.defaultPolicy = opts.defaultPolicy ?? "auto";
    // Large enough to walk a real key pool (Mistral has 35 keys in the import).
    this.maxAttempts = opts.maxAttempts ?? 64;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.fetchImpl = opts.fetchImpl;
    this.defaultBaseUrls = opts.defaultBaseUrls ?? {};
  }

  resolvePolicy(hint?: RoutingHint): RoutingPolicyName {
    const p = (
      hint?.policy ?? this.defaultPolicy
    ).toLowerCase() as RoutingPolicyName;
    return (POLICIES as string[]).includes(p) ? p : "auto";
  }

  setDefaultPolicy(policy: RoutingPolicyName): void {
    this.defaultPolicy = policy;
  }

  getDefaultPolicy(): RoutingPolicyName {
    return this.defaultPolicy;
  }

  /** Phase 1+2: expand candidates, then apply hard eligibility filters. */
  candidates(
    resourceId: string,
    capability: Capability,
    hint?: RoutingHint,
    requestedTokens?: number | null,
    nowMs = Date.now(),
    onlyRouteId?: string,
  ): EligibilityResult {
    const routes = this.store
      .expandRoutes(resourceId, capability)
      .filter((route) => !onlyRouteId || route.routeId === onlyRouteId);
    const eligible: ScoredCandidate[] = [];
    const filtered: Array<{ route: Route; reason: string }> = [];
    const policy = this.resolvePolicy(hint);

    const providerPin = hint?.provider?.toLowerCase() ?? null;
    const accountPin = hint?.account ?? null;
    const credentialPin = hint?.credential ?? null;
    const allowCross = hint?.allowCrossProviderFallback ?? false;

    for (const route of routes) {
      // Cross-provider opt-in admits fallback candidates; orderAttempts()
      // keeps the explicitly pinned provider first.
      if (providerPin && route.providerId !== providerPin && !allowCross) {
        filtered.push({ route, reason: `pinned to provider ${providerPin}` });
        continue;
      }
      if (accountPin && route.accountId !== accountPin) {
        filtered.push({ route, reason: `pinned to account ${accountPin}` });
        continue;
      }
      if (credentialPin && route.credentialId !== credentialPin) {
        filtered.push({ route, reason: `pinned to credential` });
        continue;
      }
      if (!route.providerEnabled) {
        filtered.push({ route, reason: "provider disabled" });
        continue;
      }
      if (!route.accountEnabled) {
        filtered.push({ route, reason: "account disabled" });
        continue;
      }
      if (route.credentialStatus !== "active") {
        filtered.push({
          route,
          reason: `credential ${route.credentialStatus}`,
        });
        continue;
      }
      if (!route.providerResourceEnabled) {
        filtered.push({ route, reason: "provider resource disabled" });
        continue;
      }
      if (!route.capabilities.includes(capability)) {
        filtered.push({
          route,
          reason: `capability ${capability} unsupported`,
        });
        continue;
      }
      const adapter = this.registry.get(route.providerId);
      if (!adapter) {
        filtered.push({
          route,
          reason: `no adapter for provider ${route.providerId}`,
        });
        continue;
      }
      if (!adapter.capabilities().some((c) => c.capability === capability)) {
        filtered.push({
          route,
          reason: `adapter capability ${capability} unsupported`,
        });
        continue;
      }
      // Context / capability constraints.
      if (requestedTokens != null) {
        const pr = this.store.getProviderResource(route.providerResourceId);
        const ctx =
          pr?.contextTokens ??
          this.store.getResource(resourceId)?.contextTokens;
        if (ctx != null && requestedTokens > ctx) {
          filtered.push({
            route,
            reason: `request needs ~${requestedTokens} tokens, route allows ${ctx}`,
          });
          continue;
        }
      }
      // A rate limit, quota hit, or auth failure cools the whole API key down,
      // so the next request skips it for every model on that provider.
      const keyCooldown = this.store.keyCooldownUntil(
        route.credentialId,
        nowMs,
      );
      if (keyCooldown) {
        filtered.push({
          route,
          reason: `key cooldown until ${keyCooldown.until} (${keyCooldown.errorClass})`,
        });
        continue;
      }
      // Per-model cooldown (upstream 5xx, timeout, network).
      const health = this.store.getHealth(
        route.credentialId,
        route.providerResourceId,
      );
      if (health?.cooldownUntil && Date.parse(health.cooldownUntil) > nowMs) {
        filtered.push({
          route,
          reason: `cooldown until ${health.cooldownUntil} (${health.lastErrorClass ?? "error"})`,
        });
        continue;
      }
      // Hard quota exhaustion (static windows).
      const qv = quotaViewForRoute(this.store, route, nowMs);
      if (qv.exhausted) {
        filtered.push({
          route,
          reason: `quota exhausted: ${qv.exhaustedReasons.join("; ")}`,
        });
        continue;
      }
      // Live rate windows (per minute/hour/day): enforced from usage_events
      // so they reset automatically when the window rolls.
      const blown = rateChecksFor(
        this.store,
        route.credentialId,
        route.providerResourceId,
        nowMs,
      ).filter((c) => c.remaining <= 0);
      if (blown.length > 0) {
        filtered.push({
          route,
          reason: `rate limit: ${blown.map((c) => `${c.window.metric} ${c.used}/${c.window.limitValue} per ${c.window.windowKind}`).join("; ")}`,
        });
        continue;
      }
      // Phase 3: policy scoring.
      const quotas = qv.windows;
      const { score, reason, details } = scoreRoute(policy, {
        route,
        quotas,
        health: health ?? undefined,
        estimatedCost: hint?.estimatedCost ?? null,
        nowMs,
      });
      eligible.push({ route, score, reason, details });
    }

    eligible.sort((a, b) => b.score - a.score);
    return { eligible, filtered };
  }

  /** Phase 4–6: execute best route, fallback on retryable failures, account everything. */
  async execute(opts: ExecuteOptions): Promise<ExecuteOutcome> {
    const requestId = opts.requestId ?? newId("req");
    const policy = this.resolvePolicy(opts.hint);
    const started = Date.now();
    const credentialPinned = Boolean(opts.hint?.credential);
    const providerPin = opts.hint?.provider?.toLowerCase() ?? null;
    const allowCross = opts.hint?.allowCrossProviderFallback ?? false;

    const { eligible, filtered } = this.candidates(
      opts.resourceId,
      opts.capability,
      opts.hint,
      opts.requestedTokens ?? null,
    );

    if (eligible.length === 0) {
      const reason = filtered.length
        ? `no eligible routes: ${filtered[0].reason}${filtered.length > 1 ? ` (+${filtered.length - 1} more)` : ""}`
        : `unknown resource or no routes configured for ${opts.resourceId}`;
      // Rate/quota/cooldown pressure is a 429 even for pinned requests;
      // only genuinely-missing routes are 404.
      const pressured = filtered.some((f) =>
        /quota|rate limit|exhausted|cooldown/i.test(f.reason),
      );
      const statusCode = pressured
        ? 429
        : providerPin && filtered.length
          ? 404
          : filtered.length
            ? 503
            : 404;
      const code =
        statusCode === 404
          ? "route_not_found"
          : statusCode === 429
            ? "rate_limited"
            : "no_eligible_routes";
      this.store.appendRequestLog({
        id: requestId,
        requestedResourceId: opts.resourceId,
        requestedCapability: opts.capability,
        providerPin: opts.hint?.provider ?? null,
        accountPin: opts.hint?.account ?? null,
        credentialPin: opts.hint?.credential ?? null,
        policy,
        attempts: 0,
        status: "error",
        errorClass:
          statusCode === 404
            ? "unsupported"
            : statusCode === 429
              ? "rate_limit"
              : "provider_unavailable",
        errorMessage: reason,
        latencyMs: Date.now() - started,
      });
      throw new RouterError(reason, {
        statusCode,
        code,
        errorClass:
          statusCode === 404
            ? "unsupported"
            : statusCode === 429
              ? "rate_limit"
              : "provider_unavailable",
      });
    }

    // Same-score keys of one provider take turns. On failure, walk the rest.
    const queue = this.orderAttempts(eligible, providerPin);
    const budget = credentialPinned
      ? 1
      : Math.min(queue.length, this.maxAttempts);
    let attempts = 0;
    let lastError: RouterError | null = null;
    const tried = new Set<string>();

    while (queue.length > 0 && attempts < budget) {
      const remainingMs = this.timeoutMs - (Date.now() - started);
      if (remainingMs <= 0) {
        lastError = new RouterError("router execution time budget exhausted", {
          statusCode: 504,
          code: "router_timeout",
          errorClass: "timeout",
          attempts,
        });
        break;
      }
      const candidate = queue.shift()!;
      if (tried.has(candidate.route.routeId)) continue;
      if (
        !this.candidates(
          opts.resourceId,
          opts.capability,
          opts.hint,
          opts.requestedTokens,
          Date.now(),
          candidate.route.routeId,
        ).eligible.some((c) => c.route.routeId === candidate.route.routeId)
      )
        continue;
      // Provider-pinned requests stay within the pinned provider unless
      // the caller explicitly opts into cross-provider fallback.
      if (
        providerPin &&
        !allowCross &&
        candidate.route.providerId !== providerPin
      )
        continue;
      tried.add(candidate.route.routeId);
      attempts += 1;

      const resolved = this.resolveRoute(candidate.route);
      const adapter = this.registry.require(resolved.providerId);
      const ctx: AdapterContext = {
        requestId,
        baseUrl: resolved.effectiveBaseUrl,
        timeoutMs: Math.max(1, this.timeoutMs - (Date.now() - started)),
        deadlineAt: started + this.timeoutMs,
        fetchImpl: this.fetchImpl,
      };
      const opStart = Date.now();
      try {
        const response = await adapter.execute(opts.normalized, resolved, ctx);
        const latencyMs = Date.now() - opStart;
        this.store.recordSuccess(
          resolved.credentialId,
          resolved.providerResourceId,
          latencyMs,
        );
        this.accountUsage(requestId, resolved, response);

        const usage = extractUsage(response);
        this.store.appendRequestLog({
          id: `${requestId}:attempt${attempts}`,
          requestedResourceId: opts.resourceId,
          requestedCapability: opts.capability,
          providerPin: opts.hint?.provider ?? null,
          accountPin: opts.hint?.account ?? null,
          credentialPin: opts.hint?.credential ?? null,
          policy,
          selectedProviderId: resolved.providerId,
          selectedAccountId: resolved.accountId,
          selectedCredentialId: resolved.credentialId,
          selectedUpstreamId: resolved.upstreamId,
          selectionReason: candidate.reason,
          attempts,
          status: "success",
          latencyMs: Date.now() - started,
          promptTokens: usage?.promptTokens ?? null,
          completionTokens: usage?.completionTokens ?? null,
          totalTokens: usage?.totalTokens ?? null,
        });

        return {
          requestId,
          response,
          route: resolved,
          attempts,
          policy,
          selectionReason: candidate.reason,
        };
      } catch (err) {
        const rawError = adapter.classifyError(err);
        const classified = {
          ...rawError,
          message: redactSecrets(rawError.message, [resolved.credentialSecret]),
        };
        // noteAttemptFailure() records the failure (and retires the
        // key on 401) — do not also call recordFailure() here.
        this.noteAttemptFailure(
          resolved.credentialId,
          resolved.providerResourceId,
          classified,
        );

        lastError = new RouterError(classified.message, {
          statusCode: mapToHttpStatus(classified.errorClass),
          code: `upstream_${classified.errorClass}`,
          errorClass: classified.errorClass,
          attempts,
        });
        this.logAttemptFailure(
          requestId,
          opts,
          policy,
          candidate,
          resolved,
          attempts,
          classified.errorClass,
          classified.message,
          started,
        );

        // A bad request, unknown model, or context overflow will fail the same
        // way on every key. Limits, auth, and upstream errors try the next key.
        if (
          credentialPinned ||
          STOP_FAILOVER.has(classified.errorClass) ||
          (!classified.retryable && classified.errorClass !== "auth")
        )
          break;
      }
    }

    const message = lastError?.message ?? "all routes failed";
    throw new RouterError(message, {
      statusCode: lastError?.statusCode ?? 502,
      code: "all_routes_failed",
      errorClass: lastError?.errorClass ?? "unknown",
      attempts,
    });
  }

  /**
   * Streaming execution. Routes are tried in ranked order UNTIL the first
   * chunk arrives; the route is then committed for the life of the stream
   * (no cross-provider retry after commit — the client already has headers).
   * Accounting runs via finish(), which the server must always call.
   */
  async executeStream(opts: ExecuteOptions): Promise<StreamOutcome> {
    const requestId = opts.requestId ?? newId("req");
    const policy = this.resolvePolicy(opts.hint);
    const started = Date.now();
    const credentialPinned = Boolean(opts.hint?.credential);
    const providerPin = opts.hint?.provider?.toLowerCase() ?? null;
    const allowCross = opts.hint?.allowCrossProviderFallback ?? false;

    const { eligible, filtered } = this.candidates(
      opts.resourceId,
      opts.capability,
      opts.hint,
      opts.requestedTokens ?? null,
    );
    if (eligible.length === 0) {
      throw this.noRouteError(
        opts,
        providerPin,
        filtered,
        requestId,
        started,
        policy,
      );
    }

    const queue = this.orderAttempts(eligible, providerPin);
    const budget = credentialPinned
      ? 1
      : Math.min(queue.length, this.maxAttempts);
    const tried = new Set<string>();
    let attempts = 0;
    let lastError: RouterError | null = null;

    while (queue.length > 0 && attempts < budget) {
      const remainingMs = this.timeoutMs - (Date.now() - started);
      if (remainingMs <= 0) {
        lastError = new RouterError("router execution time budget exhausted", {
          statusCode: 504,
          code: "router_timeout",
          errorClass: "timeout",
          attempts,
        });
        break;
      }
      const candidate = queue.shift()!;
      if (tried.has(candidate.route.routeId)) continue;
      if (
        !this.candidates(
          opts.resourceId,
          opts.capability,
          opts.hint,
          opts.requestedTokens,
          Date.now(),
          candidate.route.routeId,
        ).eligible.some((c) => c.route.routeId === candidate.route.routeId)
      )
        continue;
      if (
        providerPin &&
        !allowCross &&
        candidate.route.providerId !== providerPin
      )
        continue;
      tried.add(candidate.route.routeId);
      attempts += 1;

      const resolved = this.resolveRoute(candidate.route);
      const adapter = this.registry.require(resolved.providerId);
      if (!adapter.executeStream) {
        lastError = new RouterError(
          `provider ${resolved.providerId} does not support streaming`,
          {
            statusCode: 400,
            code: "streaming_unsupported",
            errorClass: "unsupported",
            attempts,
          },
        );
        this.logAttemptFailure(
          requestId,
          opts,
          policy,
          candidate,
          resolved,
          attempts,
          "unsupported",
          lastError.message,
          started,
        );
        continue;
      }
      const ctx: AdapterContext = {
        requestId,
        baseUrl: resolved.effectiveBaseUrl,
        timeoutMs: Math.max(1, this.timeoutMs - (Date.now() - started)),
        deadlineAt: started + this.timeoutMs,
        fetchImpl: this.fetchImpl,
      };
      const opStart = Date.now();
      try {
        const iter = adapter
          .executeStream(opts.normalized, resolved, ctx)
          [Symbol.asyncIterator]();
        // First chunk commits the route. Failure before it → next route.
        const first = await iter.next();
        if (first.done)
          throw Object.assign(
            new Error("upstream closed stream without chunks"),
            {
              providerError: {
                errorClass: "provider_unavailable",
                message: "empty upstream stream",
                retryable: true,
              } satisfies ProviderError,
            },
          );
        const firstChunk = first.value;
        const rest: AsyncIterable<StreamChunk> = {
          [Symbol.asyncIterator]: async function* () {
            yield firstChunk;
            yield* { [Symbol.asyncIterator]: () => iter };
          },
        };
        const candidateReason = candidate.reason;
        const finish = (info: {
          fullText: string;
          usage: StreamChunk["usage"];
          aborted: boolean;
          error?: string;
        }) => {
          const latencyMs = Date.now() - opStart;
          if (info.aborted || info.error) {
            this.store.recordFailure(
              resolved.credentialId,
              resolved.providerResourceId,
              "provider_unavailable",
            );
          } else {
            this.store.recordSuccess(
              resolved.credentialId,
              resolved.providerResourceId,
              latencyMs,
            );
          }
          const promptEst = estimateTokensOf(opts.normalized);
          const completionEst = Math.max(
            1,
            Math.ceil(info.fullText.length / 4),
          );
          const usage = info.usage ?? {
            promptTokens: promptEst,
            completionTokens: completionEst,
            totalTokens: promptEst + completionEst,
          };
          try {
            // Mirror accountUsage()'s metric set so streams and
            // non-streams account identically.
            const record = (
              metric: QuotaWindow["metric"],
              quantity: number,
            ) => {
              this.store.recordUsage({
                requestId,
                credentialId: resolved.credentialId,
                providerResourceId: resolved.providerResourceId,
                metric,
                quantity,
              });
              this.store.incrementQuotaUsage(
                resolved.credentialId,
                metric,
                quantity,
                resolved.providerResourceId,
              );
            };
            record("requests", 1);
            record("total_tokens", usage.totalTokens);
            record("input_tokens", usage.promptTokens);
            record("output_tokens", usage.completionTokens);
          } catch {
            /* accounting never breaks the path */
          }
          this.store.appendRequestLog({
            id: `${requestId}:stream`,
            requestedResourceId: opts.resourceId,
            requestedCapability: opts.capability,
            providerPin: opts.hint?.provider ?? null,
            accountPin: opts.hint?.account ?? null,
            credentialPin: opts.hint?.credential ?? null,
            policy,
            selectedProviderId: resolved.providerId,
            selectedAccountId: resolved.accountId,
            selectedCredentialId: resolved.credentialId,
            selectedUpstreamId: resolved.upstreamId,
            selectionReason: candidateReason,
            attempts,
            status: info.aborted || info.error ? "error" : "success",
            errorClass:
              info.aborted || info.error ? "provider_unavailable" : null,
            errorMessage: info.error
              ? redactSecrets(info.error, [resolved.credentialSecret])
              : null,
            latencyMs: Date.now() - started,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
          });
        };
        const cancel = () => {
          void iter.return?.();
        };
        return {
          requestId,
          stream: rest,
          route: resolved,
          attempts,
          policy,
          selectionReason: candidateReason,
          finish,
          cancel,
        };
      } catch (err) {
        const rawError = adapter.classifyError(err);
        const classified = {
          ...rawError,
          message: redactSecrets(rawError.message, [resolved.credentialSecret]),
        };
        this.noteAttemptFailure(
          resolved.credentialId,
          resolved.providerResourceId,
          classified,
        );
        lastError = new RouterError(classified.message, {
          statusCode: mapToHttpStatus(classified.errorClass),
          code: `upstream_${classified.errorClass}`,
          errorClass: classified.errorClass,
          attempts,
        });
        // Failed attempts before the first chunk are logged like the
        // non-stream path — otherwise they never appear in /api/requests.
        this.logAttemptFailure(
          requestId,
          opts,
          policy,
          candidate,
          resolved,
          attempts,
          classified.errorClass,
          classified.message,
          started,
        );
        if (
          credentialPinned ||
          STOP_FAILOVER.has(classified.errorClass) ||
          (!classified.retryable && classified.errorClass !== "auth")
        )
          break;
      }
    }
    throw (
      lastError ??
      this.noRouteError(opts, providerPin, filtered, requestId, started, policy)
    );
  }

  private noRouteError(
    opts: ExecuteOptions,
    providerPin: string | null,
    filtered: Array<{ route: Route; reason: string }>,
    requestId: string,
    started: number,
    policy: RoutingPolicyName,
  ): RouterError {
    const reason = filtered.length
      ? `no eligible routes: ${filtered[0].reason}${filtered.length > 1 ? ` (+${filtered.length - 1} more)` : ""}`
      : `unknown resource or no routes configured for ${opts.resourceId}`;
    const pressured = filtered.some((f) =>
      /quota|rate limit|exhausted|cooldown/i.test(f.reason),
    );
    const statusCode = pressured
      ? 429
      : providerPin && filtered.length
        ? 404
        : filtered.length
          ? 503
          : 404;
    const code =
      statusCode === 404
        ? "route_not_found"
        : statusCode === 429
          ? "rate_limited"
          : "no_eligible_routes";
    this.store.appendRequestLog({
      id: requestId,
      requestedResourceId: opts.resourceId,
      requestedCapability: opts.capability,
      providerPin: opts.hint?.provider ?? null,
      accountPin: opts.hint?.account ?? null,
      credentialPin: opts.hint?.credential ?? null,
      policy,
      attempts: 0,
      status: "error",
      errorClass:
        statusCode === 404
          ? "unsupported"
          : statusCode === 429
            ? "rate_limit"
            : "provider_unavailable",
      errorMessage: reason,
      latencyMs: Date.now() - started,
    });
    return new RouterError(reason, {
      statusCode,
      code,
      errorClass:
        statusCode === 404
          ? "unsupported"
          : statusCode === 429
            ? "rate_limit"
            : "provider_unavailable",
    });
  }

  /** Record each failed attempt against the executable route actually used. */
  private logAttemptFailure(
    requestId: string,
    opts: ExecuteOptions,
    policy: RoutingPolicyName,
    candidate: ScoredCandidate,
    resolved: ResolvedRoute,
    attempts: number,
    errorClass: ProviderErrorClass,
    errorMessage: string,
    started: number,
  ): void {
    this.store.appendRequestLog({
      id: `${requestId}:attempt${attempts}`,
      requestedResourceId: opts.resourceId,
      requestedCapability: opts.capability,
      providerPin: opts.hint?.provider ?? null,
      accountPin: opts.hint?.account ?? null,
      credentialPin: opts.hint?.credential ?? null,
      policy,
      selectedProviderId: resolved.providerId,
      selectedAccountId: resolved.accountId,
      selectedCredentialId: resolved.credentialId,
      selectedUpstreamId: resolved.upstreamId,
      selectionReason: candidate.reason,
      attempts,
      status: "error",
      errorClass,
      errorMessage,
      latencyMs: Date.now() - started,
    });
  }

  /**
   * Preserve score order. Rotate only equal-scored routes within a provider.
   * A provider pin takes precedence even when cross-provider fallback is allowed.
   */
  private orderAttempts(
    eligible: ScoredCandidate[],
    providerPin: string | null,
  ): ScoredCandidate[] {
    if (eligible.length <= 1) return eligible;
    const out = [...eligible].sort((a, b) => {
      const pinOrder =
        Number(b.route.providerId === providerPin) -
        Number(a.route.providerId === providerPin);
      return pinOrder || b.score - a.score;
    });
    const groups = new Map<string, number[]>();
    out.forEach((c, i) => {
      const key = `${c.route.providerId}:${c.score}`;
      const positions = groups.get(key) ?? [];
      positions.push(i);
      groups.set(key, positions);
    });
    const cursors = new Map<string, number>();
    for (const positions of groups.values()) {
      if (positions.length < 2) continue;
      const ordered = positions
        .map((i) => out[i])
        .sort(
          (a, b) =>
            a.route.credentialId.localeCompare(b.route.credentialId) ||
            a.route.routeId.localeCompare(b.route.routeId),
        );
      const providerId = ordered[0].route.providerId;
      const cursor =
        cursors.get(providerId) ?? this.keyCursor.get(providerId) ?? 0;
      const start = cursor % ordered.length;
      cursors.set(providerId, cursor);
      positions.forEach((pos, i) => {
        out[pos] = ordered[(start + i) % ordered.length];
      });
    }
    for (const [providerId, cursor] of cursors)
      this.keyCursor.set(providerId, cursor + 1);
    return out;
  }

  /** Record the failure. A 401 retires the key; other key errors only cool it down. */
  private noteAttemptFailure(
    credentialId: string,
    providerResourceId: string,
    classified: ProviderError,
  ): void {
    this.store.recordFailure(
      credentialId,
      providerResourceId,
      classified.errorClass,
    );
    if (classified.errorClass === "auth" && classified.statusCode === 401) {
      try {
        this.store.markCredentialValidated(credentialId, false);
      } catch {
        /* store may be read-only in tests */
      }
    }
  }

  /** Decrypt credential secret and attach the effective base URL. Secret never touches logs. */
  private resolveRoute(route: Route): ResolvedRoute {
    const cred = this.store.getCredential(route.credentialId);
    if (!cred)
      throw new RouterError(`credential not found: ${route.credentialId}`, {
        statusCode: 500,
      });
    const provider = this.store.getProvider(route.providerId);
    const effectiveBaseUrl =
      provider?.baseUrl ??
      this.defaultBaseUrls[route.providerId] ??
      this.defaultBaseUrls["*"] ??
      "";
    if (!effectiveBaseUrl) {
      throw new RouterError(
        `no base URL configured for provider ${route.providerId}`,
        { statusCode: 500 },
      );
    }
    return {
      ...route,
      credentialSecret: decryptSecret(cred.secretEncrypted),
      effectiveBaseUrl,
    };
  }

  private accountUsage(
    requestId: string,
    route: ResolvedRoute,
    response: NormalizedResponse,
  ): void {
    const usage = extractUsage(response);
    try {
      // Tool accounting drives the live rate windows (searches/pages/crawl_units).
      const toolMetric = toolQuotaMetric(response);
      if (toolMetric) {
        this.store.recordUsage({
          requestId,
          credentialId: route.credentialId,
          providerResourceId: route.providerResourceId,
          metric: toolMetric.metric,
          quantity: toolMetric.quantity,
        });
        this.store.incrementQuotaUsage(
          route.credentialId,
          toolMetric.metric,
          toolMetric.quantity,
          route.providerResourceId,
        );
      }
      if (usage?.totalTokens) {
        this.store.recordUsage({
          requestId,
          credentialId: route.credentialId,
          providerResourceId: route.providerResourceId,
          metric: "total_tokens",
          quantity: usage.totalTokens,
        });
        this.store.incrementQuotaUsage(
          route.credentialId,
          "total_tokens",
          usage.totalTokens,
          route.providerResourceId,
        );
      }
      if (usage?.promptTokens) {
        this.store.recordUsage({
          requestId,
          credentialId: route.credentialId,
          providerResourceId: route.providerResourceId,
          metric: "input_tokens",
          quantity: usage.promptTokens,
        });
        this.store.incrementQuotaUsage(
          route.credentialId,
          "input_tokens",
          usage.promptTokens,
          route.providerResourceId,
        );
      }
      if (usage?.completionTokens) {
        this.store.recordUsage({
          requestId,
          credentialId: route.credentialId,
          providerResourceId: route.providerResourceId,
          metric: "output_tokens",
          quantity: usage.completionTokens,
        });
        this.store.incrementQuotaUsage(
          route.credentialId,
          "output_tokens",
          usage.completionTokens,
          route.providerResourceId,
        );
      }
      this.store.recordUsage({
        requestId,
        credentialId: route.credentialId,
        providerResourceId: route.providerResourceId,
        metric: "requests",
        quantity: 1,
      });
      this.store.incrementQuotaUsage(
        route.credentialId,
        "requests",
        1,
        route.providerResourceId,
      );
    } catch {
      /* accounting must never break the response path */
    }
  }
}

/** Quota quantity for a tool response: searches/pages/crawl_units. */
function toolQuotaMetric(
  response: NormalizedResponse,
): { metric: "searches" | "pages" | "crawl_units"; quantity: number } | null {
  switch (response.kind) {
    case "web.search":
      return { metric: "searches", quantity: 1 };
    case "web.scrape":
      return { metric: "pages", quantity: 1 };
    case "web.extract":
      return {
        metric: "pages",
        quantity: Math.max(1, response.body.results.length),
      };
    case "web.crawl":
      return {
        metric: "crawl_units",
        quantity: Math.max(1, response.body.pages.length),
      };
    case "web.map":
      return { metric: "crawl_units", quantity: 1 };
    default:
      return null;
  }
}

function extractUsage(response: NormalizedResponse): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} | null {
  if (response.kind === "llm.chat" && response.body.usage) {
    return {
      promptTokens: response.body.usage.promptTokens,
      completionTokens: response.body.usage.completionTokens,
      totalTokens: response.body.usage.totalTokens,
    };
  }
  return null;
}

function estimateTokensOf(request: NormalizedRequest): number {
  if (request.kind !== "llm.chat") return 64;
  const chars = request.body.messages.reduce(
    (n, m) => n + (m.content ? m.content.length : 0),
    0,
  );
  return estimateTokensFromChars(chars);
}

function mapToHttpStatus(errorClass: ProviderErrorClass): number {
  switch (errorClass) {
    case "auth":
      return 401;
    case "bad_request":
    case "context_limit":
    case "unsupported":
      return 400;
    case "rate_limit":
    case "quota_exhausted":
      return 429;
    case "timeout":
      return 504;
    default:
      return 502;
  }
}
