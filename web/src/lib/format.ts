import type { QuotaWindow } from "./types";

export function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function fmtAgo(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  if (ms < 0) return fmtCountdown(iso) === "now" ? "now" : fmtTime(iso);
  const s = Math.floor(ms / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtTime(iso).split(",")[0];
}

export function fmtCountdown(iso?: string | null): string {
  if (!iso) return "no reset";
  const ms = Date.parse(iso) - Date.now();
  if (Number.isNaN(ms)) return iso;
  if (ms <= 0) return "now";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return "<1m";
}

const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function fmtNum(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  if (Math.abs(value) >= 10000) return compact.format(value);
  return value.toLocaleString();
}

export function fmtPct(value?: number | null, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function fmtLatency(ms?: number | null): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function shortModel(id?: string | null): string {
  return String(id ?? "").replace(/^llm:model:/, "");
}

export function isFreeId(value?: string | null): boolean {
  return /free/i.test(String(value ?? ""));
}

export function isAliasResource(resource: {
  id: string;
  metadata?: Record<string, unknown>;
}): boolean {
  if (resource.id === "llm:model:auto:free") return true;
  return resource.metadata?.alias === true;
}

export function quotaRemaining(q?: QuotaWindow | null): number | null {
  if (!q || !(q.limitValue > 0)) return null;
  const remaining =
    q.remainingValue ?? Math.max(0, q.limitValue - (q.usedValue || 0));
  return Math.max(0, Math.min(1, remaining / q.limitValue));
}

export function quotaPct(q?: QuotaWindow | null): number | null {
  const remaining = quotaRemaining(q);
  if (remaining === null) return null;
  return Math.round(remaining * 100);
}

export function quotaTone(q?: QuotaWindow | null): "ok" | "warn" | "bad" {
  const pct = quotaPct(q);
  if (pct === null) return "ok";
  if (pct < 10) return "bad";
  if (pct < 25) return "warn";
  return "ok";
}

export function primaryQuota(quotas: QuotaWindow[] = []): QuotaWindow | null {
  if (!quotas.length) return null;
  const sorted = [...quotas].sort((a, b) => {
    if (a.hard !== b.hard) return a.hard ? -1 : 1;
    const ar = a.resetAt ? Date.parse(a.resetAt) : Number.MAX_SAFE_INTEGER;
    const br = b.resetAt ? Date.parse(b.resetAt) : Number.MAX_SAFE_INTEGER;
    return ar - br;
  });
  return sorted[0] ?? null;
}

export function hostOf(url?: string | null): string {
  if (!url) return "—";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function isCooldown(until?: string | null): boolean {
  return Boolean(until && Date.parse(until) > Date.now());
}
