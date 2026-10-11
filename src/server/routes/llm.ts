import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { chatCompletionsSchema } from "../../shared/schemas.js";
import {
  parseModelString,
  routingHintsFromHeaders,
} from "../../shared/model-string.js";
import { estimateRequestTokens } from "../../shared/tokens.js";
import type { Capability, RoutingPolicyName } from "../../shared/types.js";
import { RouterError } from "../../core/router.js";
import type { AppDeps } from "../app.js";

function openAIError(reply: { code(n: number): unknown }, e: unknown) {
  if (e instanceof RouterError) {
    return (reply as { code(n: number): { send(b: unknown): unknown } })
      .code(e.statusCode)
      .send({
        error: { message: e.message, type: e.code, code: e.statusCode },
      });
  }
  const message = e instanceof Error ? e.message : String(e);
  const status = /validation|invalid|parse/i.test(message) ? 400 : 500;
  return (reply as { code(n: number): { send(b: unknown): unknown } })
    .code(status)
    .send({ error: { message, type: "server_error", code: status } });
}

export async function registerLlmRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  // OpenAI-compatible model list: canonical LLM resources.
  app.get("/v1/models", async () => {
    const resources = deps.store
      .listResources()
      .filter((r) => r.kind === "llm_model");
    return {
      object: "list",
      data: resources.map((r) => ({
        id: r.id.replace(/^llm:model:/, ""),
        object: "model",
        owned_by: "router",
        capabilities: r.capabilities,
      })),
    };
  });

  app.post("/v1/chat/completions", async (req, reply) => {
    const parsed = chatCompletionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          message: parsed.error.issues[0]?.message ?? "invalid request",
          type: "invalid_request",
          code: 400,
        },
      });
    }
    const body = parsed.data;

    let model;
    try {
      model = parseModelString(body.model);
    } catch (e) {
      return reply.code(400).send({
        error: {
          message: e instanceof Error ? e.message : String(e),
          type: "invalid_request",
          code: 400,
        },
      });
    }

    const headerHints = routingHintsFromHeaders(
      req.headers as Record<string, string>,
    );
    const hint = {
      provider:
        body.routing?.provider ??
        headerHints.provider ??
        model.providerPin ??
        null,
      account: body.routing?.account ?? headerHints.account ?? null,
      credential: body.routing?.credential ?? headerHints.credential ?? null,
      policy: (body.routing?.policy ??
        headerHints.policy ??
        deps.settings.defaultPolicy) as RoutingPolicyName,
      allowCrossProviderFallback:
        body.routing?.allowCrossProviderFallback ?? null,
      estimatedCost:
        body.routing?.estimatedCost ??
        estimateRequestTokens(
          body.messages,
          body.max_tokens ?? body.max_completion_tokens,
        ) ??
        null,
    };

    const resource = deps.store.getResource(model.canonicalResourceId);
    if (!resource) {
      return reply.code(404).send({
        error: {
          message: `unknown model "${model.logicalModel}"; register resource ${model.canonicalResourceId} first`,
          type: "route_not_found",
          code: 404,
        },
      });
    }

    const capability: Capability = "llm.chat";
    const normalized = {
      kind: "llm.chat" as const,
      body: {
        requestId: req.id,
        messages: body.messages.map((m) => ({
          role: m.role,
          content:
            typeof m.content === "string"
              ? m.content
              : JSON.stringify(m.content),
        })),
        temperature: body.temperature,
        topP: body.top_p,
        maxTokens: body.max_tokens ?? body.max_completion_tokens ?? undefined,
        stop: body.stop,
        tools: body.tools,
        toolChoice: body.tool_choice,
        user: body.user,
      },
    };

    if (body.stream)
      return streamChat(
        req,
        reply,
        deps,
        body.model,
        resource.id,
        capability,
        hint,
        normalized,
      );

    try {
      const outcome = await deps.router.execute({
        requestId: req.id,
        resourceId: resource.id,
        capability,
        hint,
        normalized,
        requestedTokens: hint.estimatedCost,
      });
      if (outcome.response.kind !== "llm.chat")
        throw new Error("adapter returned wrong response kind");
      const chat = outcome.response.body;
      reply.header(
        "X-Router-Via",
        `${outcome.route.providerId}/${outcome.route.upstreamId}`,
      );
      reply.header("X-Router-Policy", outcome.policy);
      reply.header("X-Router-Attempts", String(outcome.attempts));
      reply.header("X-Router-Request-ID", outcome.requestId);
      return {
        id: `chatcmpl-${outcome.requestId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: chat.choices.map((c) => ({
          index: c.index,
          message: c.message,
          finish_reason: c.finishReason,
        })),
        usage: chat.usage
          ? {
              prompt_tokens: chat.usage.promptTokens,
              completion_tokens: chat.usage.completionTokens,
              total_tokens: chat.usage.totalTokens,
            }
          : undefined,
        _router: {
          provider: outcome.route.providerId,
          account: outcome.route.accountId,
          upstreamModel: outcome.route.upstreamId,
          policy: outcome.policy,
          attempts: outcome.attempts,
          reason: outcome.selectionReason,
        },
      };
    } catch (e) {
      return openAIError(reply, e);
    }
  });
}

/**
 * SSE streaming. The router commits to one route on the first upstream
 * chunk — no cross-provider retry after the client has headers.
 */
async function streamChat(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: AppDeps,
  requestedModel: string,
  resourceId: string,
  capability: Capability,
  hint: {
    provider: string | null;
    account: string | null;
    credential: string | null;
    policy: RoutingPolicyName;
    allowCrossProviderFallback: boolean | null;
    estimatedCost: number | null;
  },
  normalized: {
    kind: "llm.chat";
    body: {
      requestId: string;
      messages: Array<{ role: string; content: string }>;
      temperature?: number;
      topP?: number;
      maxTokens?: number;
      stop?: string | string[];
      tools?: unknown[];
      toolChoice?: unknown;
      user?: string;
    };
  },
): Promise<void> {
  let outcome;
  try {
    outcome = await deps.router.executeStream({
      requestId: req.id,
      resourceId,
      capability,
      hint,
      normalized,
      requestedTokens: hint.estimatedCost,
    });
  } catch (e) {
    return openAIError(reply, e) as unknown as Promise<void>;
  }

  reply.hijack();
  const raw = reply.raw;
  const created = Math.floor(Date.now() / 1000);
  const sseId = `chatcmpl-${outcome.requestId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Router-Via": `${outcome.route.providerId}/${outcome.route.upstreamId}`,
    "X-Router-Policy": outcome.policy,
    "X-Router-Attempts": String(outcome.attempts),
    "X-Router-Request-ID": outcome.requestId,
  });

  let fullText = "";
  let usage:
    | { promptTokens: number; completionTokens: number; totalTokens: number }
    | undefined;
  let aborted = false;
  let lastFinish: string | null = null;
  req.raw.on("close", () => {
    aborted = true;
  });
  const send = (obj: unknown) => {
    if (!aborted) raw.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  try {
    for await (const chunk of outcome.stream) {
      if (aborted) break;
      fullText += chunk.delta;
      if (chunk.usage) usage = chunk.usage;
      if (chunk.finishReason) lastFinish = chunk.finishReason;
      send({
        id: sseId,
        object: "chat.completion.chunk",
        created,
        model: requestedModel,
        choices: [
          {
            index: 0,
            delta: chunk.delta ? { content: chunk.delta } : {},
            finish_reason: chunk.finishReason ?? null,
          },
        ],
      });
    }
    if (!aborted && lastFinish == null) {
      send({
        id: sseId,
        object: "chat.completion.chunk",
        created,
        model: requestedModel,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });
    }
    if (!aborted) raw.write("data: [DONE]\n\n");
    outcome.finish({ fullText, usage, aborted });
  } catch (e) {
    // Mid-stream failure: the route is committed, so just end the stream.
    outcome.finish({
      fullText,
      usage,
      aborted,
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    raw.end();
  }
}
