import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "../src/core/router.js";
import { defineToolAdapter } from "../src/adapters/tool-base.js";
import { CANONICAL, chatJson, createTestSetup } from "./helpers.js";
import { encryptSecret } from "../src/shared/crypto.js";
import { validateCredentialById } from "../src/server/validate.js";
import {
  refreshAutoFreeAlias,
  AUTO_FREE_RESOURCE_ID,
} from "../src/server/free-models.js";

const body = {
  model: "nemotron-3-super-120b",
  messages: [{ role: "user", content: "hi" }],
};
const request = {
  resourceId: CANONICAL,
  capability: "llm.chat" as const,
  normalized: {
    kind: "llm.chat" as const,
    body: { requestId: "test", messages: body.messages },
  },
};
const setups: Awaited<ReturnType<typeof createTestSetup>>[] = [];
async function setup(fetchImpl?: typeof fetch) {
  const s = await createTestSetup({ fetchImpl });
  setups.push(s);
  return s;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of setups.splice(0)) {
    await s.app.close();
    s.db.close();
  }
});

function stream(text = "ok") {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
  );
}

describe("routing audit regressions", () => {
  it("shares the deadline across multiple upstream calls inside a tool adapter", async () => {
    const s = await setup();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let calls = 0;
    s.registry.register(
      defineToolAdapter({
        providerId: "budget-tool",
        displayName: "Budget",
        defaultBaseUrl: "https://budget.test",
        auth: { kind: "bearer" },
        handlers: [
          {
            capability: "web.search",
            description: "Search",
            quotaMetric: "searches",
            probe: { path: "/probe", body: () => ({}) },
            async run(call) {
              await call.post("/first", {});
              await call.post("/second", {});
              return { kind: "web.search", body: { results: [] } };
            },
          },
        ],
      }),
    );
    s.store.upsertProvider({
      id: "budget-tool",
      displayName: "Budget",
      baseUrl: "https://budget.test",
      enabled: true,
      priority: 1,
    });
    s.store.upsertAccount({
      id: "budget-main",
      providerId: "budget-tool",
      enabled: true,
    });
    s.store.createCredential({
      id: "budget-key",
      accountId: "budget-main",
      secretEncrypted: encryptSecret("budget-secret"),
      status: "active",
    });
    s.store.upsertResource({
      id: "web.search",
      kind: "capability",
      displayName: "Search",
      capabilities: ["web.search"],
    });
    s.store.upsertProviderResource({
      resourceId: "web.search",
      providerId: "budget-tool",
      upstreamId: "search",
      capabilities: ["web.search"],
      enabled: true,
    });
    const router = new Router({
      store: s.store,
      registry: s.registry,
      timeoutMs: 100,
      fetchImpl: async () => {
        calls++;
        now += 150;
        return new Response("{}");
      },
    });
    await expect(
      router.execute({
        resourceId: "web.search",
        capability: "web.search",
        normalized: {
          kind: "web.search",
          body: { requestId: "budget", query: "hello", maxResults: 1 },
        },
      }),
    ).rejects.toMatchObject({ errorClass: "timeout" });
    expect(calls).toBe(1);
  });
  it.each([false, true])(
    "applies one total time budget across fallback attempts (stream=%s)",
    async (streaming) => {
      const s = await setup();
      let now = Date.now();
      vi.spyOn(Date, "now").mockImplementation(() => now);
      let calls = 0;
      const router = new Router({
        store: s.store,
        registry: s.registry,
        timeoutMs: 100,
        fetchImpl: async () => {
          calls++;
          now += 150;
          return new Response("overloaded", { status: 500 });
        },
      });
      await expect(
        streaming ? router.executeStream(request) : router.execute(request),
      ).rejects.toMatchObject({ errorClass: "timeout", attempts: 1 });
      expect(calls).toBe(1);
    },
  );

  it("rejects an account move that would send existing credentials to a different provider", async () => {
    const s = await setup();
    const res = await s.app.inject({
      method: "POST",
      url: "/api/accounts",
      payload: { id: "groq-main", providerId: "openrouter" },
    });
    expect(res.statusCode).toBe(409);
    expect(s.store.getAccount("groq-main")?.providerId).toBe("groq");
  });

  it.each([
    ["/api/providers/groq", { enabled: "false" }],
    ["/api/credentials/cred-groq-1", { status: "made-up" }],
  ])("validates management patches for %s", async (url, payload) => {
    const s = await setup();
    const res = await s.app.inject({
      method: "PATCH",
      url: url as string,
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(s.store.getProvider("groq")?.enabled).toBe(true);
    expect(s.store.getCredential("cred-groq-1")?.status).toBe("active");
  });

  it("redacts credentials echoed in upstream errors from API responses and request history", async () => {
    const s = await setup(async () => {
      throw new Error("network failure for groq-secret-1");
    });
    const res = await s.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { ...body, routing: { credential: "cred-groq-1" } },
    });
    expect(res.body).not.toContain("groq-secret-1");
    expect(JSON.stringify(s.store.listRequestLogs())).not.toContain(
      "groq-secret-1",
    );
  });

  it.each([false, true])(
    "honors the highest score within a provider (stream=%s)",
    async (streaming) => {
      const seen: string[] = [];
      const s = await setup(async (_url, init) => {
        seen.push(new Headers(init?.headers).get("Authorization")!);
        return streaming ? stream() : new Response(JSON.stringify(chatJson()));
      });
      s.store.createCredential({
        id: "cred-groq-2",
        accountId: "groq-main",
        secretEncrypted: encryptSecret("groq-secret-2"),
        status: "active",
      });
      for (const [id, used] of [
        ["cred-groq-1", 90],
        ["cred-groq-2", 0],
      ] as const) {
        s.store.upsertQuotaWindow({
          credentialId: id,
          metric: "requests",
          limitValue: 100,
          usedValue: used,
          windowKind: "calendar_month",
          resetAt: new Date(Date.now() + 86400000).toISOString(),
          hard: true,
          source: "configured",
        });
      }
      const res = await s.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          ...body,
          stream: streaming,
          routing: { provider: "groq", policy: "burn" },
        },
      });
      expect(res.statusCode).toBe(200);
      expect(seen).toEqual(["Bearer groq-secret-2"]);
    },
  );

  it.each([false, true])(
    "tries the pinned provider before cross-provider fallback (stream=%s)",
    async (streaming) => {
      const seen: string[] = [];
      const s = await setup(async (url) => {
        seen.push(String(url));
        return streaming ? stream() : new Response(JSON.stringify(chatJson()));
      });
      const res = await s.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          ...body,
          model: "openrouter::nemotron-3-super-120b",
          stream: streaming,
          routing: { policy: "priority", allowCrossProviderFallback: true },
        },
      });
      expect(res.statusCode).toBe(200);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toContain("openrouter");
    },
  );

  it.each([false, true])(
    "does not retry errors the adapter marks non-retryable (stream=%s)",
    async (streaming) => {
      let calls = 0;
      const s = await setup(async () => {
        calls++;
        return new Response("teapot", { status: 418 });
      });
      const res = await s.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { ...body, stream: streaming },
      });
      expect(res.statusCode).toBe(502);
      expect(calls).toBe(1);
    },
  );

  it("logs every failed non-stream attempt with its actual route", async () => {
    const s = await setup(async (url) =>
      String(url).includes("groq")
        ? new Response("busy", { status: 500 })
        : new Response(JSON.stringify(chatJson())),
    );
    const result = await s.router.execute({
      ...request,
      requestId: "audit-fallback",
      hint: { policy: "priority" },
    });
    expect(result.attempts).toBe(2);
    expect(s.store.getRequestLog("audit-fallback:attempt1")).toMatchObject({
      selectedProviderId: "groq",
      selectedCredentialId: "cred-groq-1",
      status: "error",
    });
    expect(s.store.getRequestLog("audit-fallback:attempt2")).toMatchObject({
      selectedProviderId: "openrouter",
      status: "success",
    });
  });

  it.each([false, true])(
    "rechecks key cooldown within an alias fallback queue (stream=%s)",
    async (streaming) => {
      const seen: string[] = [];
      const s = await setup(async (_url, init) => {
        seen.push(new Headers(init?.headers).get("Authorization")!);
        return new Response("rate limit", { status: 429 });
      });
      s.store.upsertProviderResource({
        resourceId: CANONICAL,
        providerId: "groq",
        upstreamId: "another-model",
        capabilities: ["llm.chat"],
        enabled: true,
      });
      const opts = { ...request, hint: { provider: "groq" } };
      await expect(
        streaming ? s.router.executeStream(opts) : s.router.execute(opts),
      ).rejects.toMatchObject({ statusCode: 429 });
      expect(seen).toHaveLength(1);
    },
  );

  it("rejects mappings whose registered adapter lacks the capability", async () => {
    const s = await setup();
    s.store.upsertResource({
      id: "web.search",
      kind: "capability",
      displayName: "Search",
      capabilities: ["web.search"],
    });
    s.store.upsertProviderResource({
      resourceId: "web.search",
      providerId: "groq",
      upstreamId: "search",
      capabilities: ["web.search"],
      enabled: true,
    });
    expect(
      s.router.candidates("web.search", "web.search").eligible,
    ).toHaveLength(0);
    expect(s.calls).toHaveLength(0);
  });

  it("uses live rate headroom for policy scoring after the window rolls", async () => {
    const s = await setup();
    s.store.upsertQuotaWindow({
      credentialId: "cred-groq-1",
      metric: "requests",
      limitValue: 10,
      usedValue: 10,
      windowKind: "calendar_minute",
      hard: true,
      source: "configured",
    });
    const ranked = s.router.candidates(CANONICAL, "llm.chat", {
      policy: "preserve",
    });
    expect(ranked.eligible[0].route.credentialId).toBe("cred-groq-1");
    expect(ranked.eligible[0].details.remainingFraction).toBe(1);
  });

  it("renews configured calendar quotas after their reset and accounts in the new window", async () => {
    const s = await setup();
    s.store.upsertQuotaWindow({
      credentialId: "cred-groq-1",
      metric: "requests",
      limitValue: 1,
      usedValue: 1,
      remainingValue: 0,
      windowKind: "calendar_month",
      resetAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      hard: true,
      source: "configured",
    });
    const first = await s.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { ...body, model: "groq::nemotron-3-super-120b" },
    });
    expect(first.statusCode).toBe(200);
    const quota = s.store.listQuotaWindows("cred-groq-1")[0];
    expect(Date.parse(quota.resetAt!)).toBeGreaterThan(Date.now());
    expect(quota.usedValue).toBe(1);
    expect(quota.remainingValue).toBe(0);
    const second = await s.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { ...body, model: "groq::nemotron-3-super-120b" },
    });
    expect(second.statusCode).toBe(429);
  });

  it("does not invent renewed provider credit or fixed expiry quotas", async () => {
    const s = await setup();
    for (const [windowKind, source] of [
      ["calendar_month", "provider_api"],
      ["fixed", "configured"],
    ] as const) {
      s.store.upsertQuotaWindow({
        credentialId: "cred-groq-1",
        metric: "requests",
        limitValue: 1,
        usedValue: 1,
        windowKind,
        resetAt: new Date(Date.now() - 86400000).toISOString(),
        hard: true,
        source,
      });
    }
    expect(
      s.router.candidates(CANONICAL, "llm.chat", { provider: "groq" }).eligible,
    ).toHaveLength(0);
  });

  it("does not let estimatedCost override context eligibility", async () => {
    const s = await setup();
    const r = s.store.getResource(CANONICAL)!;
    s.store.upsertResource({ ...r, contextTokens: 10 });
    const res = await s.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { ...body, max_tokens: 100, routing: { estimatedCost: 0 } },
    });
    expect(res.statusCode).not.toBe(200);
    expect(s.calls).toHaveLength(0);
  });

  it("alias routes share scoped quota and health with their source mapping", async () => {
    const s = await setup();
    s.store.upsertResource({
      id: "llm:model:model:free",
      kind: "llm_model",
      displayName: "Free",
      capabilities: ["llm.chat"],
    });
    const source = s.store.upsertProviderResource({
      resourceId: "llm:model:model:free",
      providerId: "groq",
      upstreamId: "model:free",
      capabilities: ["llm.chat"],
      enabled: true,
      contextTokens: 10,
    });
    refreshAutoFreeAlias(s.store);
    s.store.upsertQuotaWindow({
      credentialId: "cred-groq-1",
      providerResourceId: source.id,
      metric: "requests",
      limitValue: 1,
      usedValue: 1,
      windowKind: "fixed",
      hard: true,
      source: "configured",
    });
    expect(
      s.router.candidates(AUTO_FREE_RESOURCE_ID, "llm.chat").eligible,
    ).toHaveLength(0);
    s.store.deleteQuotaWindow(s.store.listQuotaWindows("cred-groq-1")[0].id);
    s.store.recordFailure("cred-groq-1", source.id, "provider_unavailable");
    expect(
      s.router.candidates(AUTO_FREE_RESOURCE_ID, "llm.chat").eligible,
    ).toHaveLength(0);
    s.store.clearCooldown("cred-groq-1", source.id);
    expect(
      s.router.candidates(AUTO_FREE_RESOURCE_ID, "llm.chat", undefined, 20)
        .eligible,
    ).toHaveLength(0);
    s.store.setProviderResourceEnabled(source.id, false);
    expect(
      s.router.candidates(AUTO_FREE_RESOURCE_ID, "llm.chat").eligible,
    ).toHaveLength(0);
  });

  it("alias refresh preserves source health and usage history", async () => {
    const s = await setup();
    s.store.upsertResource({
      id: "llm:model:model:free",
      kind: "llm_model",
      displayName: "Free",
      capabilities: ["llm.chat"],
    });
    const source = s.store.upsertProviderResource({
      resourceId: "llm:model:model:free",
      providerId: "groq",
      upstreamId: "model:free",
      capabilities: ["llm.chat"],
      enabled: true,
    });
    refreshAutoFreeAlias(s.store);
    await s.router.execute({ ...request, resourceId: AUTO_FREE_RESOURCE_ID });
    refreshAutoFreeAlias(s.store);
    expect(
      s.store.sumUsage("cred-groq-1", "requests", "2000-01-01T00:00:00.000Z"),
    ).toBe(1);
    expect(s.store.getHealth("cred-groq-1", source.id)?.successCount).toBe(1);
  });
});

describe("credential validation audit regressions", () => {
  it.each([429, 500, 404, 403])(
    "does not retire a key after inconclusive HTTP %s",
    async (status) => {
      const s = await setup(
        async () => new Response("temporarily unavailable", { status }),
      );
      await validateCredentialById(
        s.store,
        s.registry,
        "cred-groq-1",
        async () => new Response("temporarily unavailable", { status }),
      );
      expect(s.store.getCredential("cred-groq-1")?.status).toBe("active");
      expect(s.store.getCredential("cred-groq-1")?.lastValidatedAt).toBeNull();
    },
  );
  it("does not enable a disabled key just because a validation probe succeeded", async () => {
    const s = await setup();
    s.store.updateCredentialStatus("cred-groq-1", "disabled");
    await validateCredentialById(
      s.store,
      s.registry,
      "cred-groq-1",
      async () => new Response("{}"),
    );
    expect(s.store.getCredential("cred-groq-1")?.status).toBe("disabled");
  });
});

describe("stream adapter audit regressions", () => {
  it.each([false, true])(
    "keeps the timeout active while reading the response body (stream=%s)",
    async (streaming) => {
      const s = await setup();
      const router = new Router({
        store: s.store,
        registry: s.registry,
        timeoutMs: 30,
        fetchImpl: async (_url, init) => {
          return new Response(
            new ReadableStream({
              start(controller) {
                init?.signal?.addEventListener(
                  "abort",
                  () => controller.error(init.signal?.reason),
                  { once: true },
                );
              },
            }),
          );
        },
      });
      const keepAlive = setTimeout(() => {}, 200);
      try {
        await expect(
          streaming
            ? router.executeStream({
                ...request,
                hint: { credential: "cred-groq-1" },
              })
            : router.execute({
                ...request,
                hint: { credential: "cred-groq-1" },
              }),
        ).rejects.toMatchObject({ errorClass: "timeout" });
      } finally {
        clearTimeout(keepAlive);
      }
    },
  );

  it("falls back when an upstream closes before producing any chunks", async () => {
    const seen: string[] = [];
    const s = await setup(async (url) => {
      seen.push(String(url));
      return String(url).includes("groq")
        ? new Response("data: [DONE]\n\n")
        : stream();
    });
    const res = await s.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { ...body, stream: true, routing: { policy: "priority" } },
    });
    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(2);
  });

  it("does not accept a malformed 200 response as a successful completion", async () => {
    const s = await setup(async (url) =>
      String(url).includes("groq")
        ? new Response(JSON.stringify({ error: "not a completion" }))
        : new Response(JSON.stringify(chatJson())),
    );
    const res = await s.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { ...body, routing: { policy: "priority" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-router-via"]).toContain("openrouter");
    expect(res.json().choices).toHaveLength(1);
  });

  it("reads error bodies so streamed 403 quota errors do not become auth failures", async () => {
    const s = await setup(
      async () =>
        new Response(
          JSON.stringify({ error: { message: "credits exhausted" } }),
          { status: 403 },
        ),
    );
    const res = await s.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { ...body, model: "groq::nemotron-3-super-120b", stream: true },
    });
    expect(res.statusCode).toBe(429);
    expect(s.store.listRequestLogs(5)[0].errorClass).toBe("quota_exhausted");
  });

  it("records truncated streams as failures instead of synthesizing success", async () => {
    const s = await setup(
      async () =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`,
        ),
    );
    const res = await s.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { ...body, model: "groq::nemotron-3-super-120b", stream: true },
    });
    expect(res.body).toContain("partial");
    expect(res.body).not.toContain("[DONE]");
    expect(s.store.listRequestLogs(5)[0].status).toBe("error");
  });
});
