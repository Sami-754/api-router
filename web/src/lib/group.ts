import type { RequestLog } from "./types";

export interface RequestGroup {
  id: string;
  logs: RequestLog[];
  last: RequestLog;
  success: boolean;
  attempts: number;
  createdAt: string;
  totalTokens: number;
}

function attemptOf(log: RequestLog): number {
  const match = /:attempt(\d+)$/.exec(log.id);
  return match ? Number(match[1]) : log.attempts || 0;
}

export function groupRequests(logs: RequestLog[]): RequestGroup[] {
  const groups = new Map<string, RequestLog[]>();
  for (const log of logs) {
    const base = log.id.split(":attempt")[0] || log.id;
    const list = groups.get(base);
    if (list) list.push(log);
    else groups.set(base, [log]);
  }
  return [...groups.entries()]
    .map(([id, entries]) => {
      const ordered = [...entries].sort((a, b) => attemptOf(a) - attemptOf(b));
      const last = ordered[ordered.length - 1] as RequestLog;
      return {
        id,
        logs: ordered,
        last,
        success: ordered.some((entry) => entry.status === "success"),
        attempts: Math.max(
          ...ordered.map((entry) => entry.attempts || 0),
          ordered.length,
        ),
        createdAt: ordered[0]?.createdAt ?? last.createdAt,
        totalTokens: ordered.reduce(
          (sum, entry) => sum + (entry.totalTokens ?? 0),
          0,
        ),
      };
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export interface CountStat {
  requests: number;
  errors: number;
  totalLatency: number;
  ok: number;
}

export function stats24hBy<T extends string>(
  logs: RequestLog[],
  keyOf: (log: RequestLog) => T | null | undefined,
): Map<T, CountStat> {
  const since = Date.now() - 86_400_000;
  const map = new Map<T, CountStat>();
  for (const log of logs) {
    if (Date.parse(log.createdAt) < since) continue;
    const key = keyOf(log);
    if (!key) continue;
    const stat = map.get(key) ?? {
      requests: 0,
      errors: 0,
      totalLatency: 0,
      ok: 0,
    };
    stat.requests += 1;
    if (log.status === "success") {
      stat.ok += 1;
      stat.totalLatency += log.latencyMs || 0;
    } else {
      stat.errors += 1;
    }
    map.set(key, stat);
  }
  return map;
}

export function successRate(stat?: CountStat): number | null {
  if (!stat || !stat.requests) return null;
  return stat.ok / stat.requests;
}

export function avgLatency(stat?: CountStat): number | null {
  if (!stat || !stat.ok) return null;
  return stat.totalLatency / stat.ok;
}

export function errorRateLastHour(logs: RequestLog[]): {
  total: number;
  errors: number;
  rate: number | null;
} {
  const since = Date.now() - 3_600_000;
  let total = 0;
  let errors = 0;
  for (const log of logs) {
    if (Date.parse(log.createdAt) < since) continue;
    total += 1;
    if (log.status !== "success") errors += 1;
  }
  return { total, errors, rate: total ? errors / total : null };
}

export function hourlyBuckets(
  logs: RequestLog[],
): Array<{ ok: number; bad: number }> {
  const buckets = Array.from({ length: 24 }, () => ({ ok: 0, bad: 0 }));
  const now = Date.now();
  for (const log of logs) {
    const ms = now - Date.parse(log.createdAt);
    if (Number.isNaN(ms) || ms < 0 || ms >= 24 * 3600 * 1000) continue;
    const index = 23 - Math.min(23, Math.floor(ms / 3_600_000));
    const bucket = buckets[index];
    if (!bucket) continue;
    if (log.status === "success") bucket.ok += 1;
    else bucket.bad += 1;
  }
  return buckets;
}
