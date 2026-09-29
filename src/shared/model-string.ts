// Model string parsing. Separator is `::` (not `/`) because provider
// model IDs often contain `/`, e.g. `openrouter::nvidia/nemotron-3-super-120b`.

export interface ParsedModel {
  /** Raw input, e.g. "groq::nemotron-3-super-120b". */
  raw: string;
  /** Provider pin, e.g. "groq", or null for auto-routing. */
  providerPin: string | null;
  /** Logical model name, e.g. "nemotron-3-super-120b" or "nvidia/nemotron-3-super-120b". */
  logicalModel: string;
  /** Canonical resource id, e.g. "llm:model:nemotron-3-super-120b". */
  canonicalResourceId: string;
}

const PROVIDER_PIN_RE = /^[A-Za-z0-9][A-Za-z0-9-_]*$/;

export function parseModelString(raw: string): ParsedModel {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("model must be a non-empty string");
  const sep = trimmed.indexOf("::");
  if (sep === -1) {
    return {
      raw: trimmed,
      providerPin: null,
      logicalModel: trimmed,
      canonicalResourceId: toCanonicalId(trimmed),
    };
  }
  const providerPin = trimmed.slice(0, sep).trim().toLowerCase();
  const logicalModel = trimmed.slice(sep + 2).trim();
  if (!providerPin || !PROVIDER_PIN_RE.test(providerPin)) {
    throw new Error(`invalid provider pin in model "${raw}"`);
  }
  if (!logicalModel) throw new Error(`missing model name in "${raw}"`);
  return {
    raw: trimmed,
    providerPin,
    logicalModel,
    canonicalResourceId: toCanonicalId(logicalModel),
  };
}

export function toCanonicalId(logicalModel: string): string {
  return `llm:model:${logicalModel.toLowerCase()}`;
}

/** Extract routing hints from headers (preferred) or body.routing extension. */
export function routingHintsFromHeaders(headers: Record<string, string | string[] | undefined>): {
  provider?: string;
  account?: string;
  credential?: string;
  policy?: string;
} {
  const pick = (k: string): string | undefined => {
    const v = headers[k] ?? headers[k.toLowerCase()];
    if (Array.isArray(v)) return v[0];
    return v ?? undefined;
  };
  const out: Record<string, string> = {};
  const p = pick("x-router-provider");
  const a = pick("x-router-account");
  const c = pick("x-router-credential");
  const pol = pick("x-router-policy");
  if (p) out.provider = p.toLowerCase();
  if (a) out.account = a;
  if (c) out.credential = c;
  if (pol) out.policy = pol.toLowerCase();
  return out;
}
