import { describe, expect, it } from "vitest";
import { createTestSetup } from "./helpers.js";
import { decryptSecret, encryptSecret } from "../src/shared/crypto.js";

describe("security + observability", () => {
  it("encrypts credentials and never returns secrets via management APIs", async () => {
    const { app, store } = await createTestSetup();
    const create = await app.inject({
      method: "POST",
      url: "/api/credentials",
      payload: { accountId: "groq-main", label: "t", secret: "super-secret-key-123" },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().data.id as string;
    const raw = store.getCredential(id)!;
    expect(raw.secretEncrypted).not.toContain("super-secret-key-123");
    expect(decryptSecret(raw.secretEncrypted)).toBe("super-secret-key-123");

    const list = await app.inject({ method: "GET", url: "/api/credentials" });
    const body = JSON.stringify(list.json());
    expect(body).not.toContain("super-secret-key-123");
  });

  it("request history shows the actual provider route used", async () => {
    const { app, store } = await createTestSetup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "groq::nemotron-3-super-120b", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(200);
    const logs = store.listRequestLogs(10);
    expect(logs.length).toBeGreaterThan(0);
    const ok = logs.find((l) => l.status === "success");
    expect(ok?.selectedProviderId).toBe("groq");
    expect(ok?.requestedResourceId).toBe("llm:model:nemotron-3-super-120b");
    expect(ok?.selectionReason).toBeTruthy();
  });

  it("redacts credential ids in request list and keeps no raw keys in logs", async () => {
    const { app } = await createTestSetup();
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "nemotron-3-super-120b", messages: [{ role: "user", content: "hi" }] },
    });
    const list = await app.inject({ method: "GET", url: "/api/requests?limit=5" });
    expect(list.statusCode).toBe(200);
    const body = JSON.stringify(list.json());
    expect(body).not.toContain("groq-secret-1");
    expect(body).not.toContain("or-secret-1");
  });

  it("validateSecret round-trips", () => {
    expect(decryptSecret(encryptSecret("abc", "x".repeat(32)), "x".repeat(32))).toBe("abc");
  });
});
