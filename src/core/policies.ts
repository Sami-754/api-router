import type { HealthSnapshot, QuotaWindow, Route, RoutingPolicyName } from "../shared/types.js";
import { msUntilReset, remainingFractionOf } from "./quota.js";

// Pluggable routing policies. Each scorer returns a higher-is-better score plus
// a human-readable reason. Eligibility filtering happens BEFORE scoring
// (see router.ts) — scorers must not re-implement hard exclusion.

export interface ScoredRoute {
  route: Route;
  score: number;
  reason: string;
  details: Record<string, number | string | null>;
}

export interface ScoringInput {
  route: Route;
  quotas: QuotaWindow[];
  health?: HealthSnapshot;
  estimatedCost?: number | null;
  nowMs: number;
}

function soonestResetMs(quotas: QuotaWindow[], nowMs: number): number | null {
  let best: number | null = null;
  for (const q of quotas) {
    const ms = msUntilReset(q, nowMs);
    if (ms != null) best = best == null ? ms : Math.min(best, ms);
  }
  return best;
}

function minRemainingFraction(quotas: QuotaWindow[]): number | null {
  let best: number | null = null;
  for (const q of quotas) {
    const f = remainingFractionOf(q);
    if (f != null) best = best == null ? f : Math.min(best, f);
  }
  return best;
}

/** Urgency rises as reset approaches: 1 at reset, decaying over ~30 days. */
export function resetUrgency(msUntilResetValue: number | null): number {
  if (msUntilResetValue == null) return 0.2; // unknown reset → mild baseline
  const days = msUntilResetValue / 86_400_000;
  if (days <= 0) return 1;
  // urgency = exp(-days / 10): 3d → 0.74, 10d → 0.37, 18d → 0.17, 30d → 0.05
  return Math.exp(-days / 10);
}

function latencyScore(health?: HealthSnapshot): number {
  const ema = health?.latencyEmaMs;
  if (ema == null) return 0.5;
  // 300ms → ~1, 2s → ~0.3, 10s → ~0.05
  return 1 / (1 + ema / 500);
}

function reliabilityScore(health?: HealthSnapshot): number {
  if (!health) return 0.5;
  const total = health.successCount + health.failureCount;
  if (total === 0) return 0.5;
  const rate = health.successCount / total;
  const penalty = Math.min(0.5, health.consecutiveFailures * 0.15);
  return Math.max(0, rate - penalty);
}

export function scoreRoute(
  policy: RoutingPolicyName,
  input: ScoringInput,
): { score: number; reason: string; details: Record<string, number | string | null> } {
  const { route, quotas, health, nowMs } = input;
  const remaining = minRemainingFraction(quotas);
  const resetMs = soonestResetMs(quotas, nowMs);
  const urgency = resetUrgency(resetMs);
  const latency = latencyScore(health);
  const reliability = reliabilityScore(health);
  const priorityTerm = 1 / (1 + Math.max(0, route.providerPriority) / 100);

  const resetDays = resetMs == null ? null : +(resetMs / 86_400_000).toFixed(2);
  const details: Record<string, number | string | null> = {
    remainingFraction: remaining ?? null,
    daysUntilReset: resetDays,
    urgency: +urgency.toFixed(3),
    latencyEmaMs: health?.latencyEmaMs ?? null,
    reliability: +reliability.toFixed(3),
    providerPriority: route.providerPriority,
  };

  switch (policy) {
    case "burn": {
      // Favor quota that will expire/reset soon: remaining * urgency.
      // Routes with no quota info get a neutral 0.25 so unknown quota is
      // usable but loses to known-expiring quota.
      const r = remaining ?? 0.5;
      const score = 0.15 + 0.85 * r * (0.25 + 0.75 * urgency);
      const pct = remaining == null ? "unknown quota" : `${Math.round(remaining * 100)}% remaining`;
      const reset = resetDays == null ? "unknown reset" : `resets in ${resetDays}d`;
      return { score, reason: `burn: ${pct}, ${reset} (urgency ${urgency.toFixed(2)})`, details };
    }
    case "preserve": {
      const r = remaining ?? 0.5;
      const score = 0.15 + 0.85 * r * (1.15 - urgency);
      return {
        score,
        reason: `preserve: ${remaining == null ? "unknown quota" : `${Math.round(remaining * 100)}% remaining`}, favors long-lived headroom`,
        details,
      };
    }
    case "fast":
      return { score: 0.1 + 0.9 * latency, reason: `fast: latency EMA ${health?.latencyEmaMs ?? "unknown"}ms`, details };
    case "reliable":
      return { score: 0.1 + 0.9 * reliability, reason: `reliable: success score ${reliability.toFixed(2)}`, details };
    case "cheap":
      // No cost model yet: fall back to priority order, documented as such.
      return { score: priorityTerm, reason: `cheap: no cost model yet, using provider priority ${route.providerPriority}`, details };
    case "priority":
      return { score: priorityTerm, reason: `priority: provider order ${route.providerPriority}`, details };
    case "auto":
    default: {
      const r = remaining ?? 0.5;
      const score = 0.35 * r + 0.25 * urgency * r + 0.2 * reliability + 0.15 * latency + 0.05 * priorityTerm;
      return {
        score,
        reason: `auto: ${remaining == null ? "unknown quota" : `${Math.round(r * 100)}% remaining`}${resetDays == null ? "" : `, resets in ${resetDays}d`}, reliability ${reliability.toFixed(2)}`,
        details,
      };
    }
  }
}

export const POLICIES: RoutingPolicyName[] = [
  "auto",
  "burn",
  "preserve",
  "fast",
  "reliable",
  "cheap",
  "priority",
];
