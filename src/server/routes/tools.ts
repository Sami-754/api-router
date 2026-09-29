import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import {
  crawlRequestSchema,
  extractRequestSchema,
  mapRequestSchema,
  scrapeRequestSchema,
  searchRequestSchema,
} from "../../shared/schemas.js";
import { routingHintsFromHeaders } from "../../shared/model-string.js";
import type { Capability, RoutingPolicyName } from "../../shared/types.js";
import { RouterError, type Router } from "../../core/router.js";
import type { NormalizedRequest } from "../../provider-sdk/types.js";
import type { AppDeps } from "../app.js";

// Generic tool path — same routing core as LLMs, capability-addressed.
// Provider pin via body.routing.provider or X-Router-Provider header.
//
// Adding a new capability here = one table entry (no core edits). Adding a
// new provider = one adapter file (see src/adapters/tool-base.ts) + mappings.

interface ToolRouteDef {
  capability: Capability;
  path: "/v1/tools/search" | "/v1/tools/scrape" | "/v1/tools/extract" | "/v1/tools/crawl" | "/v1/tools/map";
  schema:
    | typeof searchRequestSchema
    | typeof scrapeRequestSchema
    | typeof extractRequestSchema
    | typeof crawlRequestSchema
    | typeof mapRequestSchema;
  /** Canonical resource id for this capability (doubles as the resource row). */
  resourceId: string;
  toNormalized: (body: Record<string, unknown>, requestId: string) => NormalizedRequest;
  fromOutcome: (outcome: {
    response: Extract<NormalizedRequest, { kind: never }>;
    route: { providerId: string; accountId: string };
    policy: string;
    attempts: number;
    selectionReason: string;
  }) => Record<string, unknown>;
}

const TOOL_ROUTES: ToolRouteDef[] = [
  {
    capability: "web.search",
    path: "/v1/tools/search",
    schema: searchRequestSchema,
    resourceId: "web.search",
    toNormalized: (body, requestId) => {
      const b = body as unknown as z.infer<typeof searchRequestSchema>;
      return {
        kind: "web.search",
        body: {
          requestId,
          query: b.query,
          maxResults: b.maxResults,
          includeDomains: b.includeDomains,
          excludeDomains: b.excludeDomains,
          recencyDays: b.recencyDays,
        },
      };
    },
    fromOutcome: (o) => {
      const r = o.response as unknown as { kind: "web.search"; body: { results: unknown[] } };
      return { object: "search.results", results: r.body.results };
    },
  },
  {
    capability: "web.scrape",
    path: "/v1/tools/scrape",
    schema: scrapeRequestSchema,
    resourceId: "web.scrape",
    toNormalized: (body, requestId) => {
      const b = body as unknown as z.infer<typeof scrapeRequestSchema>;
      return {
        kind: "web.scrape",
        body: { requestId, url: b.url, maxChars: b.maxChars, onlyMainContent: b.onlyMainContent },
      };
    },
    fromOutcome: (o) => {
      const r = o.response as unknown as {
        kind: "web.scrape";
        body: { url: string; title?: string; markdown: string };
      };
      return { object: "scrape.result", url: r.body.url, title: r.body.title, markdown: r.body.markdown };
    },
  },
  {
    capability: "web.extract",
    path: "/v1/tools/extract",
    schema: extractRequestSchema,
    resourceId: "web.extract",
    toNormalized: (body, requestId) => {
      const b = body as unknown as z.infer<typeof extractRequestSchema>;
      return { kind: "web.extract", body: { requestId, urls: b.urls, query: b.query } };
    },
    fromOutcome: (o) => {
      const r = o.response as unknown as { kind: "web.extract"; body: { results: unknown[] } };
      return { object: "extract.results", results: r.body.results };
    },
  },
  {
    capability: "web.crawl",
    path: "/v1/tools/crawl",
    schema: crawlRequestSchema,
    resourceId: "web.crawl",
    toNormalized: (body, requestId) => {
      const b = body as unknown as z.infer<typeof crawlRequestSchema>;
      return {
        kind: "web.crawl",
        body: {
          requestId,
          url: b.url,
          limit: b.limit,
          includePaths: b.includePaths,
          excludePaths: b.excludePaths,
        },
      };
    },
    fromOutcome: (o) => {
      const r = o.response as unknown as { kind: "web.crawl"; body: { pages: unknown[] } };
      return { object: "crawl.results", pages: r.body.pages };
    },
  },
  {
    capability: "web.map",
    path: "/v1/tools/map",
    schema: mapRequestSchema,
    resourceId: "web.map",
    toNormalized: (body, requestId) => {
      const b = body as unknown as z.infer<typeof mapRequestSchema>;
      return { kind: "web.map", body: { requestId, url: b.url, limit: b.limit } };
    },
    fromOutcome: (o) => {
      const r = o.response as unknown as { kind: "web.map"; body: { links: unknown[] } };
      return { object: "map.results", links: r.body.links };
    },
  },
];

export async function registerToolRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  for (const def of TOOL_ROUTES) {
    app.post(def.path, async (req, reply) => {
      const parsed = def.schema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { message: parsed.error.issues[0]?.message ?? "invalid request", type: "invalid_request", code: 400 },
        });
      }
      const body = parsed.data as unknown as {
        routing?: Parameters<Router["execute"]>[0]["hint"];
      } & Record<string, unknown>;
      const headerHints = routingHintsFromHeaders(req.headers as Record<string, string>);
      const hint = {
        provider: body.routing?.provider ?? headerHints.provider ?? null,
        account: body.routing?.account ?? headerHints.account ?? null,
        credential: body.routing?.credential ?? headerHints.credential ?? null,
        policy: (body.routing?.policy ?? headerHints.policy ?? deps.settings.defaultPolicy) as RoutingPolicyName,
        allowCrossProviderFallback: body.routing?.allowCrossProviderFallback ?? null,
        estimatedCost: 1,
      };

      if (!deps.store.getResource(def.resourceId)) {
        return reply.code(404).send({
          error: { message: `capability ${def.capability} is not configured`, type: "route_not_found", code: 404 },
        });
      }

      try {
        const outcome = await deps.router.execute({
          requestId: req.id,
          resourceId: def.resourceId,
          capability: def.capability,
          hint,
          normalized: def.toNormalized(body, req.id),
        });
        reply.header("X-Router-Via", `${outcome.route.providerId}/${def.capability}`);
        reply.header("X-Router-Policy", outcome.policy);
        reply.header("X-Router-Attempts", String(outcome.attempts));
        reply.header("X-Router-Request-ID", outcome.requestId);
        return {
          ...def.fromOutcome(outcome as never),
          _router: {
            provider: outcome.route.providerId,
            account: outcome.route.accountId,
            policy: outcome.policy,
            attempts: outcome.attempts,
            reason: outcome.selectionReason,
          },
        };
      } catch (e) {
        if (e instanceof RouterError) {
          return reply.code(e.statusCode).send({ error: { message: e.message, type: e.code, code: e.statusCode } });
        }
        const message = e instanceof Error ? e.message : String(e);
        return reply.code(500).send({ error: { message, type: "server_error", code: 500 } });
      }
    });
  }
}
