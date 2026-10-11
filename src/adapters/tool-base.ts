import {
  classifyHttpStatus,
  networkError,
  timeoutError,
} from "../provider-sdk/error-classify.js";
import type {
  AdapterContext,
  CredentialValidationResult,
  NormalizedRequest,
  NormalizedResponse,
  ProviderAdapter,
  ProviderError,
  ResolvedRoute,
  StoredCredentialView,
} from "../provider-sdk/types.js";
import type { Capability, QuotaMetric } from "../shared/types.js";

// Plug-and-play tool adapter factory.
//
// A new tool provider = one file that calls `defineToolAdapter()` with a
// `handlers` entry per capability it supports, plus one registration line in
// `src/server/boot.ts` and provider/account/credential/mapping rows. No core,
// routing, quota, or route-file edits. Unlisted capabilities are simply
// ineligible at route-expansion time (no mapping → no route).
//
// Reference shapes (verified against live docs 2026-09-29):
//   Exa      base https://api.exa.ai      auth x-api-key header (Bearer also works)
//            POST /search   {query, numResults, includeDomains, excludeDomains}
//            POST /contents {ids, text:true}  (scrape + extract)
//   Tavily   base https://api.tavily.com   auth Bearer tvly-... header
//            POST /search  {query, max_results, ...}
//            POST /extract {urls, query, format:"markdown"}
//            POST /crawl   {url, ...} → {base_url, results:[{url, raw_content}]}
//            POST /map     {url, limit} → {base_url, results:[url,...]}
//   Firecrawl base https://api.firecrawl.dev  auth Bearer fc-... header (v2 paths)
//            POST /v2/search {query, limit, ...} → {success, data:[...]}
//            POST /v2/scrape {url, formats:["markdown"], onlyMainContent}
//            POST /v2/crawl  {url, limit, ...} → async {id} + GET /v2/crawl/{id}
//            POST /v2/map    {url, limit} → {success, links:[{url}]}

export type ToolCapability =
  "web.search" | "web.scrape" | "web.extract" | "web.crawl" | "web.map";

export type ToolQuotaMetric = Extract<
  QuotaMetric,
  "searches" | "pages" | "crawl_units"
>;

export interface ToolCall {
  secret: string;
  base: string;
  headers: Record<string, string>;
  normalized: NormalizedRequest;
  route: ResolvedRoute;
  context: AdapterContext;
  post: <T = unknown>(
    path: string,
    payload: Record<string, unknown>,
  ) => Promise<{ status: number; json: T; text: string }>;
  get: <T = unknown>(
    path: string,
  ) => Promise<{ status: number; json: T; text: string }>;
}

export interface ToolHandler {
  capability: ToolCapability;
  description: string;
  /** Minimal explicit-validation probe (always a user action, never automatic). */
  probe: { path: string; body: (secret: string) => Record<string, unknown> };
  quotaMetric: ToolQuotaMetric;
  run: (call: ToolCall) => Promise<NormalizedResponse>;
}

export type ToolAuth =
  | { kind: "x-api-key" }
  | { kind: "bearer" }
  | { kind: "bearer"; bodyKey: string };

export interface ToolAdapterOptions {
  providerId: string;
  displayName: string;
  defaultBaseUrl: string;
  auth: ToolAuth;
  handlers: ToolHandler[];
}

export function authHeaders(
  auth: ToolAuth,
  secret: string,
): Record<string, string> {
  const base: Record<string, string> = { "Content-Type": "application/json" };
  if (auth.kind === "x-api-key") return { ...base, "x-api-key": secret };
  return { ...base, Authorization: `Bearer ${secret}` };
}

/** Merge legacy body-key auth (e.g. Tavily's `api_key`) into a payload. */
export function withBodyAuth(
  auth: ToolAuth,
  secret: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (auth.kind === "bearer" && "bodyKey" in auth && auth.bodyKey) {
    return { [auth.bodyKey]: secret, ...payload };
  }
  return payload;
}

async function requestWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function toProviderError(
  status: number,
  text: string,
  url: string,
): ProviderError {
  let code: string | undefined;
  try {
    const j = JSON.parse(text) as {
      error?: { code?: string; type?: string } | string;
    };
    if (typeof j?.error === "string") code = j.error;
    else code = j?.error?.code ?? j?.error?.type ?? undefined;
  } catch {
    code = undefined;
  }
  const err = classifyHttpStatus(status, `${text} ${url}`, code);
  return err;
}

export function defineToolAdapter(opts: ToolAdapterOptions): ProviderAdapter {
  const id = opts.providerId.toLowerCase();
  const baseOf = (route?: ResolvedRoute, ctx?: AdapterContext): string => {
    const raw =
      ctx?.baseUrl?.trim() ||
      route?.effectiveBaseUrl?.trim() ||
      opts.defaultBaseUrl;
    return raw.replace(/\/$/, "");
  };
  const byCapability = new Map<ToolCapability, ToolHandler>(
    opts.handlers.map((h) => [h.capability, h]),
  );

  const callFor = (
    secret: string,
    base: string,
    normalized: NormalizedRequest,
    route: ResolvedRoute,
    context: AdapterContext,
  ): ToolCall => {
    const headers = authHeaders(opts.auth, secret);
    const fetchImpl = context.fetchImpl ?? fetch;
    const doRequest = async <T>(
      method: "POST" | "GET",
      path: string,
      payload?: Record<string, unknown>,
    ): Promise<{ status: number; json: T; text: string }> => {
      const url = `${base}${path}`;
      let res: Response;
      try {
        res = await requestWithTimeout(
          fetchImpl,
          url,
          {
            method,
            headers,
            body: payload ? JSON.stringify(payload) : undefined,
          },
          context.timeoutMs,
        );
      } catch (e) {
        if (
          e instanceof Error &&
          (e.name === "AbortError" || /abort/i.test(e.message))
        ) {
          throw Object.assign(
            new Error(`upstream timeout after ${context.timeoutMs}ms`),
            {
              providerError: timeoutError("timeout"),
            },
          );
        }
        throw Object.assign(
          new Error(
            `upstream network error: ${e instanceof Error ? e.message : String(e)}`,
          ),
          {
            providerError: networkError(String(e)),
          },
        );
      }
      const text = await res.text();
      if (!res.ok) {
        const classified = toProviderError(res.status, text, url);
        throw Object.assign(new Error(classified.message), {
          providerError: classified,
        });
      }
      let json: T;
      try {
        json = JSON.parse(text) as T;
      } catch {
        throw Object.assign(new Error("invalid JSON from upstream"), {
          providerError: {
            errorClass: "provider_unavailable",
            message: "invalid JSON",
            retryable: true,
          } satisfies ProviderError,
        });
      }
      return { status: res.status, json, text };
    };
    return {
      secret,
      base,
      headers,
      normalized,
      route,
      context,
      post: (path, payload) =>
        doRequest("POST", path, withBodyAuth(opts.auth, secret, payload)),
      get: (path) => doRequest("GET", path),
    };
  };

  return {
    id,
    displayName: opts.displayName,

    capabilities() {
      return opts.handlers.map((h) => ({
        capability: h.capability as Capability,
        description: h.description,
      }));
    },

    async validateCredential(
      credential: StoredCredentialView,
      context: AdapterContext,
    ): Promise<CredentialValidationResult> {
      const first = opts.handlers[0];
      if (!first) return { ok: false, message: "no capabilities registered" };
      try {
        await callFor(
          credential.secret,
          (context.baseUrl?.trim() || opts.defaultBaseUrl).replace(/\/$/, ""),
          {
            kind: "web.search",
            body: {
              requestId: context.requestId,
              query: "probe",
              maxResults: 1,
            },
          },
          {
            effectiveBaseUrl: context.baseUrl ?? opts.defaultBaseUrl,
          } as ResolvedRoute,
          context,
        ).post(first.probe.path, first.probe.body(credential.secret));
        return { ok: true, message: "credential valid" };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/upstream HTTP (401|403)/.test(msg))
          return { ok: false, message: "credential rejected" };
        return { ok: false, message: msg };
      }
    },

    async execute(
      request: NormalizedRequest,
      route: ResolvedRoute,
      context: AdapterContext,
    ): Promise<NormalizedResponse> {
      const kind = request.kind as ToolCapability;
      const handler = byCapability.get(kind);
      if (!handler) {
        throw Object.assign(
          new Error(`unsupported capability for ${id}: ${request.kind}`),
          {
            providerError: {
              errorClass: "unsupported",
              message: "unsupported",
              retryable: false,
            } satisfies ProviderError,
          },
        );
      }
      const call = callFor(
        route.credentialSecret,
        baseOf(route, context),
        request,
        route,
        context,
      );
      return handler.run(call);
    },

    classifyError(error: unknown): ProviderError {
      if (
        typeof error === "object" &&
        error !== null &&
        "providerError" in error
      ) {
        return (error as { providerError: ProviderError }).providerError;
      }
      if (error instanceof Error) {
        if (/timeout|aborted|abort/i.test(error.message))
          return timeoutError(error.message);
        if (
          /fetch failed|network|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(
            error.message,
          )
        ) {
          return networkError(error.message);
        }
      }
      return {
        errorClass: "unknown",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      };
    },
  };
}

/** Poll a Firecrawl-style async crawl job until completion or timeout. */
export async function pollCrawlJob<T>(
  call: ToolCall,
  jobId: string,
  opts: { pollMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const pollMs = opts.pollMs ?? 2000;
  const budgetMs = Math.max(
    10_000,
    Math.min(opts.timeoutMs ?? call.context.timeoutMs, 120_000),
  );
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw Object.assign(
        new Error(`crawl ${jobId} did not finish within ${budgetMs}ms`),
        {
          providerError: timeoutError("crawl polling timed out"),
        },
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
    const { json } = await call.get<T>(`/v2/crawl/${jobId}`);
    const status = String(
      (json as Record<string, unknown>).status ?? "",
    ).toLowerCase();
    if (["completed", "complete", "done", "finished"].includes(status))
      return json;
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      throw Object.assign(new Error(`crawl ${jobId} ${status}`), {
        providerError: {
          errorClass: "provider_unavailable",
          message: `crawl ${status}`,
          retryable: true,
        } satisfies ProviderError,
      });
    }
    // Unknown/absent status with inline data → treat as done (defensive).
    if (!status && Array.isArray((json as Record<string, unknown>).data))
      return json;
  }
}
