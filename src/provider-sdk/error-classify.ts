import type { ProviderErrorClass } from "../shared/types.js";
import type { ProviderError } from "./types.js";

// Shared helper: classify HTTP status into router error classes.
// Adapters may refine with provider-specific body codes on top of this.

export function classifyHttpStatus(
  status: number,
  bodyText = "",
  providerCode?: string,
): ProviderError {
  const body = `${bodyText} ${providerCode ?? ""}`.toLowerCase();
  const retryableFor = (
    errorClass: ProviderErrorClass,
    retryable: boolean,
  ): ProviderError => ({
    errorClass,
    message: `upstream HTTP ${status}${providerCode ? ` (${providerCode})` : ""}`,
    retryable,
    statusCode: status,
    providerCode,
  });

  if (status === 401) return retryableFor("auth", false);
  if (status === 400) {
    if (/context|too long|maximum context|tokens/.test(body)) {
      return retryableFor("context_limit", false);
    }
    return retryableFor("bad_request", false);
  }
  if (status === 404) return retryableFor("unsupported", false);
  if (status === 422) return retryableFor("bad_request", false);
  if (status === 429) {
    if (/quota|exhaust|expired|insufficient|credit|balance/.test(body)) {
      return retryableFor("quota_exhausted", true);
    }
    return retryableFor("rate_limit", true);
  }
  if (status === 402 || status === 403) {
    if (/quota|credit|balance|payment/.test(body)) {
      return retryableFor("quota_exhausted", true);
    }
    // 403 without quota/credit keywords is an auth failure; a bare
    // 402 falls through to unknown (as before).
    if (status === 403) return retryableFor("auth", false);
  }
  if (status === 408) return retryableFor("timeout", true);
  if (status >= 500) return retryableFor("provider_unavailable", true);
  return retryableFor("unknown", status >= 500);
}

export function networkError(message: string): ProviderError {
  return { errorClass: "network", message, retryable: true };
}

export function timeoutError(message: string): ProviderError {
  return { errorClass: "timeout", message, retryable: true };
}
