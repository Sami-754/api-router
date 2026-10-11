// Free-model sync: at every boot, pull each provider's live /models list and
// map ALL chat models it advertises (free or not — the dashboard badges the
// free ones and offers a free-only filter). Stale mappings for models the
// provider no longer lists are pruned, so churned catalogs can't go stale.
// Providers whose discovery fails fall back to curated lists when one exists,
// otherwise keep existing mappings (never wipe on a network blip).
// Non-chat endpoints (embeddings, images, audio, …) are never mapped.
import { decryptSecret } from "../shared/crypto.js";
import type { Store } from "../core/store.js";

/** "free" in the model name (case-insensitive): `:free`, `-free`, … */
export const FREE_MODEL_RE = /free/i;

/** Non-chat model endpoints — never mapped, free or not. */
export const SKIP_MODEL_RE =
  /embed|whisper|tts|stt|image|vision|moderat|transcri|audio|ocr|rerank|clip/i;

/**
 * Curated model lists for providers whose live /models is unreachable from
 * here (edge-blocked egress). Used as fallback when live discovery fails.
 */
export const CURATED_MODELS: Record<string, string[]> = {
  groq: [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "deepseek-r1-distill-llama-70b",
    "qwen-qwq-32b",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "moonshotai/kimi-k2-instruct",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
  ],
  xkiro: [
    "minimax/minimax-m2.7",
    "minimax/minimax-m2.5",
    "mistralai/mistral-large-2512",
    "mistralai/codestral-2508",
    "openai/gpt-5.3-codex-spark",
    "z-ai/glm-5.3-flash",
    "deepseek/deepseek-v4-flash",
  ],
};

export function isFreeModel(upstreamId: string): boolean {
  return FREE_MODEL_RE.test(upstreamId) && !SKIP_MODEL_RE.test(upstreamId);
}

function extractIds(providerId: string, data: unknown): string[] {
  const list = (data as { data?: Array<{ id?: string }> }).data ?? [];
  let ids = list.map((m) => String(m.id ?? "")).filter(Boolean);
  if (providerId === "google")
    ids = ids.map((id) => id.replace(/^models\//, ""));
  return [...new Set(ids)];
}

export interface ModelSyncSummary {
  /** mappings present after the sync */
  mapped: number;
  /** stale mappings deleted */
  pruned: number;
  /** providers whose discovery failed with no curated fallback (untouched) */
  skipped: string[];
}

export async function syncProviderModels(opts: {
  store: Store;
  fetchImpl?: typeof fetch;
  perProviderKeys?: number;
  catalog?: Record<string, string[]>;
}): Promise<ModelSyncSummary> {
  const { store, perProviderKeys = 3, catalog = CURATED_MODELS } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const summary: ModelSyncSummary = { mapped: 0, pruned: 0, skipped: [] };

  for (const p of store.listProviders()) {
    if (!p.enabled || !p.baseUrl) continue;
    const secrets: string[] = [];
    for (const c of store.listCredentials()) {
      if (c.providerId !== p.id || c.status !== "active") continue;
      try {
        secrets.push(decryptSecret(c.secretEncrypted));
      } catch {
        /* unreadable secret — try the next key */
      }
      if (secrets.length >= perProviderKeys) break;
    }
    if (!secrets.length) continue;

    let listed: string[] | null = null;
    let verified = false;
    for (const secret of secrets) {
      try {
        const res = await fetchImpl(`${p.baseUrl.replace(/\/$/, "")}/models`, {
          headers: { Authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) continue;
        listed = extractIds(p.id, await res.json());
        verified = true;
        break;
      } catch {
        /* try the next key */
      }
    }
    if (!listed && catalog[p.id]) {
      listed = [...catalog[p.id]];
      verified = false;
    }
    if (!listed) {
      summary.skipped.push(p.id);
      continue;
    }

    const chat = [...new Set(listed)].filter((id) => !SKIP_MODEL_RE.test(id));
    const keep = new Set<string>();
    for (const upstreamId of chat) {
      const free = isFreeModel(upstreamId);
      const canonical = `llm:model:${upstreamId.toLowerCase()}`;
      if (!store.getResource(canonical)) {
        store.upsertResource({
          id: canonical,
          kind: "llm_model",
          displayName: upstreamId,
          capabilities: ["llm.chat", "llm.tools"],
          metadata: { discoveredFrom: p.id, free },
        });
      }
      const pr = store.upsertProviderResource({
        resourceId: canonical,
        providerId: p.id,
        upstreamId,
        capabilities: ["llm.chat", "llm.tools"],
        enabled: true,
        metadata: {
          free,
          ...(verified ? { discovered: true } : { unverified: true }),
          syncedAt: new Date().toISOString(),
        },
      });
      keep.add(pr.id);
      summary.mapped++;
    }
    for (const m of store.listProviderResources(undefined, p.id)) {
      if (!keep.has(m.id)) {
        store.deleteProviderResource(m.id);
        summary.pruned++;
      }
    }
  }

  // Drop canonical LLM models left with no mappings (capability resources
  // like web.search are never touched).
  for (const r of store.listResources()) {
    if (
      r.kind === "llm_model" &&
      store.listProviderResources(r.id).length === 0
    ) {
      store.deleteResource(r.id);
    }
  }

  return summary;
}
