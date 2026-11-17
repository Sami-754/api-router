import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useApi } from "../lib/hooks";
import {
  fmtCountdown,
  fmtLatency,
  fmtNum,
  isAliasResource,
  isCooldown,
  isFreeId,
  primaryQuota,
  shortModel,
} from "../lib/format";
import type {
  Capability,
  ProviderResource,
  Resource,
  Route,
} from "../lib/types";
import { useConfirm } from "../components/ConfirmProvider";
import { useToast } from "../components/ToastProvider";
import { HealthPill } from "../components/HealthPill";
import { Icon } from "../components/Icon";
import {
  Badge,
  Button,
  CopyButton,
  EmptyState,
  ErrorState,
  PageHeader,
  ProviderChip,
  QuotaBar,
  Section,
  Skeleton,
  Tabs,
} from "../components/ui";

function RouteRow({ route, showPin }: { route: Route; showPin?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const primary = primaryQuota(route.quotas);
  return (
    <>
      <tr>
        <td>
          <div className="key-meta">
            <span className="key-meta__id">{route.credentialId}</span>
            <span className="key-meta__label">{route.accountId}</span>
          </div>
        </td>
        <td>
          <div className="row" style={{ gap: 5 }}>
            <QuotaBar quota={primary} />
            {route.quotas.length > 1 && (
              <button
                type="button"
                className="copy-btn"
                onClick={() => setExpanded((value) => !value)}
                aria-label="Toggle quota windows"
              >
                <Icon
                  name={expanded ? "chevron-down" : "chevron-right"}
                  size={12}
                />
                {route.quotas.length}
              </button>
            )}
          </div>
        </td>
        <td className="cell-muted small">{primary?.metric ?? "—"}</td>
        <td className="cell-mono cell-muted">
          {fmtCountdown(primary?.resetAt)}
        </td>
        <td>
          <HealthPill health={route.health} />
        </td>
        <td className="cell-num">{fmtLatency(route.health?.latencyEmaMs)}</td>
        <td className="cell-actions">
          {showPin && <CopyButton value={route.credentialId} compact />}
          <button
            type="button"
            className="copy-btn"
            onClick={() => setExpanded((value) => !value)}
            aria-label="Toggle route details"
          >
            <Icon
              name={expanded ? "chevron-down" : "chevron-right"}
              size={13}
            />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="route-expand">
          <td colSpan={7}>
            <div className="route-expand__inner">
              <div>
                <div className="drawer-heading">Quota windows</div>
                {route.quotas.length ? (
                  route.quotas.map((quota) => (
                    <div className="quota-window-row" key={quota.id}>
                      <span className="quota-window-row__metric">
                        {quota.metric}
                      </span>
                      <QuotaBar quota={quota} />
                      <span className="quota-window-row__reset">
                        {fmtCountdown(quota.resetAt)}
                      </span>
                      {quota.hard && <Badge tone="warn">hard</Badge>}
                    </div>
                  ))
                ) : (
                  <p className="muted small">No quota windows for this key.</p>
                )}
              </div>
              <div>
                <div className="drawer-heading">Health</div>
                <div className="stack small">
                  <span>
                    Success:{" "}
                    <span className="mono">
                      {route.health?.successCount ?? 0}
                    </span>{" "}
                    · Failures:{" "}
                    <span className="mono">
                      {route.health?.failureCount ?? 0}
                    </span>
                  </span>
                  <span>
                    Last success:{" "}
                    <span className="mono">
                      {route.health?.lastSuccessAt ?? "—"}
                    </span>
                  </span>
                  <span>
                    Last failure:{" "}
                    <span className="mono">
                      {route.health?.lastFailureAt ?? "—"}
                    </span>
                  </span>
                  {route.health?.lastErrorClass && (
                    <span className="text-bad">
                      Last error: {route.health.lastErrorClass}
                    </span>
                  )}
                  <span className="muted">Route: {route.routeId}</span>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MappingGroup({
  mapping,
  routes,
  isAlias,
  onToggle,
  onDelete,
}: {
  mapping: ProviderResource;
  routes: Route[];
  isAlias: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = isAlias && !showAll ? routes.slice(0, 12) : routes;
  const pin = `${mapping.providerId}::${mapping.upstreamId}`;
  return (
    <div className="route-group">
      <div className="route-group__head">
        <div className="route-group__title">
          <ProviderChip id={mapping.providerId} />
          <span className="mono">{mapping.upstreamId}</span>
          {isFreeId(mapping.upstreamId) && <Badge tone="ok">free</Badge>}
          {!mapping.enabled && <Badge tone="warn">disabled</Badge>}
        </div>
        <div className="route-group__meta">
          <Badge>{routes.length} routes</Badge>
          <CopyButton value={pin} label="pin" />
          <Button size="sm" variant="ghost" onClick={onToggle}>
            {mapping.enabled ? "Disable" : "Enable"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            onClick={onDelete}
            aria-label="Delete mapping"
          >
            Delete
          </Button>
        </div>
      </div>
      {routes.length ? (
        <>
          <div className="table-wrap" style={{ borderTop: "none" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account / key</th>
                  <th>Quota</th>
                  <th>Metric</th>
                  <th>Reset</th>
                  <th>Health</th>
                  <th className="cell-num">Latency</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((route) => (
                  <RouteRow
                    key={route.routeId}
                    route={route}
                    showPin={isAlias}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {isAlias && routes.length > 12 && (
            <div className="route-group__foot">
              <button
                type="button"
                className="copy-btn"
                onClick={() => setShowAll((value) => !value)}
              >
                {showAll ? "Show fewer" : `Show all ${routes.length} routes`}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="route-empty">
          No executable routes.{" "}
          <Link to={`/providers/${encodeURIComponent(mapping.providerId)}`}>
            Add an account and key for {mapping.providerId}
          </Link>
          .
        </div>
      )}
    </div>
  );
}

export function ModelDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { notify } = useToast();
  const [cap, setCap] = useState("");
  const [aliasOpen, setAliasOpen] = useState(false);

  const resourceState = useApi<Resource>(
    `/api/resources/${encodeURIComponent(id)}`,
  );
  const mappings = useApi<ProviderResource[]>(
    `/api/provider-resources?resource=${encodeURIComponent(id)}`,
  );
  const resource = resourceState.data;
  const capabilities = (
    resource?.capabilities?.length ? resource.capabilities : ["llm.chat"]
  ) as Capability[];
  const effectiveCap = (
    capabilities.includes(cap as Capability) ? cap : capabilities[0]
  ) as Capability;
  const routes = useApi<Route[]>(
    resource
      ? `/api/routes?resource=${encodeURIComponent(id)}&capability=${encodeURIComponent(effectiveCap)}`
      : null,
  );

  const alias = resource ? isAliasResource(resource) : false;
  const mappingList = mappings.data ?? [];
  const routeList = routes.data ?? [];
  const routesByMapping = useMemo(() => {
    const map = new Map<string, Route[]>();
    for (const route of routes.data ?? []) {
      const list = map.get(route.providerResourceId);
      if (list) list.push(route);
      else map.set(route.providerResourceId, [route]);
    }
    return map;
  }, [routes.data]);

  const routesByProviderUpstream = useMemo(() => {
    const map = new Map<string, Route[]>();
    for (const route of routes.data ?? []) {
      const key = `${route.providerId}::${route.upstreamId}`;
      const list = map.get(key);
      if (list) list.push(route);
      else map.set(key, [route]);
    }
    return map;
  }, [routes.data]);

  const routesForMapping = (mapping: ProviderResource): Route[] =>
    alias
      ? (routesByProviderUpstream.get(
          `${mapping.providerId}::${mapping.upstreamId}`,
        ) ?? [])
      : (routesByMapping.get(mapping.id) ?? []);

  const providerCount = new Set(
    mappingList.map((mapping) => mapping.providerId),
  ).size;
  const keyCount = new Set(routeList.map((route) => route.credentialId)).size;
  const healthyCount = routeList.filter(
    (route) =>
      !isCooldown(route.health?.cooldownUntil) &&
      (route.health?.consecutiveFailures ?? 0) === 0,
  ).length;

  const error = resourceState.error || mappings.error || routes.error;
  const loading =
    [resourceState, mappings].some((state) => state.loading && !state.data) ||
    Boolean(resource && routes.loading && !routes.data);

  if (loading) {
    return (
      <div className="page">
        <PageHeader title="Model" subtitle={id} />
        <Skeleton rows={6} />
      </div>
    );
  }

  if (!resource) {
    return (
      <div className="page">
        <PageHeader
          title="Unknown resource"
          breadcrumb={[{ label: "Models", to: "/models" }]}
        />
        <EmptyState
          title="Resource not found"
          message={id}
          action={
            <Link className="btn btn--primary btn--sm" to="/models">
              Back to models
            </Link>
          }
          icon="cube"
        />
      </div>
    );
  }

  const toggleMapping = async (mapping: ProviderResource) => {
    try {
      await api.patch(
        `/api/provider-resources/${encodeURIComponent(mapping.id)}`,
        {
          enabled: !mapping.enabled,
        },
      );
      notify(`Mapping ${mapping.enabled ? "disabled" : "enabled"}`, "ok");
      mappings.reload();
      routes.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const deleteMapping = async (mapping: ProviderResource) => {
    const ok = await confirm({
      title: "Delete mapping",
      message: `Remove ${mapping.providerId} → ${mapping.upstreamId}? Its executable routes disappear immediately.`,
      confirmLabel: "Delete mapping",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(
        `/api/provider-resources/${encodeURIComponent(mapping.id)}`,
      );
      notify("Mapping deleted", "ok");
      mappings.reload();
      routes.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const deleteResource = async () => {
    const ok = await confirm({
      title: "Delete resource",
      message: `Delete ${resource.id} and all ${mappingList.length} provider mappings? This removes every route for it.`,
      confirmLabel: "Delete resource",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/resources/${encodeURIComponent(resource.id)}`);
      notify("Resource deleted", "ok");
      navigate("/models");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const playgroundLink =
    resource.kind === "capability"
      ? `/playground?tab=${encodeURIComponent(effectiveCap.replace(/^web\./, ""))}`
      : `/playground?model=${encodeURIComponent(shortModel(resource.id))}`;

  const sortedMappings = [...mappingList].sort(
    (a, b) =>
      a.providerId.localeCompare(b.providerId) ||
      a.upstreamId.localeCompare(b.upstreamId),
  );

  return (
    <div className="page">
      <PageHeader
        breadcrumb={[
          { label: "Models", to: "/models" },
          { label: shortModel(resource.id) },
        ]}
        title={
          <span className="row row--wrap" style={{ gap: 8 }}>
            {resource.displayName || shortModel(resource.id)}
            {isFreeId(resource.id) && <Badge tone="ok">free</Badge>}
            {alias && <Badge tone="accent">alias</Badge>}
          </span>
        }
        subtitle={
          <span className="row row--wrap" style={{ gap: 6 }}>
            <span className="mono">{resource.id}</span>
            <CopyButton value={resource.id} compact />
            <span className="muted">· {resource.kind}</span>
            {resource.contextTokens ? (
              <span className="muted">
                · {fmtNum(resource.contextTokens)} context
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            <Link className="btn btn--secondary btn--sm" to={playgroundLink}>
              Open in Playground
            </Link>
            <Button
              size="sm"
              variant="danger"
              icon="trash"
              onClick={deleteResource}
            >
              Delete
            </Button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={routes.reload} />}

      <div className="summary-strip">
        <div className="summary-cell">
          <div className="summary-cell__value">{providerCount}</div>
          <div className="summary-cell__label">Providers</div>
        </div>
        <div className="summary-cell">
          <div className="summary-cell__value">{routeList.length}</div>
          <div className="summary-cell__label">Executable routes</div>
        </div>
        <div className="summary-cell">
          <div className="summary-cell__value">{keyCount}</div>
          <div className="summary-cell__label">Keys serving</div>
        </div>
        <div className="summary-cell">
          <div className="summary-cell__value">
            {healthyCount}
            <span className="muted" style={{ fontSize: 12 }}>
              /{routeList.length}
            </span>
          </div>
          <div className="summary-cell__label">Healthy routes</div>
        </div>
      </div>

      {capabilities.length > 1 && (
        <Tabs
          label="Capability"
          value={effectiveCap}
          onChange={setCap}
          items={capabilities.map((capability) => ({
            id: capability,
            label: capability,
          }))}
        />
      )}

      <Section
        title={alias ? "Provider coverage" : "Routes"}
        description={
          alias
            ? "auto:free fans out across every enabled free-tier mapping. Expand the list to inspect individual routes."
            : "Grouped by provider mapping. Quotas and health come from the live routing state."
        }
        actions={
          alias ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAliasOpen((value) => !value)}
            >
              {aliasOpen ? "Hide mapping groups" : "Show mapping groups"}
            </Button>
          ) : undefined
        }
      >
        {!mappingList.length ? (
          <EmptyState
            title="No provider mappings"
            message="Mappings are created by model sync and the backend. Run Sync models in the Models page, or add keys for the provider."
            icon="plug"
          />
        ) : alias && !aliasOpen ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th className="cell-num">Mappings</th>
                  <th className="cell-num">Routes</th>
                  <th>Sample upstream</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...new Set(
                    sortedMappings.map((mapping) => mapping.providerId),
                  ),
                ]
                  .sort()
                  .map((providerId) => {
                    const providerMappings = sortedMappings.filter(
                      (mapping) => mapping.providerId === providerId,
                    );
                    const routeTotal = providerMappings.reduce(
                      (sum, mapping) => sum + routesForMapping(mapping).length,
                      0,
                    );
                    return (
                      <tr key={providerId}>
                        <td>
                          <ProviderChip id={providerId} />
                        </td>
                        <td className="cell-num">{providerMappings.length}</td>
                        <td className="cell-num">{routeTotal}</td>
                        <td className="cell-mono cell-muted">
                          {providerMappings
                            .slice(0, 2)
                            .map((mapping) => mapping.upstreamId)
                            .join(", ")}
                          {providerMappings.length > 2 ? "…" : ""}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="route-groups">
            {sortedMappings.map((mapping) => (
              <MappingGroup
                key={mapping.id}
                mapping={mapping}
                routes={routesForMapping(mapping)}
                isAlias={alias}
                onToggle={() => void toggleMapping(mapping)}
                onDelete={() => void deleteMapping(mapping)}
              />
            ))}
          </div>
        )}
        {alias && !aliasOpen && (
          <p className="table-note">
            Alias rows are derived from source mappings and refreshed on every
            model sync.
          </p>
        )}
      </Section>
    </div>
  );
}
