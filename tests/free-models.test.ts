import { describe, expect, it } from "vitest";
import { openTestDb } from "./helpers.js";
import { SqliteStore } from "../src/db/sqlite-store.js";
import { encryptSecret } from "../src/shared/crypto.js";
import {
  AUTO_FREE_RESOURCE_ID,
  isFreeModel,
  refreshAutoFreeAlias,
  syncProviderModels,
} from "../src/server/free-models.js";

process.env.MASTER_KEY ??= "test-master-key-0123456789abcdef0123456789";

describe("isFreeModel", () => {
  it("matches free-suffixed chat models", () => {
    expect(isFreeModel("deepseek-r1:free")).toBe(true);
    expect(isFreeModel("mimo-v2.5-free")).toBe(true);
    expect(isFreeModel("gpt-oss-120b:free")).toBe(true);
  });
  it("rejects paid chat models", () => {
    expect(isFreeModel("llama-3.3-70b-versatile")).toBe(false);
    expect(isFreeModel("gpt-4o")).toBe(false);
  });
  it("rejects free-named non-chat endpoints", () => {
    expect(isFreeModel("flux-image:free")).toBe(false);
    expect(isFreeModel("whisper-large:free")).toBe(false);
    expect(isFreeModel("embed-model:free")).toBe(false);
  });
});

function seedStore() {
  const store = new SqliteStore(openTestDb());
  store.upsertProvider({
    id: "testprov",
    displayName: "Test",
    baseUrl: "https://testprov.test/v1",
    enabled: true,
    priority: 100,
  });
  store.upsertAccount({
    id: "testprov-main",
    providerId: "testprov",
    displayName: "main",
    enabled: true,
  });
  store.createCredential({
    id: "cred-test-1",
    accountId: "testprov-main",
    label: "k1",
    secretEncrypted: encryptSecret("secret-1"),
    status: "active",
  });
  // stale mapping for a model the provider no longer lists (must be pruned)
  for (const id of ["paid-model", "gone-model"]) {
    store.upsertResource({
      id: `llm:model:${id}`,
      kind: "llm_model",
      displayName: id,
      capabilities: ["llm.chat"],
    });
    store.upsertProviderResource({
      resourceId: `llm:model:${id}`,
      providerId: "testprov",
      upstreamId: id,
      capabilities: ["llm.chat"],
      enabled: true,
    });
  }
  return store;
}

const modelsFetch = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        data: [
          { id: "shiny-new:free" },
          { id: "paid-model" },
          { id: "flux-image:free" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );

describe("syncProviderModels", () => {
  it("maps all live chat models and prunes churned ones", async () => {
    const store = seedStore();
    const summary = await syncProviderModels({
      store,
      fetchImpl: modelsFetch as unknown as typeof fetch,
    });
    const ups = store
      .listProviderResources(undefined, "testprov")
      .filter((m) => m.resourceId !== AUTO_FREE_RESOURCE_ID)
      .map((m) => m.upstreamId)
      .sort();
    // free + paid mapped, image endpoint skipped, churned model pruned
    // (the auto:free alias row itself is excluded here, asserted below)
    expect(ups).toEqual(["paid-model", "shiny-new:free"]);
    expect(summary.mapped).toBe(2);
    expect(summary.pruned).toBe(1);
    expect(summary.skipped).toEqual([]);
    expect(store.getResource("llm:model:gone-model")).toBeUndefined();
    expect(store.getResource("llm:model:shiny-new:free")).toBeDefined();
  });

  it("falls back to the curated list when live discovery fails", async () => {
    const store = seedStore();
    const failing = () => Promise.reject(new Error("down"));
    const summary = await syncProviderModels({
      store,
      fetchImpl: failing as unknown as typeof fetch,
      catalog: { testprov: ["curated-one"] },
    });
    const ups = store
      .listProviderResources(undefined, "testprov")
      .map((m) => m.upstreamId);
    expect(ups).toEqual(["curated-one"]);
    expect(summary.mapped).toBe(1);
    expect(summary.pruned).toBe(2);
    expect(summary.skipped).toEqual([]);
  });

  it("leaves everything untouched when discovery fails with no fallback", async () => {
    const store = seedStore();
    const failing = () => Promise.reject(new Error("down"));
    const summary = await syncProviderModels({
      store,
      fetchImpl: failing as unknown as typeof fetch,
    });
    expect(summary.skipped).toEqual(["testprov"]);
    expect(
      store
        .listProviderResources(undefined, "testprov")
        .map((m) => m.upstreamId)
        .sort(),
    ).toEqual(["gone-model", "paid-model"]);
  });
});

describe("auto:free alias", () => {
  it("fans out across every enabled free mapping (paid excluded)", async () => {
    const store = seedStore();
    await syncProviderModels({
      store,
      fetchImpl: modelsFetch as unknown as typeof fetch,
    });
    const n = refreshAutoFreeAlias(store);
    expect(n).toBe(1);
    expect(store.getResource(AUTO_FREE_RESOURCE_ID)).toBeDefined();
    const alias = store.listProviderResources(AUTO_FREE_RESOURCE_ID);
    expect(alias.map((m) => m.upstreamId)).toEqual(["shiny-new:free"]);
    expect(alias[0].providerId).toBe("testprov");
  });

  it("is idempotent and respects disabled mappings", async () => {
    const store = seedStore();
    await syncProviderModels({
      store,
      fetchImpl: modelsFetch as unknown as typeof fetch,
    });
    expect(refreshAutoFreeAlias(store)).toBe(1);
    expect(refreshAutoFreeAlias(store)).toBe(1);
    expect(store.listProviderResources(AUTO_FREE_RESOURCE_ID)).toHaveLength(1);
    const src = store
      .listProviderResources(undefined, "testprov")
      .find(
        (m) =>
          m.resourceId !== AUTO_FREE_RESOURCE_ID &&
          m.upstreamId === "shiny-new:free",
      )!;
    store.setProviderResourceEnabled(src.id, false);
    expect(refreshAutoFreeAlias(store)).toBe(0);
    expect(store.listProviderResources(AUTO_FREE_RESOURCE_ID)).toHaveLength(0);
  });
});
