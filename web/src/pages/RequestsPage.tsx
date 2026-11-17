import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { useRefresh } from "../lib/refresh";
import { CAPABILITIES } from "../lib/constants";
import { fmtAgo, fmtLatency, fmtNum, shortModel } from "../lib/format";
import { groupRequests } from "../lib/group";
import type { RequestLog } from "../lib/types";
import { RequestDrawer } from "../features/requests/RequestDrawer";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Section,
  Skeleton,
  StatusPill,
  statusTone,
} from "../components/ui";

const PAGE_SIZE = 50;

export function RequestsPage() {
  const { bump } = useRefresh();
  const [params, setParams] = useSearchParams();
  const [auto, setAuto] = useState(true);
  const logs = useApi<RequestLog[]>("/api/requests?limit=500", {
    pollMs: auto ? 10_000 : undefined,
  });

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [provider, setProvider] = useState(params.get("provider") ?? "");
  const [capability, setCapability] = useState("");
  const [window, setWindow] = useState("all");
  const [page, setPage] = useState(1);

  const openId = params.get("id");
  const groups = useMemo(() => groupRequests(logs.data ?? []), [logs.data]);
  const openGroup = openId
    ? (groups.find((group) => group.id === openId) ?? null)
    : null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const since =
      window === "1h"
        ? Date.now() - 3_600_000
        : window === "24h"
          ? Date.now() - 86_400_000
          : 0;
    return groups.filter((group) => {
      const last = group.last;
      if (status && last.status !== status) return false;
      if (provider && last.selectedProviderId !== provider) return false;
      if (capability && last.requestedCapability !== capability) return false;
      if (since && Date.parse(group.createdAt) < since) return false;
      if (needle) {
        const haystack =
          `${group.id} ${last.requestedResourceId} ${last.selectedProviderId ?? ""} ${last.selectedCredentialId ?? ""} ${last.selectedUpstreamId ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [groups, status, provider, capability, window, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const providers = [
    ...new Set(
      groups.map((group) => group.last.selectedProviderId).filter(Boolean),
    ),
  ] as string[];

  const selectGroup = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("id", id);
    setParams(next, { replace: true });
  };

  const closeDrawer = () => {
    const next = new URLSearchParams(params);
    next.delete("id");
    setParams(next, { replace: true });
  };

  if (logs.loading && !logs.data) {
    return (
      <div className="page">
        <PageHeader
          title="Requests"
          subtitle="Per-request history and the actual routes used."
        />
        <Skeleton rows={8} />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Requests"
        subtitle="Attempts are grouped into logical requests. Open a row to see the full fallback chain."
        actions={
          <>
            <label className="check-row">
              <input
                type="checkbox"
                checked={auto}
                onChange={(event) => setAuto(event.target.checked)}
              />
              auto-refresh
            </label>
            <Button size="sm" variant="secondary" icon="refresh" onClick={bump}>
              Refresh
            </Button>
          </>
        }
      />

      {logs.error && <ErrorState message={logs.error} onRetry={logs.reload} />}

      <div className="filters-bar">
        <label className="field field--search">
          <span className="field__label">Search</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="request id, model, provider, key…"
          />
        </label>
        <label className="field">
          <span className="field__label">Status</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">all</option>
            <option value="success">success</option>
            <option value="error">error</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Provider</span>
          <select
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value);
              setPage(1);
            }}
          >
            <option value="">all</option>
            {providers.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Capability</span>
          <select
            value={capability}
            onChange={(event) => {
              setCapability(event.target.value);
              setPage(1);
            }}
          >
            <option value="">all</option>
            {CAPABILITIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Window</span>
          <select
            value={window}
            onChange={(event) => setWindow(event.target.value)}
          >
            <option value="1h">last hour</option>
            <option value="24h">last 24h</option>
            <option value="all">all loaded</option>
          </select>
        </label>
        {(query || status || provider || capability || window !== "all") && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQuery("");
              setStatus("");
              setProvider("");
              setCapability("");
              setWindow("all");
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
                    <th>Time</th>
                    <th>Model</th>
                    <th>Capability</th>
                    <th>Route</th>
                    <th>Key</th>
                    <th>Policy</th>
                    <th>Status</th>
                    <th className="cell-num">Attempts</th>
                    <th className="cell-num">Tokens</th>
                    <th className="cell-num">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((group) => {
                    const last = group.last;
                    return (
                      <tr
                        key={group.id}
                        className="row-link"
                        onClick={() => selectGroup(group.id)}
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectGroup(group.id);
                          }
                        }}
                      >
                        <td
                          className="cell-mono cell-muted"
                          title={group.createdAt}
                        >
                          {fmtAgo(group.createdAt)}
                        </td>
                        <td>
                          <div className="cell-main">
                            <span className="cell-main__title">
                              {shortModel(last.requestedResourceId) || "—"}
                            </span>
                            <span className="cell-main__sub">
                              {group.id.slice(0, 13)}…
                            </span>
                          </div>
                        </td>
                        <td className="cell-mono cell-muted">
                          {last.requestedCapability ?? "—"}
                        </td>
                        <td className="cell-mono cell-muted">
                          {last.selectedProviderId ? (
                            <>
                              {last.selectedProviderId}
                              <span className="muted">
                                /{last.selectedUpstreamId ?? ""}
                              </span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="cell-mono cell-muted">
                          {last.selectedCredentialId ?? "—"}
                        </td>
                        <td>
                          <Badge tone="accent">{last.policy}</Badge>
                        </td>
                        <td>
                          <StatusPill
                            tone={statusTone(
                              group.success ? "success" : "error",
                            )}
                          >
                            {group.success ? "success" : "error"}
                          </StatusPill>
                        </td>
                        <td className="cell-num">{group.attempts || "—"}</td>
                        <td className="cell-num">
                          {fmtNum(group.totalTokens)}
                        </td>
                        <td className="cell-num">
                          {fmtLatency(last.latencyMs)}
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
            <p className="table-note">
              Loaded the latest {logs.data?.length ?? 0} attempt logs (
              {groups.length} logical requests). Filters apply to that window
              only.
            </p>
          </>
        ) : (
          <EmptyState
            title="No requests match"
            message="Widen the filters or send a request from the Playground."
            action={
              <Link className="btn btn--primary btn--sm" to="/playground">
                Open Playground
              </Link>
            }
            icon="list"
          />
        )}
      </Section>

      {openId && !openGroup && (
        <p className="table-note text-bad">
          Request {openId} is not in the loaded window. Refresh or widen the
          request limit.
        </p>
      )}

      <RequestDrawer group={openGroup} onClose={closeDrawer} />
    </div>
  );
}
