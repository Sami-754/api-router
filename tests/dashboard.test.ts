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
      method: "PATCH",
      url: "/api/settings",
      payload: { defaultPolicy: "burn" },
    });
    expect(patch.json().data.defaultPolicy).toBe("burn");
    const bad = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      payload: { defaultPolicy: "nope" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("credential validate probes upstream and marks status", async () => {
    const { app, store } = await createTestSetup();
    const res = await app.inject({
      method: "POST",
      url: "/api/credentials/cred-groq-1/validate",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.ok).toBe(true);
    expect(store.getCredential("cred-groq-1")?.status).toBe("active");
  });

  it("quota create + delete round-trips", async () => {
    const { app } = await createTestSetup();
    const created = await app.inject({
      method: "POST",
      url: "/api/quotas",
      payload: {
        credentialId: "cred-groq-1",
        metric: "requests",
        limitValue: 10,
        windowKind: "calendar_day",
        resetAt: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/quotas/${id}`,
    });
    expect(del.statusCode).toBe(200);
  });

  it("mapping disable + delete", async () => {
    const { app, store } = await createTestSetup();
    const before = store.listProviderResources(
      "llm:model:nemotron-3-super-120b",
    );
    expect(before.length).toBeGreaterThanOrEqual(2);
    const target = before[0];
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/provider-resources/${encodeURIComponent(target.id)}`,
      payload: { enabled: false },
    });
    expect(patch.json().data.enabled).toBe(false);
    // disabled mapping excludes its routes
    const chat = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "nemotron-3-super-120b",
        messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(chat.statusCode).toBe(200);
    const del = await app.inject({
      method: "DELETE",
      url: `/api/provider-resources/${encodeURIComponent(target.id)}`,
    });
    expect(del.statusCode).toBe(200);
    expect(store.getProviderResource(target.id)).toBeUndefined();
  });

  it("account and provider deletes cascade", async () => {
    const { app, store } = await createTestSetup();
    const delAcc = await app.inject({
      method: "DELETE",
      url: "/api/accounts/groq-main",
    });
    expect(delAcc.statusCode).toBe(200);
    expect(store.getCredential("cred-groq-1")).toBeUndefined();
    const delProv = await app.inject({
      method: "DELETE",
      url: "/api/providers/openrouter",
    });
    expect(delProv.statusCode).toBe(200);
    expect(store.getProvider("openrouter")).toBeUndefined();
  });

  it("lists registered and installable adapters with capabilities", async () => {
    const { app } = await createTestSetup();
    const res = await app.inject({ method: "GET", url: "/api/adapters" });
    expect(res.statusCode).toBe(200);
    const adapters = res.json().data as Array<{
      id: string;
      displayName: string;
      kind: string;
      capabilities: string[];
    }>;
    expect(adapters.map((adapter) => adapter.id).sort()).toEqual([
      "exa",
      "firecrawl",
      "groq",
      "openrouter",
      "tavily",
    ]);
    const groq = adapters.find((adapter) => adapter.id === "groq");
    expect(groq?.capabilities).toContain("llm.chat");
    expect(groq?.kind).toBe("llm");
    const tavily = adapters.find((adapter) => adapter.id === "tavily");
    expect(tavily?.kind).toBe("tool");
    expect(tavily?.capabilities).toContain("web.search");
  });

  it("provisions a tool provider, account, key and routes", async () => {
    const { app, store, registry } = await createTestSetup();
    const res = await app.inject({
      method: "POST",
      url: "/api/keys",
      payload: { providerId: "tavily", secret: "tvly-test-key", label: "main" },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data as {
      provider: { id: string; created: boolean };
      account: { id: string; created: boolean };
      credential: {
        id: string;
        accountId: string;
        providerId: string;
        label: string;
        status: string;
        redacted: string;
        secret?: string;
      };
      adapterRegistered: boolean;
      toolRoutes: string[];
    };
    expect(data.provider).toMatchObject({ id: "tavily", created: true });
    expect(data.account).toMatchObject({ id: "tavily-main", created: true });
    expect(data.credential).toMatchObject({
      accountId: "tavily-main",
      providerId: "tavily",
      label: "main",
      status: "active",
    });
    expect(data.credential.redacted).toBeTruthy();
    expect(data.credential.secret).toBeUndefined();
    expect(data.adapterRegistered).toBe(true);
    expect(data.toolRoutes).toHaveLength(5);
    expect(data.toolRoutes).toContain("web.search");
    expect(store.getProvider("tavily")?.baseUrl).toBe("https://api.tavily.com");
    expect(registry.get("tavily")).toBeDefined();
    expect(store.listCredentials("tavily-main")).toHaveLength(1);
    expect(store.listProviderResources("web.search", "tavily")).toHaveLength(1);
    expect(
      store.expandRoutes("web.search").some((r) => r.providerId === "tavily"),
    ).toBe(true);

    const second = await app.inject({
      method: "POST",
      url: "/api/keys",
      payload: {
        providerId: "tavily",
        secret: "tvly-test-key-2",
        label: "backup",
      },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.provider.created).toBe(false);
    expect(second.json().data.account.created).toBe(false);
    expect(store.listCredentials("tavily-main")).toHaveLength(2);
    expect(store.listProviderResources("web.search", "tavily")).toHaveLength(1);

    const unknown = await app.inject({
      method: "POST",
      url: "/api/keys",
      payload: { providerId: "nope", secret: "x" },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("sync maintenance pulls live catalogs and reports auto:free rows", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [{ id: "test-model" }, { id: "test-model:free" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;
    const { app } = await createTestSetup({ fetchImpl });
    const res = await app.inject({
      method: "POST",
      url: "/api/maintenance/sync",
    });
    expect(res.statusCode).toBe(200);
    const summary = res.json().data as {
      mapped: number;
      pruned: number;
      skipped: string[];
      autoFreeMappings: number;
    };
    expect(summary.skipped).toEqual([]);
    expect(summary.mapped).toBe(4);
    expect(summary.autoFreeMappings).toBe(2);
  });

  it("credential label patches round-trip and validate", async () => {
    const { app, store } = await createTestSetup();
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/credentials/cred-groq-1",
      payload: { label: "renamed key" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.label).toBe("renamed key");
    expect(store.getCredential("cred-groq-1")?.label).toBe("renamed key");

    const bad = await app.inject({
      method: "PATCH",
      url: "/api/credentials/cred-groq-1",
      payload: { label: "x".repeat(129) },
    });
    expect(bad.statusCode).toBe(400);
  });
});
