import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { useRefresh } from "../lib/refresh";
import { api } from "../lib/api";
import { fmtNum, isAliasResource, isFreeId, shortModel } from "../lib/format";
import { CAPABILITIES } from "../lib/constants";
import type {
  ModelSyncSummary,
  Provider,
  ProviderResource,
  Resource,
} from "../lib/types";
import { useToast } from "../components/ToastProvider";
import {
  Badge,
  Button,
  CopyButton,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  ProviderChip,
  Section,
  Skeleton,
  Tabs,
} from "../components/ui";

const PAGE_SIZE = 50;

export function ModelsPage() {
  const { bump } = useRefresh();
  const { notify } = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "tools" ? "tools" : "models";

  const resources = useApi<Resource[]>("/api/resources");
  const mappings = useApi<ProviderResource[]>("/api/provider-resources");
  const providers = useApi<Provider[]>("/api/providers");
  const routeCounts = useApi<Record<string, number>>("/api/routes/counts");

  const [query, setQuery] = useState("");
  const [capFilter, setCapFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState(
    params.get("provider") ?? "",
  );
  const [freeOnly, setFreeOnly] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setProviderFilter(params.get("provider") ?? "");
    setPage(1);
  }, [params]);
  const [syncing, setSyncing] = useState(false);

  const setTab = (next: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
    setPage(1);
  };

  const mappingsByResource = useMemo(() => {
    const map = new Map<string, ProviderResource[]>();
    for (const mapping of mappings.data ?? []) {
      const list = map.get(mapping.resourceId);
      if (list) list.push(mapping);
      else map.set(mapping.resourceId, [mapping]);
    }
    return map;
  }, [mappings.data]);

  const error =
    resources.error || mappings.error || providers.error || routeCounts.error;
  const loading = [resources, mappings, providers, routeCounts].some(
    (state) => state.loading && !state.data,
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const kind = tab === "tools" ? "capability" : "llm_model";
    return (resources.data ?? [])
      .filter((resource) => resource.kind === kind)
      .filter((resource) => {
        if (capFilter && !resource.capabilities.includes(capFilter as never))
          return false;
        const resourceMappings = mappingsByResource.get(resource.id) ?? [];
        if (
          providerFilter &&
          !resourceMappings.some(
            (mapping) => mapping.providerId === providerFilter,
          )
        )
          return false;
        if (
          freeOnly &&
          !isFreeId(resource.id) &&
          !resourceMappings.some((mapping) => isFreeId(mapping.upstreamId))
        )
          return false;
        if (needle) {
          const haystack =
            `${resource.id} ${resource.displayName} ${resourceMappings
              .map((mapping) => mapping.upstreamId)
              .join(" ")}`.toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aliasA = isAliasResource(a) ? 0 : 1;
        const aliasB = isAliasResource(b) ? 0 : 1;
        if (aliasA !== aliasB) return aliasA - aliasB;
        return (
          a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id)
        );
      });
  }, [
    resources.data,
    tab,
    capFilter,
    providerFilter,
    freeOnly,
    query,
    mappingsByResource,
  ]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const syncModels = async () => {
    setSyncing(true);
    try {
      const summary = await api.post<ModelSyncSummary>("/api/maintenance/sync");
      notify(
        `Sync complete — ${summary.mapped} mappings, ${summary.pruned} pruned${
          summary.skipped.length
            ? `, skipped: ${summary.skipped.join(", ")}`
            : ""
        }`,
        "ok",
      );
      bump();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <PageHeader
          title="Models"
          subtitle="Canonical resources and the providers that serve them."
        />
        <Skeleton rows={8} />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Models"
        subtitle="Canonical models and tool capabilities come from provider catalogs and the backend. Open one to inspect routes, keys and quotas."
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            busy={syncing}
            onClick={syncModels}
            title="Pull live model catalogs from every provider with a base URL and key"
          >
            Sync models
          </Button>
        }
      />

      <div className="row row--between" style={{ marginBottom: 12 }}>
        <Tabs
          label="Resource kind"
          value={tab}
          onChange={setTab}
          items={[
            {
              id: "models",
              label: "Models",
              count: (resources.data ?? []).filter(
                (resource) => resource.kind === "llm_model",
              ).length,
            },
            {
              id: "tools",
              label: "Tools",
              count: (resources.data ?? []).filter(
                (resource) => resource.kind === "capability",
              ).length,
            },
          ]}
        />
        <span className="muted small">
          {tab === "models" ? "LLM models" : "Capability resources"} ·{" "}
          {filtered.length} shown
        </span>
      </div>

      {error && <ErrorState message={error} onRetry={bump} />}

      <div className="filters-bar">
        <label className="field field--search">
          <span className="field__label">Search</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="model, upstream id, provider…"
          />
        </label>
        <label className="field">
          <span className="field__label">Capability</span>
          <select
            value={capFilter}
            onChange={(event) => {
              setCapFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">all</option>
            {CAPABILITIES.map((capability) => (
              <option key={capability} value={capability}>
                {capability}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Provider</span>
          <select
            value={providerFilter}
            onChange={(event) => {
              setProviderFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">all</option>
            {(providers.data ?? []).map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.id}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={freeOnly}
            onChange={(event) => {
              setFreeOnly(event.target.checked);
              setPage(1);
            }}
          />
          free only
        </label>
        {(query || capFilter || providerFilter || freeOnly) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setCapFilter("");
              setProviderFilter("");
              setFreeOnly(false);
              setPage(1);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <Section>
        {rows.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{tab === "tools" ? "Capability" : "Model"}</th>
                    <th>Providers</th>
                    <th>Capabilities</th>
                    <th className="cell-num">Routes</th>
                    <th>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((resource) => {
                    const resourceMappings =
                      mappingsByResource.get(resource.id) ?? [];
                    const providerIds = [
                      ...new Set(
                        resourceMappings.map((mapping) => mapping.providerId),
                      ),
                    ];
                    const free =
                      isFreeId(resource.id) ||
                      resourceMappings.some((mapping) =>
                        isFreeId(mapping.upstreamId),
                      );
                    const alias = isAliasResource(resource);
                    return (
                      <tr key={resource.id}>
                        <td>
                          <div className="cell-main">
                            <span className="row" style={{ gap: 6 }}>
                              <Link
                                className="cell-main__title"
                                to={`/models/${encodeURIComponent(resource.id)}`}
                              >
                                {resource.displayName ||
                                  shortModel(resource.id)}
                              </Link>
                              <CopyButton value={resource.id} compact />
                              {alias && <Badge tone="accent">alias</Badge>}
                            </span>
                            <span className="cell-main__sub">
                              {resource.id}
                              {resource.contextTokens
                                ? ` · ${fmtNum(resource.contextTokens)} ctx`
                                : ""}
                            </span>
                          </div>
                        </td>
                        <td>
                          {providerIds.length ? (
                            <>
                              {providerIds.slice(0, 5).map((providerId) => (
                                <ProviderChip
                                  key={providerId}
                                  id={providerId}
                                />
                              ))}
                              {providerIds.length > 5 && (
                                <span className="muted small">
                                  +{providerIds.length - 5}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="muted">unmapped</span>
                          )}
                        </td>
                        <td className="cell-mono cell-muted">
                          {(resource.capabilities ?? []).join(" · ") || "—"}
                        </td>
                        <td className="cell-num">
                          {routeCounts.data?.[resource.id] ?? 0}
                        </td>
                        <td>
                          <div className="row" style={{ gap: 4 }}>
                            {free && <Badge tone="ok">free</Badge>}
                            {!resourceMappings.length && (
                              <Badge tone="warn">no routes</Badge>
                            )}
                            {resourceMappings.length > 0 && !free && (
                              <span className="muted small">
                                {resourceMappings.length} mapped
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={currentPage}
              pageCount={pageCount}
              onChange={setPage}
              total={filtered.length}
            />
          </>
        ) : (
          <EmptyState
            title={
              tab === "tools"
                ? "No tool capabilities matched"
                : "No models matched"
            }
            message={
              (resources.data ?? []).length
                ? "Adjust the filters, or sync the provider catalogs."
                : "Model mappings and tool capabilities are created by the backend. Sync provider catalogs to refresh them."
            }
            action={
              <Button
                variant="secondary"
                size="sm"
                icon="refresh"
                busy={syncing}
                onClick={syncModels}
              >
                Sync models
              </Button>
            }
            icon="cube"
          />
        )}
      </Section>
    </div>
  );
}
