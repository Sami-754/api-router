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
  StreamChunk,
} from "../provider-sdk/types.js";

// Generic OpenAI-compatible chat adapter. One adapter class serves Groq,
// OpenRouter, and any other OpenAI-compatible endpoint — each provider id
// gets its own registered instance with its own default base URL.
// Provider-specific quirks (headers, model lists) stay here, never in core.

export interface OpenAICompatOptions {
  providerId: string;
  displayName: string;
  defaultBaseUrl: string;
  /** Extra headers always sent (e.g. OpenRouter's HTTP-Referer). */
  extraHeaders?: Record<string, string>;
  modelsPath?: string;
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  private defaultBaseUrl: string;
  private extraHeaders: Record<string, string>;
  private modelsPath: string;

  constructor(opts: OpenAICompatOptions) {
    this.id = opts.providerId.toLowerCase();
    this.displayName = opts.displayName;
    this.defaultBaseUrl = opts.defaultBaseUrl.replace(/\/$/, "");
    this.extraHeaders = opts.extraHeaders ?? {};
    this.modelsPath = opts.modelsPath ?? "/models";
  }

  capabilities() {
    return [
      { capability: "llm.chat" as const, description: "OpenAI-compatible chat completions" },
      { capability: "llm.tools" as const, description: "Tool calling via chat completions" },
    ];
  }

  baseUrlFor(route: ResolvedRoute, ctx: AdapterContext): string {
    const raw = ctx.baseUrl?.trim() || route.effectiveBaseUrl?.trim() || this.defaultBaseUrl;
    return raw.replace(/\/$/, "");
  }

  async validateCredential(
    credential: { secret: string },
    context: AdapterContext,
  ): Promise<CredentialValidationResult> {
    const base = (context.baseUrl?.trim() || this.defaultBaseUrl).replace(/\/$/, "");
    try {
      const res = await fetchWithTimeout(
        `${base}${this.modelsPath}`,
        {
          headers: {
            Authorization: `Bearer ${credential.secret}`,
            ...this.extraHeaders,
          },
        },
        context,
      );
      if (res.ok) return { ok: true, message: "credential valid" };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "credential rejected (401/403)" };
      }
      // Any other reachable response means auth shape was accepted enough
      // to validate connectivity; treat non-401 as inconclusive-but-ok.
      return { ok: res.status !== 401 && res.status !== 403, message: `upstream HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async execute(
    request: NormalizedRequest,
    route: ResolvedRoute,
    context: AdapterContext,
  ): Promise<NormalizedResponse> {    if (request.kind !== "llm.chat") {
      throw Object.assign(new Error(`unsupported capability for ${this.id}: ${request.kind}`), {
        providerError: { errorClass: "unsupported", retryable: false },
      });
    }
    const base = this.baseUrlFor(route, context);
    const url = `${base}/chat/completions`;
    const body = request.body;
    const upstreamBody: Record<string, unknown> = {
      model: route.upstreamId,
      messages: body.messages,
    };
    if (body.temperature !== undefined) upstreamBody.temperature = body.temperature;
    if (body.topP !== undefined) upstreamBody.top_p = body.topP;
    if (body.maxTokens !== undefined) upstreamBody.max_tokens = body.maxTokens;
    if (body.stop !== undefined) upstreamBody.stop = body.stop;
    if (body.tools !== undefined) upstreamBody.tools = body.tools;
    if (body.toolChoice !== undefined) upstreamBody.tool_choice = body.toolChoice;
    if (body.user !== undefined) upstreamBody.user = body.user;
    // Never request streaming on the non-streaming path.
    upstreamBody.stream = false;

    let res: Response;
    try {
      res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${route.credentialSecret}`,
            ...this.extraHeaders,
          },
          body: JSON.stringify(upstreamBody),
        },
        context,
      );
    } catch (e) {
      if (isAbort(e)) throw Object.assign(new Error(`upstream timeout after ${context.timeoutMs}ms`), { providerError: timeoutError("timeout") });
      throw Object.assign(new Error(`upstream network error: ${e instanceof Error ? e.message : String(e)}`), {
        providerError: networkError(String(e)),
      });
    }

    const text = await res.text();
    if (!res.ok) {
      const classified = classifyHttpStatus(res.status, text, extractProviderCode(text));
      throw Object.assign(new Error(classified.message), { providerError: classified });
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw Object.assign(new Error("invalid JSON from upstream"), {
        providerError: { errorClass: "provider_unavailable", message: "invalid JSON", retryable: true },
      });
    }
    return { kind: "llm.chat", body: normalizeChatResponse(json, route.upstreamId) };
  }

  async *executeStream(
    request: NormalizedRequest,
    route: ResolvedRoute,
    context: AdapterContext,
  ): AsyncIterable<StreamChunk> {
    if (request.kind !== "llm.chat") {
      throw Object.assign(new Error(`streaming unsupported for ${this.id}: ${request.kind}`), {
        providerError: { errorClass: "unsupported", retryable: false },
      });
    }
    const base = this.baseUrlFor(route, context);
    const body = request.body;
    const upstreamBody: Record<string, unknown> = {
      model: route.upstreamId,
      messages: body.messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (body.temperature !== undefined) upstreamBody.temperature = body.temperature;
    if (body.topP !== undefined) upstreamBody.top_p = body.topP;
    if (body.maxTokens !== undefined) upstreamBody.max_tokens = body.maxTokens;
    if (body.stop !== undefined) upstreamBody.stop = body.stop;
    if (body.tools !== undefined) upstreamBody.tools = body.tools;
    if (body.toolChoice !== undefined) upstreamBody.tool_choice = body.toolChoice;
    if (body.user !== undefined) upstreamBody.user = body.user;

    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${base}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${route.credentialSecret}`,
            ...this.extraHeaders,
          },
          body: JSON.stringify(upstreamBody),
        },
        context,
      );
    } catch (e) {
      if (isAbort(e)) throw Object.assign(new Error(`upstream timeout`), { providerError: timeoutError("timeout") });
      throw Object.assign(new Error(`upstream network error`), {
        providerError: networkError(String(e)),
      });
    }
    if (!res.ok || !res.body) {
      const text = res.body ? "" : await res.text().catch(() => "");
      const classified = classifyHttpStatus(res.status, text, extractProviderCode(text));
      throw Object.assign(new Error(classified.message), { providerError: classified });
    }
    yield* parseSseChat(res.body);
  }

  classifyError(error: unknown): ProviderError {
    if (typeof error === "object" && error !== null && "providerError" in error) {
      return (error as { providerError: ProviderError }).providerError;
    }
    if (error instanceof Error) {
      if (/timeout|aborted|abort/i.test(error.message)) return timeoutError(error.message);
      if (/fetch failed|network|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(error.message)) {
        return networkError(error.message);
      }
    }
    return { errorClass: "unknown", message: error instanceof Error ? error.message : String(error), retryable: false };
  }
}

function normalizeChatResponse(json: Record<string, unknown>, fallbackModel: string) {
  const choicesRaw = (json.choices as Array<Record<string, unknown>> | undefined) ?? [];
  const choices = choicesRaw.map((c, i) => {
    const msg = (c.message as Record<string, unknown> | undefined) ?? {};
    const content = typeof msg.content === "string" ? msg.content : (msg.content ?? "");
    return {
      index: typeof c.index === "number" ? c.index : i,
      message: { role: typeof msg.role === "string" ? msg.role : "assistant", content: String(content ?? "") },
      finishReason: typeof c.finish_reason === "string" ? c.finish_reason : null,
    };
  });
  const usageRaw = json.usage as Record<string, number> | undefined;
  const usage =
    usageRaw && typeof usageRaw.prompt_tokens === "number"
      ? {
          promptTokens: usageRaw.prompt_tokens,
          completionTokens: usageRaw.completion_tokens ?? 0,
          totalTokens: usageRaw.total_tokens ?? (usageRaw.prompt_tokens ?? 0) + (usageRaw.completion_tokens ?? 0),
        }
      : undefined;
  return {
    model: typeof json.model === "string" ? json.model : fallbackModel,
    choices,
    usage,
    raw: undefined,
  };
}

function extractProviderCode(text: string): string | undefined {
  try {
    const j = JSON.parse(text) as { error?: { code?: string; type?: string } };
    return j?.error?.code ?? j?.error?.type ?? undefined;
  } catch {
    return undefined;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  context: AdapterContext,
): Promise<Response> {
  const fetchImpl = context.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), context.timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Parse an OpenAI-style SSE chat stream into content deltas. */
async function* parseSseChat(body: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") return;
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue;
        }
        const choice = (json.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = choice?.delta as Record<string, unknown> | undefined;
        const content = typeof delta?.content === "string" ? delta.content : "";
        const finish = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
        const u = json.usage as Record<string, number> | undefined;
        const usage =
          u && typeof u.prompt_tokens === "number"
            ? {
                promptTokens: u.prompt_tokens,
                completionTokens: u.completion_tokens ?? 0,
                totalTokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
              }
            : undefined;
        if (content || finish || usage) yield { delta: content, finishReason: finish, usage };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message));
}
