import Database from "better-sqlite3";
import { SCHEMA_SQL } from "../src/db/schema.js";
import { SqliteStore } from "../src/db/sqlite-store.js";
import { ProviderRegistry } from "../src/provider-sdk/registry.js";
import { OpenAICompatibleAdapter } from "../src/adapters/openai-compatible.js";
import { Router } from "../src/core/router.js";
import { buildApp } from "../src/server/app.js";
import { encryptSecret } from "../src/shared/crypto.js";

process.env.MASTER_KEY ??= "test-master-key-0123456789abcdef0123456789";

export const CANONICAL = "llm:model:nemotron-3-super-120b";

export interface MockCall {
  url: string;
  init: RequestInit;
}

export function openTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

export function chatJson(content = "hello", model = "upstream-model") {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1_700_000_000,
    model,
    choices: [
      { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
  };
}

export async function createTestSetup(opts: { fetchImpl?: typeof fetch } = {}) {
  const db = openTestDb();
  const store = new SqliteStore(db);
  const registry = new ProviderRegistry();
  registry.register(
    new OpenAICompatibleAdapter({
      providerId: "groq",
      displayName: "Groq",
      defaultBaseUrl: "https://api.groq.test/openai/v1",
    }),
  );
  registry.register(
    new OpenAICompatibleAdapter({
      providerId: "openrouter",
      displayName: "OpenRouter",
      defaultBaseUrl: "https://openrouter.test/api/v1",
    }),
  );

  const calls: MockCall[] = [];
  const defaultFetch: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return new Response(JSON.stringify(chatJson()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const fetchForApp = opts.fetchImpl ?? defaultFetch;
  const router = new Router({
    store,
    registry,
    defaultPolicy: "auto",
    maxAttempts: 64,
    timeoutMs: 5_000,
    fetchImpl: fetchForApp,
    defaultBaseUrls: {
      groq: "https://api.groq.test/openai/v1",
      openrouter: "https://openrouter.test/api/v1",
    },
  });

  // Seed: two providers expose the same canonical model.
  store.upsertProvider({ id: "groq", displayName: "Groq", baseUrl: "https://api.groq.test/openai/v1", enabled: true, priority: 10 });
  store.upsertProvider({ id: "openrouter", displayName: "OpenRouter", baseUrl: "https://openrouter.test/api/v1", enabled: true, priority: 20 });
  store.upsertResource({ id: CANONICAL, kind: "llm_model", displayName: "Nemotron 3 Super 120B", capabilities: ["llm.chat"] });
  store.upsertProviderResource({ resourceId: CANONICAL, providerId: "groq", upstreamId: "nvidia/nemotron-3-super-120b", capabilities: ["llm.chat"], enabled: true });
  store.upsertProviderResource({ resourceId: CANONICAL, providerId: "openrouter", upstreamId: "nvidia/nemotron-3-super-120b", capabilities: ["llm.chat"], enabled: true });
  store.upsertAccount({ id: "groq-main", providerId: "groq", displayName: "groq main", enabled: true });
  store.upsertAccount({ id: "openrouter-main", providerId: "openrouter", displayName: "or main", enabled: true });
  store.createCredential({ id: "cred-groq-1", accountId: "groq-main", label: "g1", secretEncrypted: encryptSecret("groq-secret-1"), status: "active" });
  store.createCredential({ id: "cred-or-1", accountId: "openrouter-main", label: "o1", secretEncrypted: encryptSecret("or-secret-1"), status: "active" });

  const app = await buildApp({ store, registry, router, adminToken: "", settings: { defaultPolicy: "auto" }, fetchImpl: fetchForApp });

  return { db, store, registry, router, app, calls };
}
