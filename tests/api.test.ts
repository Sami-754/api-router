import { describe, expect, it } from "vitest";
import { createTestSetup } from "./helpers.js";

describe("management + observability API", () => {
  it("serves health, models, routes, quotas, requests", async () => {
    const { app } = await createTestSetup();

    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(true);

    const models = await app.inject({ method: "GET", url: "/v1/models" });
    expect(models.statusCode).toBe(200);
    expect(models.json().data.map((m: { id: string }) => m.id)).toContain(
      "nemotron-3-super-120b",
    );

    const providers = await app.inject({
      method: "GET",
      url: "/api/providers",
    });
    expect(providers.json().data.length).toBeGreaterThanOrEqual(2);

    const routes = await app.inject({
      method: "GET",
      url: "/api/routes?resource=llm:model:nemotron-3-super-120b&capability=llm.chat",
    });
    expect(routes.statusCode).toBe(200);
    expect(routes.json().data.length).toBeGreaterThanOrEqual(2);

    const quotas = await app.inject({ method: "GET", url: "/api/quotas" });
    expect(quotas.statusCode).toBe(200);

    const chat = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "nemotron-3-super-120b",
        messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.json().usage.total_tokens).toBe(12);

    const requests = await app.inject({
      method: "GET",
      url: "/api/requests?limit=10",
    });
    expect(requests.json().data.length).toBeGreaterThan(0);
  });

  it("cooldown excludes a failed route until cleared", async () => {
    const failing: typeof fetch = async () =>
      new Response("boom", { status: 500 });
    const { app, store } = await createTestSetup({ fetchImpl: failing });
    // One failing request walks both routes and cools each of them down.
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "nemotron-3-super-120b",
        messages: [{ role: "user", content: "hi" }],
      },
    });
    const sim = await app.inject({
      method: "POST",
      url: "/api/routing/simulate",
      payload: {
        resource: "llm:model:nemotron-3-super-120b",
        capability: "llm.chat",
        policy: "auto",
      },
    });
    const data = sim.json().data;
    // Both default routes should now be cooling down.
    expect(data.filtered.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(data.filtered)).toContain("cooldown");
    void store;
  });
});
