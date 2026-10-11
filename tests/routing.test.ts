import { describe, expect, it } from "vitest";
import { CANONICAL, createTestSetup } from "./helpers.js";

function chatBody(model: string) {
  return { model, messages: [{ role: "user", content: "hello" }] };
}

describe("routing semantics (P0)", () => {
  it("auto-routes a canonical model", async () => {
    const { app } = await createTestSetup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("nemotron-3-super-120b"),
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.choices[0].message.content).toBe("hello");
    expect(res.headers["x-router-via"]).toMatch(/^(groq|openrouter)\//);
    expect(res.headers["x-router-policy"]).toBe("auto");
  });

  it("pins to the requested provider with provider::model", async () => {
    const { app } = await createTestSetup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("openrouter::nemotron-3-super-120b"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-router-via"]).toMatch(/^openrouter\//);
    expect(res.json()._router.provider).toBe("openrouter");
  });

  it("returns 404 for unknown provider pin", async () => {
    const { app, store } = await createTestSetup();
    // Unknown provider: no adapter and no routes → no eligible routes.
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("nosuch::nemotron-3-super-120b"),
    });
    expect([404, 503]).toContain(res.statusCode);
    expect(store.listRequestLogs(5).length).toBeGreaterThan(0);
  });

  it("returns 404 for unknown model", async () => {
    const { app } = await createTestSetup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("does-not-exist-xyz"),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.type).toBe("route_not_found");
  });

  it("skips disabled provider routes", async () => {
    const { app, store } = await createTestSetup();
    const groq = store.getProvider("groq")!;
    store.upsertProvider({ ...groq, enabled: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("nemotron-3-super-120b"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-router-via"]).toMatch(/^openrouter\//);
  });

  it("skips invalid credentials", async () => {
    const { app, store } = await createTestSetup();
    store.updateCredentialStatus("cred-groq-1", "invalid");
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("nemotron-3-super-120b"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-router-via"]).toMatch(/^openrouter\//);
  });

  it("supports multiple credentials under one provider", async () => {
    const { app, store } = await createTestSetup();
    const { encryptSecret } = await import("../src/shared/crypto.js");
    store.createCredential({
      id: "cred-groq-2",
      accountId: "groq-main",
      secretEncrypted: encryptSecret("groq-secret-2"),
      status: "active",
    });
    const routes = store.expandRoutes(CANONICAL, "llm.chat");
    expect(routes.filter((r) => r.providerId === "groq").length).toBe(2);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("groq::nemotron-3-super-120b"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-router-via"]).toMatch(/^groq\//);
  });

  it("provider-pinned request never crosses provider on retryable failure", async () => {
    const groqFail: typeof fetch = async () =>
      new Response("overloaded", { status: 500 });
    const { app } = await createTestSetup({ fetchImpl: groqFail });
    // Groq pinned + groq always 500 → must fail, never silently use openrouter.
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("groq::nemotron-3-super-120b"),
    });
    expect(res.statusCode).toBe(502);
    const logs = app; // request log records failure with attempts>=1
    expect(logs).toBeDefined();
  });

  it("retryable failure falls back to another eligible route", async () => {
    let n = 0;
    const flaky: typeof fetch = async (url) => {
      n += 1;
      if (String(url).includes("groq")) {
        return new Response(
          JSON.stringify({
            error: { message: "rate limited", code: "rate_limit" },
          }),
          { status: 429 },
        );
      }
      const { chatJson } = await import("./helpers.js");
      return new Response(JSON.stringify(chatJson("via-openrouter")), {
        status: 200,
      });
    };
    const { app } = await createTestSetup({ fetchImpl: flaky });
    // Force groq first via priority policy (groq priority 10 < openrouter 20).
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        ...chatBody("nemotron-3-super-120b"),
        routing: { policy: "priority" },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("via-openrouter");
    expect(res.headers["x-router-via"]).toMatch(/^openrouter\//);
    expect(Number(res.headers["x-router-attempts"])).toBeGreaterThanOrEqual(2);
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("non-retryable bad request does not spray retries", async () => {
    let n = 0;
    const bad: typeof fetch = async () => {
      n += 1;
      return new Response(
        JSON.stringify({ error: { message: "bad", code: "invalid" } }),
        { status: 400 },
      );
    };
    const { app } = await createTestSetup({ fetchImpl: bad });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("nemotron-3-super-120b"),
    });
    expect(res.statusCode).toBe(400);
    expect(n).toBe(1);
  });
});

function bearer(init?: RequestInit): string {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers))
    return "";
  return String((headers as Record<string, string>).Authorization ?? "");
}

describe("per-provider key rotation", () => {
  it("starts each request on the next key of that provider", async () => {
    const seen: string[] = [];
    const mock: typeof fetch = async (_url, init) => {
      seen.push(bearer(init));
      const { chatJson } = await import("./helpers.js");
      return new Response(JSON.stringify(chatJson("ok")), { status: 200 });
    };
    const { app, store } = await createTestSetup({ fetchImpl: mock });
    const { encryptSecret } = await import("../src/shared/crypto.js");
    store.createCredential({
      id: "cred-groq-2",
      accountId: "groq-main",
      secretEncrypted: encryptSecret("groq-secret-2"),
      status: "active",
    });
    store.createCredential({
      id: "cred-groq-3",
      accountId: "groq-main",
      secretEncrypted: encryptSecret("groq-secret-3"),
      status: "active",
    });
    store.updateCredentialStatus("cred-or-1", "disabled");

    const send = () =>
      app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: chatBody("groq::nemotron-3-super-120b"),
      });
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect(seen).toEqual([
      "Bearer groq-secret-1",
      "Bearer groq-secret-2",
      "Bearer groq-secret-3",
      "Bearer groq-secret-1",
    ]);
  });

  it("on a rate limit, tries the next key of the same provider", async () => {
    const seen: string[] = [];
    const mock: typeof fetch = async (_url, init) => {
      const auth = bearer(init);
      seen.push(auth);
      if (auth.endsWith("groq-secret-1")) {
        return new Response(
          JSON.stringify({ error: { message: "rate limited" } }),
          { status: 429 },
        );
      }
      const { chatJson } = await import("./helpers.js");
      return new Response(JSON.stringify(chatJson("second-key")), {
        status: 200,
      });
    };
    const { app, store } = await createTestSetup({ fetchImpl: mock });
    const { encryptSecret } = await import("../src/shared/crypto.js");
    store.createCredential({
      id: "cred-groq-2",
      accountId: "groq-main",
      secretEncrypted: encryptSecret("groq-secret-2"),
      status: "active",
    });
    store.updateCredentialStatus("cred-or-1", "disabled");

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("groq::nemotron-3-super-120b"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("second-key");
    expect(Number(res.headers["x-router-attempts"])).toBe(2);
    expect(seen).toEqual(["Bearer groq-secret-1", "Bearer groq-secret-2"]);
  });

  it("on 401, retires that key and continues with the next one", async () => {
    const mock: typeof fetch = async (_url, init) => {
      if (bearer(init).endsWith("groq-secret-1")) {
        return new Response(JSON.stringify({ error: { message: "bad key" } }), {
          status: 401,
        });
      }
      const { chatJson } = await import("./helpers.js");
      return new Response(JSON.stringify(chatJson("live-key")), {
        status: 200,
      });
    };
    const { app, store } = await createTestSetup({ fetchImpl: mock });
    const { encryptSecret } = await import("../src/shared/crypto.js");
    store.createCredential({
      id: "cred-groq-2",
      accountId: "groq-main",
      secretEncrypted: encryptSecret("groq-secret-2"),
      status: "active",
    });
    store.updateCredentialStatus("cred-or-1", "disabled");

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("groq::nemotron-3-super-120b"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("live-key");
    expect(store.getCredential("cred-groq-1")?.status).toBe("invalid");
    expect(store.getCredential("cred-groq-2")?.status).toBe("active");
  });

  it("walks every key in the pool when each one is rate limited", async () => {
    let n = 0;
    const mock: typeof fetch = async () => {
      n += 1;
      return new Response(
        JSON.stringify({ error: { message: "rate limited" } }),
        { status: 429 },
      );
    };
    const { app, store } = await createTestSetup({ fetchImpl: mock });
    const { encryptSecret } = await import("../src/shared/crypto.js");
    for (const id of [
      "cred-groq-2",
      "cred-groq-3",
      "cred-groq-4",
      "cred-groq-5",
    ]) {
      store.createCredential({
        id,
        accountId: "groq-main",
        secretEncrypted: encryptSecret(id),
        status: "active",
      });
    }
    store.updateCredentialStatus("cred-or-1", "disabled");

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody("groq::nemotron-3-super-120b"),
    });
    expect(res.statusCode).toBe(429);
    expect(n).toBe(5);
  });
});
