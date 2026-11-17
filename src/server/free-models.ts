// Free-model sync: at every boot, pull each provider's live /models list and
// map ALL chat models it advertises (free or not — the dashboard badges the
// free ones and offers a free-only filter). Stale mappings for models the
// provider no longer lists are pruned, so churned catalogs can't go stale.
// Discovery failure may add curated mappings but never removes existing ones.
// Non-chat endpoints (embeddings, images, audio, …) are never mapped.
import { decryptSecret } from "../shared/crypto.js";
import type { Store } from "../core/store.js";

/** "free" in the model name (case-insensitive): `:free`, `-free`, … */
const FREE_MODEL_RE = /free/i;

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

/**
 * Virtual alias model id. `auto:free` fans out across every enabled
 * free-model mapping, so one model name routes through the whole free pool
 * with the normal eligibility → policy → fallback pipeline.
 */
export const AUTO_FREE_RESOURCE_ID = "llm:model:auto:free";

/**
 * Reconcile `auto:free` with current mappings without deleting unchanged
 * rows. Executable aliases share source quota/health state. Disabled source
 * mappings are excluded.
 */
export function refreshAutoFreeAlias(store: Store): number {
  const existing = store.listProviderResources(AUTO_FREE_RESOURCE_ID);
  const free = store
    .listProviderResources()
    .filter(
      (m) =>
        m.enabled &&
        m.resourceId !== AUTO_FREE_RESOURCE_ID &&
        m.capabilities.includes("llm.chat") &&
        isFreeModel(m.upstreamId),
    );
  if (free.length && !store.getResource(AUTO_FREE_RESOURCE_ID)) {
    store.upsertResource({
      id: AUTO_FREE_RESOURCE_ID,
      kind: "llm_model",
      displayName: "Auto Free (all free models)",
      capabilities: ["llm.chat", "llm.tools"],
      metadata: { alias: true },
    });
  }
  const now = new Date().toISOString();
  const keep = new Set<string>();
  for (const m of free) {
    const alias = existing.find(
      (a) => a.providerId === m.providerId && a.upstreamId === m.upstreamId,
    );
    const row = store.upsertProviderResource({
      id: alias?.id,
      resourceId: AUTO_FREE_RESOURCE_ID,
      providerId: m.providerId,
      upstreamId: m.upstreamId,
      capabilities: m.capabilities,
      contextTokens: m.contextTokens,
      enabled: alias?.enabled ?? true,
      metadata: { free: true, aliasOf: m.id, syncedAt: now },
    });
    keep.add(row.id);
  }
  for (const m of existing)
    if (!keep.has(m.id)) store.deleteProviderResource(m.id);
  return free.length;
}

function extractIds(providerId: string, data: unknown): string[] {
  const rawList =
    (data as { data?: unknown; models?: unknown } | null)?.data ??
    (data as { data?: unknown; models?: unknown } | null)?.models;
  if (!Array.isArray(rawList)) {
    throw new Error("invalid model catalog");
  }
  const ids: string[] = [];
  for (const m of rawList) {
    if (!m || typeof m !== "object") continue;
    const item = m as { id?: unknown; name?: unknown };
    const id =
      typeof item.id === "string"
        ? item.id
        : typeof item.name === "string"
          ? item.name
          : "";
    if (id.trim()) ids.push(id.trim());
  }
  if (!ids.length) {
    throw new Error("invalid model catalog");
  }
  let mappedIds = ids;
  if (providerId === "google")
    mappedIds = mappedIds.map((id) => id.replace(/^models\//, ""));
  return [...new Set(mappedIds)];
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
    const previous = store.listProviderResources(undefined, p.id);
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
      const existing = previous.find(
        (m) => m.resourceId === canonical && m.upstreamId === upstreamId,
      );
      const pr = store.upsertProviderResource({
        id: existing?.id,
        resourceId: canonical,
        providerId: p.id,
        upstreamId,
        capabilities: ["llm.chat", "llm.tools"],
        enabled: existing?.enabled ?? true,
        contextTokens: existing?.contextTokens,
        metadata: {
          ...existing?.metadata,
          free,
          ...(verified ? { discovered: true } : { unverified: true }),
          syncedAt: new Date().toISOString(),
        },
      });
      keep.add(pr.id);
      summary.mapped++;
    }
    for (const m of previous) {
      // Only live catalogs can prove removal. Tools, custom canonical
      // mappings and derived alias rows are outside this sync's ownership.
      if (
        verified &&
        m.resourceId === `llm:model:${m.upstreamId.toLowerCase()}` &&
        store.getResource(m.resourceId)?.kind === "llm_model" &&
        !keep.has(m.id)
      ) {
        store.deleteProviderResource(m.id);
        summary.pruned++;
      }
    }
  }

  // Rebuild the auto:free alias from the fresh mapping set, then drop
  // canonical LLM models left with no mappings (capability resources
  // like web.search are never touched).
  refreshAutoFreeAlias(store);
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
