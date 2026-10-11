import type { QuotaWindow, Route } from "../shared/types.js";
import type { Store } from "./store.js";

export interface QuotaView {
  windows: QuotaWindow[];
  exhausted: boolean;
  exhaustedReasons: string[];
  /** Remaining fraction 0..1 across the most constrained hard window, or null if unknown. */
  remainingFraction: number | null;
  /** Soonest reset among windows with a resetAt, or null. */
  soonestResetAt: string | null;
  msUntilReset: number | null;
}

export function remainingFractionOf(w: QuotaWindow): number | null {
  if (w.limitValue <= 0) return null;
  const remaining = w.remainingValue ?? Math.max(0, w.limitValue - w.usedValue);
  return Math.min(1, Math.max(0, remaining / w.limitValue));
}

export function msUntilReset(
  w: QuotaWindow,
  nowMs = Date.now(),
): number | null {
  if (!w.resetAt) return null;
  const t = Date.parse(w.resetAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, t - nowMs);
}

export function quotaViewForRoute(
  store: Store,
  route: Route,
  nowMs = Date.now(),
): QuotaView {
  // Quota windows attach to credentials (optionally scoped to a provider resource).
  // A window scoped to another provider resource does not constrain this route.
  const all = store.listQuotaWindows(route.credentialId);
  const windows = all.filter(
    (w) =>
      !w.providerResourceId ||
      w.providerResourceId === route.providerResourceId,
  );
  const exhaustedReasons: string[] = [];
  let minFraction: number | null = null;
  let soonestResetAt: string | null = null;
  let msReset: number | null = null;

  for (const w of windows) {
    // Rate windows are evaluated live from usage_events in candidates() —
    // static counters never reset, so they must not hard-block here.
    if (isRateWindow(w)) {
      const ms = msUntilReset(w, nowMs);
      if (ms != null && (msReset == null || ms < msReset)) {
        msReset = ms;
        soonestResetAt = w.resetAt ?? null;
      }
      continue;
    }
    const remaining = w.remainingValue ?? w.limitValue - w.usedValue;
    if (w.hard && remaining <= 0) {
      exhaustedReasons.push(
        `${w.metric} exhausted (${w.usedValue}/${w.limitValue})`,
      );
    }
    const f = remainingFractionOf(w);
    if (f != null)
      minFraction = minFraction == null ? f : Math.min(minFraction, f);
    const ms = msUntilReset(w, nowMs);
    if (ms != null && (msReset == null || ms < msReset)) {
      msReset = ms;
      soonestResetAt = w.resetAt ?? null;
    }
  }
  return {
    windows,
    exhausted: exhaustedReasons.length > 0,
    exhaustedReasons,
    remainingFraction: minFraction,
    soonestResetAt,
    msUntilReset: msReset,
  };
}

// ---------------------------------------------------------------------------
// Rolling rate windows. High-frequency limits (per minute/hour, rolling, and
// router-configured daily caps) are evaluated live from usage_events so they
// reset automatically when the window rolls. Everything else — especially an
// explicit remainingValue, or provider-reported week/month quotas — uses the
// stored used/remaining values instead.
// ---------------------------------------------------------------------------

/** True when a window is enforced live from usage_events. */
export function isRateWindow(
  w: Pick<
    QuotaWindow,
    "windowKind" | "windowSeconds" | "remainingValue" | "source"
  >,
): boolean {
  // An explicit remaining value is always authoritative.
  if (w.remainingValue != null) return false;
  if (w.windowKind === "rolling_seconds") return w.windowSeconds != null;
  if (w.windowKind === "calendar_minute" || w.windowKind === "calendar_hour")
    return true;
  if (w.windowKind === "calendar_day") {
    return (
      w.source === "configured" ||
      w.source === "learned" ||
      w.source === "estimated"
    );
  }
  return false;
}

/** Start of the current window in ms epoch, or null when the window is static. */
export function rateWindowStartMs(
  w: Pick<QuotaWindow, "windowKind" | "windowSeconds">,
  nowMs: number,
): number | null {
  const d = new Date(nowMs);
  switch (w.windowKind) {
    case "rolling_seconds":
      if (!w.windowSeconds) return null;
      return nowMs - w.windowSeconds * 1000;
    case "calendar_minute":
      d.setSeconds(0, 0);
      return d.getTime();
    case "calendar_hour":
      d.setMinutes(0, 0, 0);
      return d.getTime();
    case "calendar_day":
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    default:
      return null; // calendar_week/month/fixed are static (provider-reported)
  }
}

export interface RateCheck {
  window: QuotaWindow;
  used: number;
  remaining: number;
  windowStartIso: string;
}

/** Live usage for every hard rate window constraining a credential. */
export function rateChecksFor(
  store: import("./store.js").Store,
  credentialId: string,
  providerResourceId: string | null,
  nowMs = Date.now(),
): RateCheck[] {
  const out: RateCheck[] = [];
  for (const w of store.listQuotaWindows(credentialId)) {
    if (!w.hard) continue;
    if (w.providerResourceId && w.providerResourceId !== providerResourceId)
      continue;
    if (!isRateWindow(w)) continue;
    const startMs = rateWindowStartMs(w, nowMs);
    if (startMs == null) continue;
    const used = store.sumUsage(
      credentialId,
      w.metric,
      new Date(startMs).toISOString(),
      w.providerResourceId ?? undefined,
    );
    out.push({
      window: w,
      used,
      remaining: w.limitValue - used,
      windowStartIso: new Date(startMs).toISOString(),
    });
  }
  return out;
}
