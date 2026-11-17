import { Link } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { useRefresh } from "../lib/refresh";
import {
  fmtAgo,
  fmtCountdown,
  fmtLatency,
  fmtNum,
  fmtPct,
  quotaPct,
  shortModel,
} from "../lib/format";
import {
  errorRateLastHour,
  groupRequests,
  hourlyBuckets,
  stats24hBy,
  successRate,
} from "../lib/group";
import type {
  AdapterInfo,
  Credential,
  Overview,
  Provider,
  QuotaWindow,
  RequestLog,
} from "../lib/types";
import { Icon, type IconName } from "../components/Icon";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  QuotaBar,
  Section,
  Skeleton,
  StatusPill,
  statusTone,
} from "../components/ui";

interface AttentionItem {
  tone: "bad" | "warn" | "info";
  icon: IconName;
  title: string;
  meta: string;
  to: string;
}

function AttentionIcon({
  tone,
  icon,
}: {
  tone: AttentionItem["tone"];
  icon: IconName;
}) {
  return (
    <span
      className={`attention-item__icon${tone === "warn" ? " attention-item__icon--warn" : tone === "info" ? " attention-item__icon--info" : ""}`}
    >
      <Icon name={icon} size={13} />
    </span>
  );
}

export function DashboardPage() {
  const { bump } = useRefresh();
  const overview = useApi<Overview>("/api/overview", { pollMs: 15_000 });
  const logs = useApi<RequestLog[]>("/api/requests?limit=500", {
    pollMs: 15_000,
  });
  const providers = useApi<Provider[]>("/api/providers", { pollMs: 15_000 });
  const credentials = useApi<Credential[]>("/api/credentials", {
    pollMs: 15_000,
  });
  const quotas = useApi<QuotaWindow[]>("/api/quotas", { pollMs: 15_000 });
  const routeCounts = useApi<Record<string, number>>("/api/routes/counts", {
    pollMs: 15_000,
  });
  const adapters = useApi<AdapterInfo[]>("/api/adapters", { pollMs: 15_000 });

  const firstError =
    overview.error ||
    logs.error ||
    providers.error ||
    credentials.error ||
    quotas.error ||
    routeCounts.error ||
    adapters.error;
  const loading = [
    overview,
    logs,
    providers,
    credentials,
    quotas,
    routeCounts,
    adapters,
  ].some((state) => state.loading && !state.data);

  if (loading) {
    return (
      <div className="page">
        <PageHeader
          title="Dashboard"
          subtitle="Quota-aware routing across providers, accounts and keys."
        />
        <Skeleton rows={7} />
      </div>
    );
  }

  const providerList = providers.data ?? [];
  const credentialList = credentials.data ?? [];
  const logList = logs.data ?? [];
  const quotaList = quotas.data ?? [];
  const adapterIds = new Set(
    (adapters.data ?? []).map((adapter) => adapter.id),
  );
  const providerStats = stats24hBy(logList, (log) => log.selectedProviderId);
  const groups = groupRequests(logList);
  const activity = hourlyBuckets(logList);
  const errorHour = errorRateLastHour(logList);
  const maxBucket = Math.max(
    1,
    ...activity.map((bucket) => bucket.ok + bucket.bad),
  );
  const activityTotal = activity.reduce(
    (sum, bucket) => sum + bucket.ok + bucket.bad,
    0,
  );
  const activeKeys = credentialList.filter(
    (credential) => credential.status === "active",
  ).length;
  const invalidKeys = credentialList.filter(
    (credential) => credential.status === "invalid",
  );
  const routeTotal = Object.values(routeCounts.data ?? {}).reduce(
    (sum, count) => sum + count,
    0,
  );

  const attention: AttentionItem[] = [];
  if (invalidKeys.length) {
    attention.push({
      tone: "bad",
      icon: "alert",
      title: `${invalidKeys.length} invalid key${invalidKeys.length === 1 ? "" : "s"}`,
      meta: invalidKeys
        .slice(0, 3)
        .map((credential) => credential.id)
        .join(", "),
      to: "/providers",
    });
  }
  const lowQuota = quotaList.filter((quota) => {
    const pct = quotaPct(quota);
    return pct !== null && pct < 10 && quota.hard;
  });
  if (lowQuota.length) {
    attention.push({
      tone: "warn",
      icon: "bolt",
      title: `${lowQuota.length} hard quota window${lowQuota.length === 1 ? "" : "s"} below 10%`,
      meta: lowQuota
        .slice(0, 2)
        .map((quota) => `${quota.credentialId} · ${quota.metric}`)
        .join(", "),
      to: "/providers",
    });
  }
  if (errorHour.total >= 5 && (errorHour.rate ?? 0) > 0.2) {
    attention.push({
      tone: "bad",
      icon: "alert",
      title: `${Math.round((errorHour.rate ?? 0) * 100)}% error rate in the last hour`,
      meta: `${errorHour.errors} of ${errorHour.total} requests failed`,
      to: "/requests?status=error",
    });
  }
  const missingAdapters = providerList.filter(
    (provider) => provider.enabled && !adapterIds.has(provider.id),
  );
  if (missingAdapters.length) {
    attention.push({
      tone: "warn",
      icon: "plug",
      title: `${missingAdapters.length} enabled provider${missingAdapters.length === 1 ? "" : "s"} without an adapter`,
      meta: `${missingAdapters
        .slice(0, 3)
        .map((provider) => provider.id)
        .join(", ")} — restart after adding an adapter`,
      to: "/providers",
    });
  }
  const emptyProviders = providerList.filter((provider) => {
    if (!provider.enabled) return false;
    return !credentialList.some(
      (credential) =>
        credential.providerId === provider.id && credential.status === "active",
    );
  });
  if (emptyProviders.length) {
    attention.push({
      tone: "info",
      icon: "key",
      title: `${emptyProviders.length} enabled provider${emptyProviders.length === 1 ? "" : "s"} without active keys`,
      meta: emptyProviders
        .slice(0, 3)
        .map((provider) => provider.id)
        .join(", "),
      to: "/providers",
    });
  }

  const credentialById = new Map(
    credentialList.map((credential) => [credential.id, credential]),
  );
  const watch = [...quotaList]
    .filter(
      (quota) =>
        quotaPct(quota) !== null &&
        (quota.remainingValue ?? quota.limitValue - quota.usedValue) > 0,
    )
    .sort((a, b) => {
      const aReset = a.resetAt
        ? Date.parse(a.resetAt)
        : Number.MAX_SAFE_INTEGER;
      const bReset = b.resetAt
        ? Date.parse(b.resetAt)
        : Number.MAX_SAFE_INTEGER;
      return aReset - bReset;
    })
    .slice(0, 6);

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        subtitle="Quota-aware routing across providers, accounts and keys."
        actions={
          <>
            <Link className="btn btn--ghost btn--sm" to="/requests">
              All requests
              <Icon name="arrow-right" size={14} />
            </Link>
            <Button size="sm" variant="secondary" icon="refresh" onClick={bump}>
              Refresh
            </Button>
          </>
        }
      />

      {firstError && <ErrorState message={firstError} onRetry={bump} />}

      <div style={{ marginTop: firstError ? 12 : 0 }}>
        {attention.length ? (
          <div className="attention">
            <div className="attention__head">
              <Icon name="alert" size={14} />
              Attention
              <Badge tone="warn">{attention.length}</Badge>
            </div>
            {attention.slice(0, 5).map((item, index) => (
              <div className="attention-item" key={`${item.title}-${index}`}>
                <AttentionIcon tone={item.tone} icon={item.icon} />
                <div className="attention-item__text">
                  <strong>{item.title}</strong>
                  <div className="attention-item__meta">{item.meta}</div>
                </div>
                <Link className="attention-item__link" to={item.to}>
                  Open
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="attention-clear">
            <span className="status-dot" />
            All clear — no invalid keys, exhausted quotas, or error spikes.
          </div>
        )}
      </div>

      <div className="metric-strip">
        <div className="metric">
          <div className="metric__value">
            {fmtNum(overview.data?.requests24h)}
          </div>
          <div className="metric__label">Requests · 24h</div>
          <div className="metric__sub">
            {overview.data?.successRate24h != null
              ? `${fmtPct(overview.data.successRate24h)} success`
              : "no traffic yet"}
          </div>
        </div>
        <div className="metric">
          <div className="metric__value">
            {fmtNum(overview.data?.tokens24h)}
          </div>
          <div className="metric__label">Tokens · 24h</div>
          <div className="metric__sub">prompt + completion</div>
        </div>
        <div className="metric">
          <div className="metric__value">
            {activeKeys}
            <span className="muted" style={{ fontSize: 14 }}>
              /{credentialList.length}
            </span>
          </div>
          <div className="metric__label">Active keys</div>
          <div className="metric__sub">
            {invalidKeys.length ? (
              <span className="text-bad">{invalidKeys.length} invalid</span>
            ) : (
              "all credentials valid"
            )}
          </div>
        </div>
        <div className="metric">
          <div className="metric__value">{fmtNum(routeTotal)}</div>
          <div className="metric__label">Executable routes</div>
          <div className="metric__sub">
            {fmtNum(overview.data?.mappings ?? 0)} provider mappings
          </div>
        </div>
        <div className="metric">
          <div className="metric__value">
            {overview.data?.providers ?? providerList.length}
          </div>
          <div className="metric__label">Providers</div>
          <div className="metric__sub">
            {overview.data?.providersEnabled ?? "—"} enabled
          </div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="panel activity">
          <div className="panel__head">
            <span className="panel__title">Requests · last 24h</span>
            <div className="legend">
              <span className="legend__item">
                <span className="legend__swatch" /> success
              </span>
              <span className="legend__item">
                <span className="legend__swatch legend__swatch--bad" /> error
              </span>
            </div>
          </div>
          {activityTotal ? (
            <>
              <div className="activity__bars">
                {activity.map((bucket, index) => {
                  const total = bucket.ok + bucket.bad;
                  const height = total
                    ? Math.max(2, Math.round((100 * total) / maxBucket))
                    : 0;
                  const badShare = total
                    ? Math.round((bucket.bad / total) * height)
                    : 0;
                  const okHeight = Math.max(0, height - badShare);
                  return (
                    <div
                      className="activity__col"
                      key={index}
                      title={`${bucket.ok} ok · ${bucket.bad} failed`}
                    >
                      <span
                        className="activity__bar activity__bar--bad"
                        style={{ height: badShare }}
                      />
                      <span
                        className="activity__bar"
                        style={{ height: okHeight }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="activity__axis">
                <span>24h ago</span>
                <span>12h</span>
                <span>now</span>
              </div>
              <p className="table-note">
                Bar heights use the latest 500 request attempts.
              </p>
            </>
          ) : (
            <EmptyState
              title="No requests in the last 24h"
              message="The activity chart fills in as traffic arrives through /v1 or the Playground."
              icon="gauge"
            />
          )}
        </div>

        <div className="panel">
          <div className="panel__head">
            <span className="panel__title">Quota watch</span>
            <Link className="attention-item__link" to="/providers">
              Manage
            </Link>
          </div>
          {watch.length ? (
            <div className="quota-watch">
              {watch.map((quota) => {
                const credential = credentialById.get(quota.credentialId);
                return (
                  <div className="watch-row" key={quota.id}>
                    <div className="watch-row__top">
                      <span className="watch-row__provider">
                        {credential
                          ? `${credential.providerId} · ${credential.label || credential.id}`
                          : quota.credentialId}
                      </span>
                      <span className="watch-row__reset">
                        {fmtCountdown(quota.resetAt)}
                      </span>
                    </div>
                    <div className="watch-row__bottom">
                      <QuotaBar quota={quota} />
                      <span className="quota-label__metric">
                        {quota.metric}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No quota windows"
              message="Quota windows live on provider keys. Add one to make burn-aware routing visible."
              icon="bolt"
            />
          )}
        </div>
      </div>

      <Section
        title="Provider health"
        description="24h stats are derived from request history."
        actions={
          <Link className="btn btn--ghost btn--sm" to="/providers">
            Manage providers
          </Link>
        }
      >
        {providerList.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>State</th>
                  <th>Adapter</th>
                  <th>Keys</th>
                  <th className="cell-num">24h requests</th>
                  <th className="cell-num">Success</th>
                </tr>
              </thead>
              <tbody>
                {providerList
                  .slice()
                  .sort(
                    (a, b) =>
                      a.priority - b.priority || a.id.localeCompare(b.id),
                  )
                  .map((provider) => {
                    const keys = credentialList.filter(
                      (credential) => credential.providerId === provider.id,
                    );
                    const active = keys.filter(
                      (credential) => credential.status === "active",
                    ).length;
                    const stat = providerStats.get(provider.id);
                    const rate = successRate(stat);
                    return (
                      <tr key={provider.id}>
                        <td>
                          <div className="cell-main">
                            <Link
                              className="cell-main__title"
                              to={`/providers/${encodeURIComponent(provider.id)}`}
                            >
                              {provider.displayName || provider.id}
                            </Link>
                            <span className="cell-main__sub">
                              {provider.id}
                            </span>
                          </div>
                        </td>
                        <td>
                          <StatusPill tone={provider.enabled ? "ok" : "warn"}>
                            {provider.enabled ? "enabled" : "disabled"}
                          </StatusPill>
                        </td>
                        <td>
                          {adapterIds.has(provider.id) ? (
                            <Badge tone="ok">registered</Badge>
                          ) : (
                            <Badge tone="warn">missing</Badge>
                          )}
                        </td>
                        <td>
                          <span className="mono">
                            {active}/{keys.length}
                          </span>
                          {keys.some(
                            (credential) => credential.status === "invalid",
                          ) && (
                            <span
                              className="text-bad small"
                              style={{ marginLeft: 6 }}
                            >
                              invalid
                            </span>
                          )}
                        </td>
                        <td className="cell-num">{stat?.requests ?? 0}</td>
                        <td className="cell-num">
                          {rate === null ? "—" : `${Math.round(rate * 100)}%`}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No providers configured"
            message="Provider rows and adapters are added on the backend. Once one exists, add keys from its provider page."
            icon="plug"
          />
        )}
      </Section>

      <Section
        title="Recent requests"
        description="Grouped by logical request; open a row in Requests for the attempt chain."
        actions={
          <Link className="btn btn--ghost btn--sm" to="/requests">
            View all
            <Icon name="arrow-right" size={14} />
          </Link>
        }
      >
        {groups.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Model</th>
                  <th>Route</th>
                  <th>Status</th>
                  <th className="cell-num">Attempts</th>
                  <th className="cell-num">Tokens</th>
                  <th className="cell-num">Latency</th>
                </tr>
              </thead>
              <tbody>
                {groups.slice(0, 8).map((group) => (
                  <tr key={group.id}>
                    <td
                      className="cell-mono cell-muted"
                      title={group.createdAt}
                    >
                      {fmtAgo(group.createdAt)}
                    </td>
                    <td>
                      <Link
                        className="cell-main__title"
                        to={`/requests?id=${encodeURIComponent(group.id)}`}
                      >
                        {shortModel(group.last.requestedResourceId) ||
                          group.last.requestedCapability ||
                          "—"}
                      </Link>
                    </td>
                    <td className="cell-mono cell-muted">
                      {group.last.selectedProviderId ? (
                        <>
                          {group.last.selectedProviderId}
                          <span className="muted">
                            /{group.last.selectedUpstreamId || ""}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <StatusPill
                        tone={statusTone(group.success ? "success" : "error")}
                      >
                        {group.success ? "success" : "error"}
                      </StatusPill>
                    </td>
                    <td className="cell-num">{group.attempts || "—"}</td>
                    <td className="cell-num">{fmtNum(group.totalTokens)}</td>
                    <td className="cell-num">
                      {fmtLatency(group.last.latencyMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No requests yet"
            message="Send a request from the Playground or point a client at /v1."
            action={
              <Link className="btn btn--primary btn--sm" to="/playground">
                Open Playground
              </Link>
            }
            icon="terminal"
          />
        )}
      </Section>
    </div>
  );
}
