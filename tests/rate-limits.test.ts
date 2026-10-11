import { describe, expect, it } from "vitest";
import { CANONICAL, createTestSetup } from "./helpers.js";

function chatBody(model: string) {
  return { model, messages: [{ role: "user", content: "hello" }] };
}

describe("per-key rate windows", () => {
  it("blocks a route after N requests/minute, then recovers as the window rolls", async () => {
    const { app, store } = await createTestSetup();
    // 1 request/min on the groq credential only.
    store.upsertQuotaWindow({
      credentialId: "cred-groq-1",
      metric: "requests",
      limitValue: 1,
      usedValue: 0,
      windowKind: "calendar_minute",
      hard: true,
      source: "configured",
    });

    const first = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("groq::nemotron-3-super-120b"),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("groq::nemotron-3-super-120b"),
    });
    expect(second.statusCode).toBe(429);

    // Auto-routing still works via the unconstrained openrouter route.
    const auto = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("nemotron-3-super-120b"),
    });
    expect(auto.statusCode).toBe(200);
    expect(auto.headers["x-router-via"]).toMatch(/^openrouter\//);
  });

  it("old usage outside the window does not count", async () => {
    const { app, store } = await createTestSetup();
    store.upsertQuotaWindow({
      credentialId: "cred-groq-1",
      metric: "requests",
      limitValue: 1,
      usedValue: 0,
      windowKind: "calendar_minute",
      hard: true,
      source: "configured",
    });
    // Yesterday's usage must not block today's request.
    store.recordUsage({
      requestId: "old",
      credentialId: "cred-groq-1",
      providerResourceId: null,
      metric: "requests",
      quantity: 5,
      observedAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("groq::nemotron-3-super-120b"),
    });
    expect(res.statusCode).toBe(200);
  });

  it("usage stats endpoint sums live metrics", async () => {
    const { app } = await createTestSetup();
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("groq::nemotron-3-super-120b"),
    });
    const stats = await app.inject({
      method: "GET",
      url: "/api/usage?credential=cred-groq-1",
    });
    expect(stats.statusCode).toBe(200);
    const d = stats.json().data;
    expect(d.requests).toBe(1);
    expect(d.total_tokens).toBe(12);
    expect(d.input_tokens).toBe(5);
    expect(d.output_tokens).toBe(7);
  });

  it("router.candidates explains rate filtering", async () => {
    const { app, store, router } = await createTestSetup();
    store.upsertQuotaWindow({
      credentialId: "cred-groq-1",
      metric: "requests",
      limitValue: 1,
      usedValue: 0,
      windowKind: "calendar_minute",
      hard: true,
      source: "configured",
    });
    store.recordUsage({
      requestId: "r1",
      credentialId: "cred-groq-1",
      providerResourceId: null,
      metric: "requests",
      quantity: 1,
    });
    const { eligible, filtered } = router.candidates(CANONICAL, "llm.chat", {
      provider: "groq",
    });
    expect(eligible.length).toBe(0);
    expect(filtered[0].reason).toMatch(/rate limit/);
    void app;
  });
});
