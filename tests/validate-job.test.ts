import { describe, expect, it } from "vitest";
import { createTestSetup } from "./helpers.js";
import { encryptSecret } from "../src/shared/crypto.js";

describe("validation job", () => {
  it("validates stale keys in a batch and skips fresh ones", async () => {
    const { app, store } = await createTestSetup();
    const first = await app.inject({ method: "POST", url: "/api/maintenance/validate", payload: { limit: 10 } });
    expect(first.statusCode).toBe(200);
    const s = first.json().data;
    expect(s.checked).toBe(2);
    expect(s.ok).toBe(2);

    // Immediately re-running validates nothing (both fresh).
    const second = await app.inject({ method: "POST", url: "/api/maintenance/validate", payload: {} });
    expect(second.json().data.checked).toBe(0);
    expect(second.json().data.skippedFresh).toBe(2);
    void store;
  });

  it("marks rejected keys invalid", async () => {
    const reject: typeof fetch = async () => new Response("nope", { status: 401 });
    const { app, store } = await createTestSetup({ fetchImpl: reject });
    const res = await app.inject({ method: "POST", url: "/api/maintenance/validate", payload: { limit: 5 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.invalid).toBe(2);
    expect(store.getCredential("cred-groq-1")?.status).toBe("invalid");
  });

  it("respects provider filter and limit", async () => {
    const { app, store } = await createTestSetup();
    store.createCredential({
      id: "cred-extra", accountId: "groq-main",
      secretEncrypted: encryptSecret("x"), status: "active",
    });
    const res = await app.inject({
      method: "POST", url: "/api/maintenance/validate", payload: { provider: "groq", limit: 1 },
    });
    expect(res.json().data.checked).toBe(1);
  });
});
