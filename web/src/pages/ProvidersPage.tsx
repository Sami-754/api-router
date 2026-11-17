import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { useRefresh } from "../lib/refresh";
import { hostOf } from "../lib/format";
import { stats24hBy, successRate } from "../lib/group";
import type {
  AdapterInfo,
  Credential,
  Provider,
  ProviderResource,
  RequestLog,
} from "../lib/types";
import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
  StatusPill,
  statusTone,
} from "../components/ui";

export function ProvidersPage() {
  const { bump } = useRefresh();
  const providers = useApi<Provider[]>("/api/providers");
  const credentials = useApi<Credential[]>("/api/credentials");
  const mappings = useApi<ProviderResource[]>("/api/provider-resources");
  const logs = useApi<RequestLog[]>("/api/requests?limit=500");
  const adapters = useApi<AdapterInfo[]>("/api/adapters");
  const [query, setQuery] = useState("");

  const error =
    providers.error ||
    credentials.error ||
    mappings.error ||
    logs.error ||
    adapters.error;
  const loading = [providers, credentials, mappings, logs, adapters].some(
    (state) => state.loading && !state.data,
  );

  if (loading) {
    return (
      <div className="page">
        <PageHeader
          title="Providers"
          subtitle="Upstreams, accounts and key pools."
        />
        <Skeleton rows={7} />
      </div>
    );
  }

  const providerList = (providers.data ?? []).filter((provider) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${provider.id} ${provider.displayName} ${provider.baseUrl ?? ""}`
      .toLowerCase()
      .includes(needle);
  });
  const credentialList = credentials.data ?? [];
  const mappingList = mappings.data ?? [];
  const logList = logs.data ?? [];
  const adapterIds = new Set(
    (adapters.data ?? []).map((adapter) => adapter.id),
  );
  const stats = stats24hBy(logList, (log) => log.selectedProviderId);

  return (
    <div className="page">
      <PageHeader
        title="Providers"
        subtitle="Providers and adapters are configured on the backend. Open one to add accounts, API keys and quotas."
        actions={
          <Link className="btn btn--primary btn--sm" to="/add">
            Add key
          </Link>
        }
      />

      {error && <ErrorState message={error} onRetry={bump} />}

      <div className="filters-bar">
        <label className="field field--search">
          <span className="field__label">Search</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="provider id, name, base URL…"
          />
        </label>
      </div>

      <Section>
        {providerList.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Base URL</th>
                  <th>State</th>
                  <th>Adapter</th>
                  <th className="cell-num">Priority</th>
                  <th>Keys</th>
                  <th className="cell-num">Mappings</th>
                  <th className="cell-num">24h</th>
                  <th className="cell-num">Success</th>
                  <th />
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
                    const invalid = keys.filter(
                      (credential) => credential.status === "invalid",
                    ).length;
                    const stat = stats.get(provider.id);
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
                        <td className="cell-mono cell-muted">
                          {hostOf(provider.baseUrl)}
                        </td>
                        <td>
                          <StatusPill
                            tone={statusTone(
                              provider.enabled ? "enabled" : "disabled",
                            )}
                          >
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
                        <td className="cell-num">{provider.priority}</td>
                        <td>
                          <span className="mono">
                            {active}/{keys.length}
                          </span>
                          {invalid > 0 && (
                            <span
                              className="text-bad small"
                              style={{ marginLeft: 5 }}
                            >
                              {invalid} invalid
                            </span>
                          )}
                        </td>
                        <td className="cell-num">
                          {
                            mappingList.filter(
                              (mapping) => mapping.providerId === provider.id,
                            ).length
                          }
                        </td>
                        <td className="cell-num">{stat?.requests ?? 0}</td>
                        <td className="cell-num">
                          {rate === null ? "—" : `${Math.round(rate * 100)}%`}
                        </td>
                        <td className="cell-actions">
                          <Link
                            className="btn btn--ghost btn--sm"
                            to={`/providers/${encodeURIComponent(provider.id)}?addKey=1`}
                          >
                            Add key
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={query ? "No providers match" : "No providers configured"}
            message={
              query
                ? "Clear the search to see every provider."
                : "Provider rows and adapters are added on the backend. Once one exists, open it to store keys."
            }
            icon="plug"
          />
        )}
      </Section>
    </div>
  );
}
