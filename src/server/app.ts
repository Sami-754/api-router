import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "../core/store.js";
import { Router } from "../core/router.js";
import type { ProviderRegistry } from "../provider-sdk/registry.js";
import { registerLlmRoutes } from "./routes/llm.js";
import { registerToolRoutes } from "./routes/tools.js";
import { registerProtocolRoutes } from "./routes/protocols.js";
import { registerManagementRoutes } from "./routes/management.js";

export interface RuntimeSettings {
  defaultPolicy: string;
}

export interface AppDeps {
  store: Store;
  registry: ProviderRegistry;
  router: Router;
  settings: RuntimeSettings;
  fetchImpl?: typeof fetch;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 1_048_576, // 1 MiB request size limit
    genReqId: (req) =>
      (req.headers["x-router-request-id"] as string) ?? crypto.randomUUID(),
  });

  await app.register(cors, { origin: true });
  // Local-first traffic (dashboard bursts, validation jobs) is legitimate;
  // abuse protection still applies per IP. Upstream provider quotas are
  // enforced separately by the routing core.
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });

  app.get("/healthz", async () => ({
    ok: true,
    service: "api-router",
    version: "0.1.0",
  }));

  // Dashboard UI (static, no build step). Local-first single-user service:
  // no auth — bind to loopback / trust the local network instead.
  const publicDir = resolve(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public"),
  );
  const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  const servePublic = (rel: string) => {
    const abs = resolve(join(publicDir, rel));
    if (!abs.startsWith(publicDir + sep) && abs !== publicDir)
      throw new Error("bad path");
    const ext = abs.slice(abs.lastIndexOf("."));
    return { abs, mime: MIME[ext] ?? "application/octet-stream" };
  };
  app.get("/dashboard", async (_req, reply) => {
    try {
      const { abs, mime } = servePublic("index.html");
      return reply.type(mime).send(readFileSync(abs));
    } catch {
      return reply.code(404).send({
        error: {
          message: "dashboard not built",
          type: "not_found",
          code: 404,
        },
      });
    }
  });
  app.get("/dashboard/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    if (!/^[a-z0-9_-]+\.(js|css|svg)$/i.test(file)) {
      return reply.code(404).send({
        error: { message: "not found", type: "not_found", code: 404 },
      });
    }
    try {
      const { abs, mime } = servePublic(file);
      return reply.type(mime).send(readFileSync(abs));
    } catch {
      return reply.code(404).send({
        error: { message: "not found", type: "not_found", code: 404 },
      });
    }
  });

  app.get("/", async () => ({
    service: "api-router",
    version: "0.1.0",
    dashboard: "/dashboard",
    message: "Open /dashboard for the management UI.",
    endpoints: {
      health: "GET /healthz",
      models: "GET /v1/models",
      chat: "POST /v1/chat/completions",
      providers: "GET /api/providers",
      routes: "GET /api/routes?resource=<id>&capability=llm.chat",
      simulate: "POST /api/routing/simulate",
      quotas: "GET /api/quotas",
      requests: "GET /api/requests",
    },
    docs: "docs/api.md",
  }));

  await registerLlmRoutes(app, deps);
  await registerToolRoutes(app, deps);
  await registerProtocolRoutes(app, deps);
  await registerManagementRoutes(app, deps);

  app.setErrorHandler((err, _req, reply) => {
    const status =
      (err as unknown as { statusCode?: number }).statusCode ?? 500;
    const message = err instanceof Error ? err.message : "internal error";
    // Never leak stack traces or secrets; OpenAI-style envelope.
    reply.code(status).send({
      error: { message, type: "server_error", code: status },
    });
  });

  return app;
}
