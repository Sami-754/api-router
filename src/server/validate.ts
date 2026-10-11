import { decryptSecret, newId } from "../shared/crypto.js";
import type { Store } from "../core/store.js";
import type { ProviderRegistry } from "../provider-sdk/registry.js";
import type { CredentialValidationResult } from "../provider-sdk/types.js";

export interface ValidateJobOptions {
  store: Store;
  registry: ProviderRegistry;
  fetchImpl?: typeof fetch;
  /** Only this provider (default: all). */
  provider?: string;
  /** Max credentials per run (default 25). */
  limit?: number;
  /** Skip credentials validated within this many hours (default 24). */
  maxAgeHours?: number;
  /** Delay between probes (default 300ms) to avoid hammering providers. */
  staggerMs?: number;
  timeoutMs?: number;
}

export interface ValidateJobSummary {
  checked: number;
  ok: number;
  invalid: number;
  skippedFresh: number;
  errors: Array<{ credential: string; message: string }>;
}

export async function validateCredentialById(
  store: Store,
  registry: ProviderRegistry,
  id: string,
  fetchImpl?: typeof fetch,
  timeoutMs = 20_000,
): Promise<CredentialValidationResult & { status?: string }> {
  const cred = store.getCredential(id);
  if (!cred) throw new Error(`unknown credential: ${id}`);
  const adapter = registry.get(cred.providerId);
  if (!adapter) throw new Error(`no adapter for provider ${cred.providerId}`);
  const provider = store.getProvider(cred.providerId);
  let secret: string;
  try {
    secret = decryptSecret(cred.secretEncrypted);
  } catch {
    throw new Error("stored secret is undecryptable (wrong MASTER_KEY?)");
  }
  const result = await adapter.validateCredential(
    {
      id: cred.id,
      accountId: cred.accountId,
      providerId: cred.providerId,
      secret,
    },
    {
      requestId: newId("validate"),
      baseUrl: provider?.baseUrl ?? undefined,
      timeoutMs,
      fetchImpl,
    },
  );
  store.markCredentialValidated(id, result.ok);
  return { ...result, status: store.getCredential(id)?.status };
}

/** Batch validation: round-robin over stale active credentials. */
export async function runValidationJob(
  opts: ValidateJobOptions,
): Promise<ValidateJobSummary> {
  const {
    store,
    registry,
    fetchImpl,
    limit = 25,
    maxAgeHours = 24,
    staggerMs = 300,
    timeoutMs = 20_000,
  } = opts;
  const cutoff = Date.now() - maxAgeHours * 3_600_000;
  const all = opts.provider
    ? store.listCredentials().filter((c) => c.providerId === opts.provider)
    : store.listCredentials();
  const stale = all.filter((c) => {
    if (c.status !== "active") return false;
    if (!c.lastValidatedAt) return true;
    return Date.parse(c.lastValidatedAt) < cutoff;
  });
  const summary: ValidateJobSummary = {
    checked: 0,
    ok: 0,
    invalid: 0,
    skippedFresh:
      all.filter((c) => c.status === "active").length - stale.length,
    errors: [],
  };
  for (const cred of stale.slice(0, limit)) {
    try {
      const r = await validateCredentialById(
        store,
        registry,
        cred.id,
        fetchImpl,
        timeoutMs,
      );
      summary.checked += 1;
      if (r.ok) summary.ok += 1;
      else {
        summary.invalid += 1;
        summary.errors.push({
          credential: cred.id,
          message: r.message ?? "invalid",
        });
      }
    } catch (e) {
      summary.checked += 1;
      summary.invalid += 1;
      summary.errors.push({
        credential: cred.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
    if (staggerMs > 0) await new Promise((r) => setTimeout(r, staggerMs));
  }
  return summary;
}
