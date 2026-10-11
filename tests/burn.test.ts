import { describe, expect, it } from "vitest";
import { createTestSetup } from "./helpers.js";
import { encryptSecret } from "../src/shared/crypto.js";

function isoPlus(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

// TASKS.md scenario:
//   A = 93% remaining, reset 3d
//   B = 15% remaining, reset 10d
//   C = 40% remaining, reset 18d
// Under `burn`, A must receive strong preference.
describe("burn policy", () => {
  it("prefers high remaining quota that resets soon", async () => {
    const { app, store } = await createTestSetup();
    store.createCredential({
      id: "cred-a",
      accountId: "groq-main",
      secretEncrypted: encryptSecret("a"),
      status: "active",
    });
    store.createCredential({
      id: "cred-b",
      accountId: "groq-main",
      secretEncrypted: encryptSecret("b"),
      status: "active",
    });
    store.createCredential({
      id: "cred-c",
      accountId: "openrouter-main",
      secretEncrypted: encryptSecret("c"),
      status: "active",
    });
    // Disable the two default creds so only A/B/C compete.
    store.updateCredentialStatus("cred-groq-1", "disabled");
    store.updateCredentialStatus("cred-or-1", "disabled");

    store.upsertQuotaWindow({
      credentialId: "cred-a",
      metric: "total_tokens",
      limitValue: 1000,
      usedValue: 70,
      windowKind: "calendar_month",
      resetAt: isoPlus(3),
      hard: true,
      source: "configured",
    });
    store.upsertQuotaWindow({
      credentialId: "cred-b",
      metric: "total_tokens",
      limitValue: 1000,
      usedValue: 850,
      windowKind: "calendar_month",
      resetAt: isoPlus(10),
      hard: true,
      source: "configured",
    });
    store.upsertQuotaWindow({
      credentialId: "cred-c",
      metric: "total_tokens",
      limitValue: 1000,
      usedValue: 600,
      windowKind: "calendar_month",
      resetAt: isoPlus(18),
      hard: true,
      source: "configured",
    });

    const sim = await app.inject({
      method: "POST",
      url: "/api/routing/simulate",
      payload: {
        resource: "llm:model:nemotron-3-super-120b",
        capability: "llm.chat",
        policy: "burn",
      },
    });
    expect(sim.statusCode).toBe(200);
    const ranked = sim.json().data.eligible as Array<{
      provider: string;
      reason: string;
      score: number;
    }>;
    expect(ranked.length).toBeGreaterThanOrEqual(3);
    // Top candidate must be the groq route holding cred-a (93%, 3d).
    const top = ranked[0];
    expect(top.reason).toContain("93%");
    expect(top.reason).toContain("3d");

    // And a real burn-routed request goes via groq.
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "nemotron-3-super-120b",
        messages: [{ role: "user", content: "hi" }],
        routing: { policy: "burn" },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-router-via"]).toMatch(/^groq\//);
  });

  it("hard-exhausted routes are ineligible", async () => {
    const { app, store } = await createTestSetup();
    store.upsertQuotaWindow({
      credentialId: "cred-groq-1",
      metric: "requests",
      limitValue: 10,
      usedValue: 10,
      remainingValue: 0,
      windowKind: "calendar_day",
      resetAt: isoPlus(1),
      hard: true,
      source: "configured",
    });
    const sim = await app.inject({
      method: "POST",
      url: "/api/routing/simulate",
      payload: {
        resource: "llm:model:nemotron-3-super-120b",
        capability: "llm.chat",
        policy: "burn",
      },
    });
    const filtered = sim.json().data.filtered as Array<{ reason: string }>;
    expect(filtered.some((f) => f.reason.includes("exhausted"))).toBe(true);
  });

  it("unknown quota stays eligible (never treated as zero)", async () => {
    const { app } = await createTestSetup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "nemotron-3-super-120b",
        messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(res.statusCode).toBe(200);
  });
});
