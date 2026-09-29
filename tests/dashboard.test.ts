import { describe, expect, it } from "vitest";
import { createTestSetup } from "./helpers.js";

describe("dashboard management APIs", () => {
  it("overview aggregates counts", async () => {
    const { app } = await createTestSetup();
    const res = await app.inject({ method: "GET", url: "/api/overview" });
    expect(res.statusCode).toBe(200);
    const o = res.json().data;
    expect(o.providers).toBeGreaterThanOrEqual(2);
    expect(o.credentials).toBeGreaterThanOrEqual(2);
    expect(o.mappings).toBeGreaterThanOrEqual(2);
  });

  it("settings get + patch runtime default policy", async () => {
    const { app } = await createTestSetup();
    const get = await app.inject({ method: "GET", url: "/api/settings" });
    expect(get.json().data.defaultPolicy).toBe("auto");
    const patch = await app.inject({
      method: "PATCH", url: "/api/settings", payload: { defaultPolicy: "burn" },
    });
    expect(patch.json().data.defaultPolicy).toBe("burn");
    const bad = await app.inject({
      method: "PATCH", url: "/api/settings", payload: { defaultPolicy: "nope" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("credential validate probes upstream and marks status", async () => {
    const { app, store } = await createTestSetup();
    const res = await app.inject({ method: "POST", url: "/api/credentials/cred-groq-1/validate" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.ok).toBe(true);
    expect(store.getCredential("cred-groq-1")?.status).toBe("active");
  });

  it("quota create + delete round-trips", async () => {
    const { app } = await createTestSetup();
    const created = await app.inject({
      method: "POST", url: "/api/quotas",
      payload: { credentialId: "cred-groq-1", metric: "requests", limitValue: 10, windowKind: "calendar_day", resetAt: new Date(Date.now() + 86400000).toISOString() },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    const del = await app.inject({ method: "DELETE", url: `/api/quotas/${id}` });
    expect(del.statusCode).toBe(200);
  });

  it("mapping disable + delete", async () => {
    const { app, store } = await createTestSetup();
    const before = store.listProviderResources("llm:model:nemotron-3-super-120b");
    expect(before.length).toBeGreaterThanOrEqual(2);
    const target = before[0];
    const patch = await app.inject({
      method: "PATCH", url: `/api/provider-resources/${encodeURIComponent(target.id)}`, payload: { enabled: false },
    });
    expect(patch.json().data.enabled).toBe(false);
    // disabled mapping excludes its routes
    const chat = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      payload: { model: "nemotron-3-super-120b", messages: [{ role: "user", content: "hi" }] },
    });
    expect(chat.statusCode).toBe(200);
    const del = await app.inject({ method: "DELETE", url: `/api/provider-resources/${encodeURIComponent(target.id)}` });
    expect(del.statusCode).toBe(200);
    expect(store.getProviderResource(target.id)).toBeUndefined();
  });

  it("account and provider deletes cascade", async () => {
    const { app, store } = await createTestSetup();
    const delAcc = await app.inject({ method: "DELETE", url: "/api/accounts/groq-main" });
    expect(delAcc.statusCode).toBe(200);
    expect(store.getCredential("cred-groq-1")).toBeUndefined();
    const delProv = await app.inject({ method: "DELETE", url: "/api/providers/openrouter" });
    expect(delProv.statusCode).toBe(200);
    expect(store.getProvider("openrouter")).toBeUndefined();
  });
});
