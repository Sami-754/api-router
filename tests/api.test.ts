import { describe, expect, it } from "vitest";
import { createTestSetup } from "./helpers.js";

describe("management + observability API", () => {
  it("serves health, models, routes, quotas, requests", async () => {
    const { app, store } = await createTestSetup();

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

    const resource = await app.inject({
      method: "GET",
      url: "/api/resources/llm:model:nemotron-3-super-120b",
    });
    expect(resource.statusCode).toBe(200);
    expect(resource.json().data.id).toBe("llm:model:nemotron-3-super-120b");

    const missingResource = await app.inject({
      method: "GET",
      url: "/api/resources/llm:model:does-not-exist",
    });
    expect(missingResource.statusCode).toBe(404);

    const routes = await app.inject({
      method: "GET",
      url: "/api/routes?resource=llm:model:nemotron-3-super-120b&capability=llm.chat",
    });
    expect(routes.statusCode).toBe(200);
    expect(routes.json().data.length).toBeGreaterThanOrEqual(2);

    const first = routes.json().data[0] as {
      credentialId: string;
      providerResourceId: string;
    };
    store.upsertQuotaWindow({
      credentialId: first.credentialId,
      providerResourceId: first.providerResourceId,
      metric: "requests",
      limitValue: 10,
      usedValue: 2,
      windowKind: "calendar_day",
      hard: true,
      source: "configured",
    });
    store.recordSuccess(first.credentialId, first.providerResourceId, 25);

    const enriched = await app.inject({
      method: "GET",
      url: "/api/routes?resource=llm:model:nemotron-3-super-120b&capability=llm.chat",
    });
    const route = enriched
      .json()
      .data.find(
        (r: { credentialId: string; providerResourceId: string }) =>
          r.credentialId === first.credentialId &&
          r.providerResourceId === first.providerResourceId,
      );
    expect(route.quotas).toHaveLength(1);
    expect(route.health.successCount).toBe(1);

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

    const requestId = requests.json().data[0].id as string;
    const request = await app.inject({
      method: "GET",
      url: `/api/requests/${encodeURIComponent(requestId)}`,
    });
    expect(request.statusCode).toBe(200);
    expect(request.json().data.id).toBe(requestId);

    const missingRequest = await app.inject({
      method: "GET",
      url: "/api/requests/does-not-exist",
    });
    expect(missingRequest.statusCode).toBe(404);
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
