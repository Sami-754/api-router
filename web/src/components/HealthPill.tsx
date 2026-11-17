import { isCooldown } from "../lib/format";
import type { HealthSnapshot } from "../lib/types";
import { StatusPill } from "./ui";

export function HealthPill({ health }: { health?: HealthSnapshot | null }) {
  if (!health) return <span className="muted">—</span>;
  if (isCooldown(health.cooldownUntil)) {
    return (
      <StatusPill tone="warn">
        cooldown{health.lastErrorClass ? ` · ${health.lastErrorClass}` : ""}
      </StatusPill>
    );
  }
  if (health.consecutiveFailures > 0) {
    return (
      <StatusPill tone="warn">
        {health.consecutiveFailures} fail
        {health.consecutiveFailures === 1 ? "" : "s"}
      </StatusPill>
    );
  }
  return <StatusPill tone="ok">healthy</StatusPill>;
}
