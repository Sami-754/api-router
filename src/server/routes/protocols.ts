import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  parseModelString,
  routingHintsFromHeaders,
} from "../../shared/model-string.js";
import type {
  Capability,
  RoutingHint,
  RoutingPolicyName,
} from "../../shared/types.js";
import { RouterError } from "../../core/router.js";
import type { AppDeps } from "../app.js";

// Protocol shims over the same routing core:
//   POST /v1/responses — OpenAI Responses API (translating shim over chat)
//   POST /v1/messages  — Anthropic Messages API (translating shim over chat)
// Both support provider::model pins and non-streaming fully; streaming is a
// minimal event subset (text deltas + completion), not the full tool protocol.

const responsesSchema = z.object({
  model: z.string().min(1).max(512),
  input: z.union([
    z.string(),
    z.array(
      z.object({
        role: z.string().min(1),
        content: z.union([
          z.string(),
          z.array(z.object({ type: z.string() }).passthrough()),
        ]),
      }),
    ),
  ]),
  stream: z.boolean().optional(),
  max_output_tokens: z.number().int().positive().max(1_000_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  routing: z
    .object({
      provider: z.string().optional().nullable(),
      account: z.string().optional().nullable(),
      credential: z.string().optional().nullable(),
      policy: z.string().optional().nullable(),
      allowCrossProviderFallback: z.boolean().optional().nullable(),
    })
    .optional(),
});

const messagesSchema = z.object({
  model: z.string().min(1).max(512),
  messages: z
    .array(
      z.object({
        role: z.string().min(1),
        content: z.union([
          z.string(),
          z.array(z.object({ type: z.string() }).passthrough()),
        ]),
      }),
    )
    .min(1)
    .max(500),
  system: z
    .union([z.string(), z.array(z.object({ type: z.string() }).passthrough())])
    .optional(),
  max_tokens: z.number().int().positive().max(1_000_000),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
});

function toText(
  content: string | Array<{ type: string } & Record<string, unknown>>,
): string {
  if (typeof content === "string") return content;
  return content
    .map((b) => {
      if (b.type === "text" && typeof b.text === "string") return b.text;
      if (b.type === "input_text" && typeof b.text === "string") return b.text;
      if (b.type === "output_text" && typeof b.text === "string") return b.text;
      return "";
    })
    .join("");
}

interface Prepared {
  hint: RoutingHint;
  normalized: {
    kind: "llm.chat";
    body: {
      requestId: string;
      messages: Array<{ role: string; content: string }>;
      temperature?: number;
      maxTokens?: number;
    };
  };
  estimated: number;
}

function prepare(
  deps: AppDeps,
  req: FastifyRequest,
  modelRaw: string,
  messages: Array<{ role: string; content: string }>,
  opts: {
    temperature?: number;
    maxTokens?: number;
    routing?: Prepared["hint"];
  },
): Prepared | { error: { status: number; body: unknown } } {
  let parsed;
  try {
    parsed = parseModelString(modelRaw);
  } catch (e) {
    return {
      error: {
        status: 400,
        body: { message: e instanceof Error ? e.message : String(e) },
      },
    };
  }
  if (!deps.store.getResource(parsed.canonicalResourceId)) {
    return {
      error: {
        status: 404,
        body: {
          message: `unknown model "${parsed.logicalModel}" — register ${parsed.canonicalResourceId} first`,
        },
      },
    };
  }
  const headerHints = routingHintsFromHeaders(
    req.headers as Record<string, string>,
  );
  const hint: RoutingHint = {
    provider:
      opts.routing?.provider ??
      headerHints.provider ??
      parsed.providerPin ??
      null,
    account: opts.routing?.account ?? headerHints.account ?? null,
    credential: opts.routing?.credential ?? headerHints.credential ?? null,
    policy:
      ((opts.routing?.policy ??
        headerHints.policy ??
        deps.settings.defaultPolicy) as RoutingPolicyName) ?? null,
    allowCrossProviderFallback:
      opts.routing?.allowCrossProviderFallback ?? null,
  };
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  const estimated = Math.ceil(chars / 4) + (opts.maxTokens ?? 1024);
  return {
    hint,
    normalized: {
      kind: "llm.chat",
      body: {
        requestId: req.id,
        messages,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      },
    },
    estimated,
  };
}

export async function registerProtocolRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  const capability: Capability = "llm.chat";

  // ---------------- Responses API ----------------
  app.post("/v1/responses", async (req, reply) => {
    const parsed = responsesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          message: parsed.error.issues[0]?.message ?? "invalid request",
          code: "invalid_request",
        },
      });
    }
    const b = parsed.data;
    const messages =
      typeof b.input === "string"
        ? [{ role: "user", content: b.input }]
        : b.input.map((m) => ({
            role: m.role,
            content: toText(m.content as never),
          }));
    const prep = prepare(deps, req, b.model, messages, {
      temperature: b.temperature,
      maxTokens: b.max_output_tokens,
      routing: b.routing as RoutingHint | undefined,
    });
    if ("error" in prep)
      return reply
        .code(prep.error.status)
        .send({ error: { message: prep.error.body, code: "invalid_request" } });

    if (b.stream) return streamResponses(req, reply, deps, b.model, prep);
    try {
      const outcome = await deps.router.execute({
        requestId: req.id,
        resourceId: `llm:model:${parseModelString(b.model).logicalModel.toLowerCase()}`,
        capability,
        hint: prep.hint,
        normalized: prep.normalized,
        requestedTokens: prep.estimated,
      });
      if (outcome.response.kind !== "llm.chat")
        throw new Error("adapter returned wrong response kind");
      const text = outcome.response.body.choices
        .map((c) => c.message.content)
        .join("");
      const u = outcome.response.body.usage;
      setRouterHeaders(
        reply,
        outcome.route.providerId,
        outcome.route.upstreamId,
        outcome.policy,
        outcome.attempts,
        outcome.requestId,
      );
      return {
        id: `resp-${outcome.requestId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        model: b.model,
        status: "completed",
        output: [
          {
            type: "message",
            id: `msg-${outcome.requestId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`,
            role: "assistant",
            content: [{ type: "output_text", text }],
          },
        ],
        usage: u
          ? {
              input_tokens: u.promptTokens,
              output_tokens: u.completionTokens,
              total_tokens: u.totalTokens,
            }
          : undefined,
        _router: routerInfo(outcome),
      };
    } catch (e) {
      return responsesError(reply, e);
    }
  });

  // ---------------- Anthropic Messages API ----------------
  app.post("/v1/messages", async (req, reply) => {
    const parsed = messagesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: parsed.error.issues[0]?.message ?? "invalid request",
        },
      });
    }
    const b = parsed.data;
    const messages: Array<{ role: string; content: string }> = [];
    if (b.system) {
      messages.push({
        role: "system",
        content:
          typeof b.system === "string" ? b.system : toText(b.system as never),
      });
    }
    for (const m of b.messages)
      messages.push({ role: m.role, content: toText(m.content as never) });
    const prep = prepare(deps, req, b.model, messages, {
      temperature: b.temperature,
      maxTokens: b.max_tokens,
    });
    if ("error" in prep) {
      return reply.code(prep.error.status).send({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: (prep.error.body as { message: string }).message,
        },
      });
    }

    if (b.stream) return streamMessages(req, reply, deps, b.model, prep);
    try {
      const outcome = await deps.router.execute({
        requestId: req.id,
        resourceId: `llm:model:${parseModelString(b.model).logicalModel.toLowerCase()}`,
        capability,
        hint: prep.hint,
        normalized: prep.normalized,
        requestedTokens: prep.estimated,
      });
      if (outcome.response.kind !== "llm.chat")
        throw new Error("adapter returned wrong response kind");
      const text = outcome.response.body.choices
        .map((c) => c.message.content)
        .join("");
      const finish = outcome.response.body.choices[0]?.finishReason;
      const u = outcome.response.body.usage;
      setRouterHeaders(
        reply,
        outcome.route.providerId,
        outcome.route.upstreamId,
        outcome.policy,
        outcome.attempts,
        outcome.requestId,
      );
      return {
        id: `msg-${outcome.requestId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`,
        type: "message",
        role: "assistant",
        model: b.model,
        content: [{ type: "text", text }],
        stop_reason: finish === "length" ? "max_tokens" : "end_turn",
        usage: {
          input_tokens: u?.promptTokens ?? 0,
          output_tokens: u?.completionTokens ?? 0,
        },
        _router: routerInfo(outcome),
      };
    } catch (e) {
      return messagesError(reply, e);
    }
  });
}

function routerInfo(outcome: {
  route: { providerId: string; accountId: string; upstreamId: string };
  policy: string;
  attempts: number;
  selectionReason: string;
}) {
  return {
    provider: outcome.route.providerId,
    account: outcome.route.accountId,
    upstreamModel: outcome.route.upstreamId,
    policy: outcome.policy,
    attempts: outcome.attempts,
    reason: outcome.selectionReason,
  };
}

function setRouterHeaders(
  reply: FastifyReply,
  provider: string,
  upstream: string,
  policy: string,
  attempts: number,
  requestId: string,
) {
  reply.header("X-Router-Via", `${provider}/${upstream}`);
  reply.header("X-Router-Policy", policy);
  reply.header("X-Router-Attempts", String(attempts));
  reply.header("X-Router-Request-ID", requestId);
}

function responsesError(reply: FastifyReply, e: unknown) {
  if (e instanceof RouterError) {
    return reply
      .code(e.statusCode)
      .send({ error: { message: e.message, code: e.code } });
  }
  return reply.code(500).send({
    error: {
      message: e instanceof Error ? e.message : String(e),
      code: "server_error",
    },
  });
}

function messagesError(reply: FastifyReply, e: unknown) {
  if (e instanceof RouterError) {
    const type =
      e.statusCode === 429
        ? "rate_limit_error"
        : e.statusCode === 401
          ? "authentication_error"
          : "api_error";
    return reply
      .code(e.statusCode)
      .send({ type: "error", error: { type, message: e.message } });
  }
  return reply.code(500).send({
    type: "error",
    error: {
      type: "api_error",
      message: e instanceof Error ? e.message : String(e),
    },
  });
}

// Minimal streaming event subsets (text only).
async function streamResponses(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: AppDeps,
  model: string,
  prep: Prepared,
): Promise<void> {
  let outcome;
  try {
    outcome = await deps.router.executeStream({
      requestId: req.id,
      resourceId: `llm:model:${parseModelString(model).logicalModel.toLowerCase()}`,
      capability: "llm.chat",
      hint: prep.hint,
      normalized: prep.normalized,
      requestedTokens: prep.estimated,
    });
  } catch (e) {
    return responsesError(reply, e) as unknown as Promise<void>;
  }
  reply.hijack();
  const raw = reply.raw;
  const rid = `resp-${outcome.requestId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Router-Via": `${outcome.route.providerId}/${outcome.route.upstreamId}`,
    "X-Router-Policy": outcome.policy,
    "X-Router-Attempts": String(outcome.attempts),
    "X-Router-Request-ID": outcome.requestId,
  });
  let aborted = false;
  req.raw.on("close", () => {
    aborted = true;
  });
  const send = (obj: unknown) => {
    if (!aborted) raw.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  let fullText = "";
  let usage:
    | { promptTokens: number; completionTokens: number; totalTokens: number }
    | undefined;
  try {
    send({
      type: "response.created",
      response: { id: rid, object: "response", model, status: "in_progress" },
    });
    for await (const chunk of outcome.stream) {
      if (aborted) break;
      fullText += chunk.delta;
      if (chunk.usage) usage = chunk.usage;
      if (chunk.delta)
        send({
          type: "response.output_text.delta",
          item_id: "msg-0",
          output_index: 0,
          delta: chunk.delta,
        });
    }
    if (!aborted) {
      send({
        type: "response.completed",
        response: { id: rid, object: "response", model, status: "completed" },
      });
      raw.write("data: [DONE]\n\n");
    }
    outcome.finish({ fullText, usage, aborted });
  } catch (e) {
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

async function streamMessages(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: AppDeps,
  model: string,
  prep: Prepared,
): Promise<void> {
  let outcome;
  try {
    outcome = await deps.router.executeStream({
      requestId: req.id,
      resourceId: `llm:model:${parseModelString(model).logicalModel.toLowerCase()}`,
      capability: "llm.chat",
      hint: prep.hint,
      normalized: prep.normalized,
      requestedTokens: prep.estimated,
    });
  } catch (e) {
    return messagesError(reply, e) as unknown as Promise<void>;
  }
  reply.hijack();
  const raw = reply.raw;
  const mid = `msg-${outcome.requestId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Router-Via": `${outcome.route.providerId}/${outcome.route.upstreamId}`,
    "X-Router-Policy": outcome.policy,
    "X-Router-Attempts": String(outcome.attempts),
    "X-Router-Request-ID": outcome.requestId,
  });
  let aborted = false;
  req.raw.on("close", () => {
    aborted = true;
  });
  const event = (type: string, extra: unknown) => {
    if (!aborted)
      raw.write(`event: ${type}\ndata: ${JSON.stringify(extra)}\n\n`);
  };
  let fullText = "";
  let usage:
    | { promptTokens: number; completionTokens: number; totalTokens: number }
    | undefined;
  try {
    event("message_start", {
      type: "message_start",
      message: {
        id: mid,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    event("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    for await (const chunk of outcome.stream) {
      if (aborted) break;
      fullText += chunk.delta;
      if (chunk.usage) usage = chunk.usage;
      if (chunk.delta)
        event("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: chunk.delta },
        });
    }
    if (!aborted) {
      event("content_block_stop", { type: "content_block_stop", index: 0 });
      event("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: {
          output_tokens:
            usage?.completionTokens ?? Math.ceil(fullText.length / 4),
        },
      });
      event("message_stop", { type: "message_stop" });
    }
    outcome.finish({ fullText, usage, aborted });
  } catch (e) {
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
