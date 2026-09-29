// One-shot importer for freellmapi-style key exports.
// Usage: KEYS_PATH=/path/to/keys.json pnpm tsx src/server/import-keys.ts
//
// Reads { keys: [{ platform, key, label, baseUrl? }] }, creates providers,
// one account per (platform, label), encrypts every key as a credential, then
// discovers /models per provider and maps each chat model to a canonical
// resource. Idempotent: existing credential ids are skipped.
//
// The export file is NEVER copied into the repo; secrets only enter the
// encrypted SQLite store.
import { readFileSync } from "node:fs";
import "dotenv/config";
import { loadConfig } from "../shared/config.js";
import { decryptSecret, encryptSecret } from "../shared/crypto.js";
import { openDatabase, SqliteStore } from "../db/sqlite-store.js";

interface ExportedKey {
  platform: string;
  key: string;
  label: string;
  baseUrl?: string;
}

interface ProviderSpec {
  id: string;
  displayName: string;
  baseUrl: string | null;
  headers?: Record<string, string>;
  discover: boolean;
  curated?: string[];
}

const REFERRER = { "HTTP-Referer": "https://github.com/api-router", "X-Title": "api-router" };

// Base URLs verified 2026-09-22 (see STATE.md import notes). groq/openrouter/
// xkiro answered HTTP 403 error 1010 (Cloudflare edge block on this egress IP,
// not necessarily dead keys) — imported with curated model lists.
const PROVIDERS: Record<string, ProviderSpec> = {
  agnes: { id: "agnes", displayName: "Agnes AI", baseUrl: "https://apihub.agnes-ai.com/v1", discover: true },
  cloudflare: { id: "cloudflare", displayName: "Cloudflare Workers AI", baseUrl: null, discover: true },
  cohere: { id: "cohere", displayName: "Cohere", baseUrl: "https://api.cohere.com/compatibility/v1", discover: false },
  custom: { id: "lan-ollama", displayName: "LAN Ollama (custom)", baseUrl: null, discover: true },
  google: { id: "google", displayName: "Google AI Studio", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", discover: true },
  groq: {
    id: "groq", displayName: "Groq", baseUrl: "https://api.groq.com/openai/v1", discover: false,
    curated: [
      "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "deepseek-r1-distill-llama-70b",
      "qwen-qwq-32b", "meta-llama/llama-4-scout-17b-16e-instruct",
      "meta-llama/llama-4-maverick-17b-128e-instruct", "moonshotai/kimi-k2-instruct",
      "openai/gpt-oss-120b", "openai/gpt-oss-20b",
    ],
  },
  huggingface: { id: "huggingface", displayName: "Hugging Face Router", baseUrl: "https://router.huggingface.co/v1", discover: true },
  mistral: { id: "mistral", displayName: "Mistral", baseUrl: "https://api.mistral.ai/v1", discover: true },
  nara: { id: "nara", displayName: "NaraRouter", baseUrl: "https://router.bynara.id/v1", discover: true },
  ollama: { id: "ollama", displayName: "Ollama Cloud", baseUrl: "https://ollama.com/v1", discover: true },
  opencode: {
    id: "opencode", displayName: "OpenCode Zen", baseUrl: "https://opencode.ai/zen/v1", discover: false,
    curated: [
      "big-pickle", "mimo-v2.5-free", "deepseek-v4-flash", "kimi-k2.5", "kimi-k2.6",
      "kimi-k2.7-code", "glm-5", "glm-5.1", "glm-5.2", "minimax-m3", "minimax-m2.7",
      "minimax-m2.5", "nemotron-3-ultra-free", "nemotron-3.5-lightning-free",
    ],
  },
  openrouter: { id: "openrouter", displayName: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", headers: REFERRER, discover: true },
  requesty: { id: "requesty", displayName: "Requesty", baseUrl: "https://router.requesty.ai/v1", headers: REFERRER, discover: true },
  xkiro: {
    id: "xkiro", displayName: "xKiro", baseUrl: "https://api.xkiro.com/v1", discover: false,
    curated: [
      "minimax/minimax-m2.7", "minimax/minimax-m2.5", "mistralai/mistral-large-2512",
      "mistralai/codestral-2508", "openai/gpt-5.3-codex-spark", "z-ai/glm-5.3-flash",
      "deepseek/deepseek-v4-flash",
    ],
  },
};

const SKIP_MODEL_RE = /embed|whisper|tts|stt|image|vision|moderat|transcri|audio|ocr|rerank|clip/i;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "key";
}

async function getJson(url: string, key: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, ...(headers ?? {}) },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function extractIds(providerId: string, data: unknown): string[] {
  const list = (data as { data?: Array<{ id?: string }> }).data ?? [];
  let ids = list.map((m) => String(m.id ?? "")).filter(Boolean);
  if (providerId === "google") ids = ids.map((id) => id.replace(/^models\//, ""));
  return [...new Set(ids)].filter((id) => !SKIP_MODEL_RE.test(id));
}

async function discoverModels(spec: ProviderSpec, keys: string[]): Promise<{ ids: string[]; verified: boolean }> {
  if (spec.curated && !spec.discover) return { ids: spec.curated, verified: false };
  if (spec.id === "cloudflare") {
    // Models API differs: account id is embedded in the key (acct:token).
    for (const k of keys.slice(0, 2)) {
      const sep = k.indexOf(":");
      if (sep === -1) continue;
      const acct = k.slice(0, sep);
      const tok = k.slice(sep + 1);
      try {
        const data = (await getJson(
          `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/models/search?task=Text%20Generation&per_page=100`,
          tok,
        )) as { result?: Array<{ name?: string }> };
        const ids = [...new Set((data.result ?? []).map((m) => String(m.name ?? "")).filter(Boolean))];
        if (ids.length) return { ids, verified: true };
      } catch { /* try next key */ }
    }
    return { ids: ["@cf/meta/llama-3.2-1b-instruct", "@cf/moonshotai/kimi-k2.6"], verified: false };
  }
  for (const k of keys.slice(0, 3)) {
    try {
      const data = await getJson(`${spec.baseUrl!.replace(/\/$/, "")}/models`, k, spec.headers);
      const ids = extractIds(spec.id, data);
      if (ids.length) return { ids, verified: true };
    } catch { /* try next key */ }
  }
  return { ids: spec.curated ?? [], verified: false };
}

async function main(): Promise<void> {
  const keysPath = process.argv[2] ?? process.env.KEYS_PATH;
  if (!keysPath) throw new Error("pass the export path as argv[1] or KEYS_PATH env");
  const exported = JSON.parse(readFileSync(keysPath, "utf8")) as { keys: ExportedKey[] };
  console.log(`loaded ${exported.keys.length} keys from export (source file untouched)`);

  const config = loadConfig();
  if (!config.masterKey) throw new Error("MASTER_KEY is required (see .env.example)");
  const store = new SqliteStore(openDatabase(config.databasePath));

  const byPlatform = new Map<string, ExportedKey[]>();
  for (const k of exported.keys) {
    const list = byPlatform.get(k.platform) ?? [];
    list.push(k);
    byPlatform.set(k.platform, list);
  }

  let credCount = 0;
  let routeCount = 0;

  for (const [platform, entries] of byPlatform) {
    const spec = PROVIDERS[platform];
    if (!spec) {
      console.log(`! unknown platform ${platform} (${entries.length} keys) — skipped`);
      continue;
    }

    // Cloudflare embeds the account id in the key; baseUrl is per-account.
    let baseUrl = spec.baseUrl;
    let secrets = entries.map((e) => ({ label: e.label, secret: e.key }));
    if (platform === "cloudflare") {
      const [first] = entries;
      const sep = first.key.indexOf(":");
      if (sep === -1) {
        console.log("! cloudflare key is not acct:token shaped — creds only");
      } else {
        baseUrl = `https://api.cloudflare.com/client/v4/accounts/${first.key.slice(0, sep)}/ai/v1`;
        secrets = entries.map((e) => {
          const i = e.key.indexOf(":");
          return { label: e.label, secret: i === -1 ? e.key : e.key.slice(i + 1) };
        });
      }
    }
    if (platform === "custom" && entries[0]?.baseUrl) baseUrl = entries[0].baseUrl;

    const existing = store.getProvider(spec.id);
    store.upsertProvider({
      id: spec.id,
      displayName: spec.displayName,
      baseUrl,
      enabled: true,
      priority: existing?.priority ?? 100,
    });

    // One account per (provider, label); credentials hang off accounts.
    // Idempotent: a secret already stored under the account is skipped, so
    // re-runs only add new keys (duplicate labels keep all their keys).
    for (const s of secrets) {
      const base = `${spec.id}-${slug(s.label)}`;
      let accountId = base;
      let n = 2;
      while (store.getAccount(accountId) && store.getAccount(accountId)?.providerId !== spec.id) {
        accountId = `${base}-${n++}`;
      }
      if (!store.getAccount(accountId)) {
        store.upsertAccount({ id: accountId, providerId: spec.id, displayName: s.label, enabled: true });
      }
      const knownSecrets = new Set(
        store.listCredentials(accountId).map((c) => {
          try {
            return decryptSecret(c.secretEncrypted);
          } catch {
            return "";
          }
        }),
      );
      if (knownSecrets.has(s.secret)) continue;
      const credBase = `cred-${spec.id}-${slug(s.label)}`;
      let credId = credBase;
      let m = 2;
      while (store.getCredential(credId)) credId = `${credBase}-${m++}`;
      store.createCredential({ id: credId, accountId, label: s.label, secretEncrypted: encryptSecret(s.secret), status: "active" });
      credCount++;
    }

    // Model mappings → canonical resources → executable routes.
    const { ids, verified } = await discoverModels(
      { ...spec, baseUrl: baseUrl ?? spec.baseUrl ?? "" },
      entries.map((e) => e.key),
    );
    for (const upstreamId of ids) {
      const canonical = `llm:model:${upstreamId.toLowerCase()}`;
      if (!store.getResource(canonical)) {
        store.upsertResource({
          id: canonical,
          kind: "llm_model",
          displayName: upstreamId,
          capabilities: ["llm.chat", "llm.tools"],
          metadata: { discoveredFrom: spec.id },
        });
      }
      store.upsertProviderResource({
        resourceId: canonical,
        providerId: spec.id,
        upstreamId,
        capabilities: ["llm.chat", "llm.tools"],
        enabled: true,
        metadata: verified ? { discovered: true } : { unverified: true },
      });
      routeCount++;
    }
    console.log(
      `+ ${spec.id}: ${entries.length} keys imported, ${ids.length} models (${verified ? "discovered live" : ids.length ? "curated, unverified" : "credentials only, no mappings"})`,
    );
  }

  console.log(`done: ${credCount} new credentials, ${routeCount} provider mappings`);
}

main().catch((e) => {
  console.error(`import failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
