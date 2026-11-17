import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtAgo, fmtCountdown, fmtLatency, fmtNum } from "../../lib/format";
import { avgLatency, successRate, type CountStat } from "../../lib/group";
import { useApi } from "../../lib/hooks";
import type {
  Credential,
  CredentialValidation,
  QuotaWindow,
  UsageSummary,
} from "../../lib/types";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import { Icon } from "../../components/Icon";
import {
  Badge,
  CopyButton,
  EmptyState,
  QuotaBar,
  StatusPill,
  statusTone,
} from "../../components/ui";

export function CredentialRow({
  credential,
  quotas,
  stat,
  onReload,
  onAddQuota,
  onEditQuota,
}: {
  credential: Credential;
  quotas: QuotaWindow[];
  stat?: CountStat;
  onReload: () => void;
  onAddQuota: () => void;
  onEditQuota: (quota: QuotaWindow) => void;
}) {
  const confirm = useConfirm();
  const { notify } = useToast();
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(credential.label ?? "");
  const [expanded, setExpanded] = useState(false);
  const [validating, setValidating] = useState(false);
  const usage = useApi<UsageSummary>(
    expanded
      ? `/api/usage?credential=${encodeURIComponent(credential.id)}`
      : null,
  );

  useEffect(() => {
    setLabelValue(credential.label ?? "");
  }, [credential.label]);

  const rate = successRate(stat);
  const orderedQuotas = [...quotas].sort((a, b) => {
    if (a.hard !== b.hard) return a.hard ? -1 : 1;
    const ar = a.resetAt ? Date.parse(a.resetAt) : Number.MAX_SAFE_INTEGER;
    const br = b.resetAt ? Date.parse(b.resetAt) : Number.MAX_SAFE_INTEGER;
    return ar - br;
  });
  const topQuotas = orderedQuotas.slice(0, 2);

  const saveLabel = async () => {
    try {
      await api.patch(`/api/credentials/${encodeURIComponent(credential.id)}`, {
        label: labelValue.trim() || null,
      });
      notify("Label saved", "ok");
      setEditingLabel(false);
      onReload();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const validate = async () => {
    setValidating(true);
    try {
      const result = await api.post<CredentialValidation>(
        `/api/credentials/${encodeURIComponent(credential.id)}/validate`,
      );
      const message =
        result.definitive === false
          ? `Inconclusive — ${result.message || "probe unavailable"}`
          : result.ok
            ? `Valid — ${result.message || "accepted"}`
            : `Invalid — ${result.message || "rejected"}`;
      notify(message, result.ok ? "ok" : "error");
      onReload();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setValidating(false);
    }
  };

  const toggleStatus = async () => {
    try {
      const next = credential.status === "active" ? "disabled" : "active";
      await api.patch(`/api/credentials/${encodeURIComponent(credential.id)}`, {
        status: next,
      });
      notify(`Key ${next}`, "ok");
      onReload();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Delete key",
      message: `Delete ${credential.id}? Quotas, health and usage for this key are removed.`,
      confirmLabel: "Delete key",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/credentials/${encodeURIComponent(credential.id)}`);
      notify("Key deleted", "ok");
      onReload();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const removeQuota = async (quota: QuotaWindow) => {
    const ok = await confirm({
      title: "Delete quota window",
      message: `Remove ${quota.metric} (${quota.limitValue} limit) from ${credential.id}?`,
      confirmLabel: "Delete window",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/quotas/${encodeURIComponent(quota.id)}`);
      notify("Quota window deleted", "ok");
      onReload();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  return (
    <>
      <tr>
        <td>
          <div className="key-meta">
            <span className="row" style={{ gap: 4 }}>
              <span className="key-meta__id">{credential.id}</span>
              <CopyButton value={credential.id} compact />
            </span>
            {editingLabel ? (
              <form
                className="key-label-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveLabel();
                }}
              >
                <input
                  value={labelValue}
                  onChange={(event) => setLabelValue(event.target.value)}
                  placeholder="label"
                  autoFocus
                />
                <button
                  type="submit"
                  className="copy-btn"
                  aria-label="Save label"
                >
                  <Icon name="check" size={13} />
                </button>
                <button
                  type="button"
                  className="copy-btn"
                  aria-label="Cancel label edit"
                  onClick={() => {
                    setEditingLabel(false);
                    setLabelValue(credential.label ?? "");
                  }}
                >
                  <Icon name="x" size={13} />
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="key-meta__label"
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  textAlign: "left",
                }}
                onClick={() => setEditingLabel(true)}
                title="Edit label"
              >
                {credential.label || "add label"}
              </button>
            )}
          </div>
        </td>
        <td>
          <StatusPill tone={statusTone(credential.status)}>
            {credential.status}
          </StatusPill>
        </td>
        <td
          className="cell-muted small"
          title={credential.lastValidatedAt ?? undefined}
        >
          {credential.lastValidatedAt
            ? fmtAgo(credential.lastValidatedAt)
            : "never"}
        </td>
        <td className="cell-num">
          {stat ? (
            <span
              title={`${rate === null ? "—" : Math.round(rate * 100) + "%"} success`}
            >
              {stat.requests}
              <span className="muted">
                {" "}
                / {rate === null ? "—" : `${Math.round(rate * 100)}%`}
              </span>
              <span className="muted"> / {fmtLatency(avgLatency(stat))}</span>
            </span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td>
          {topQuotas.length ? (
            <div className="quota-list">
              {topQuotas.map((quota) => (
                <div className="quota-list__row" key={quota.id}>
                  <span className="quota-list__metric" title={quota.metric}>
                    {quota.metric}
                  </span>
                  <QuotaBar quota={quota} />
                  <span className="muted small">
                    {fmtCountdown(quota.resetAt)}
                  </span>
                </div>
              ))}
              {orderedQuotas.length > topQuotas.length && (
                <span className="muted small">
                  +{orderedQuotas.length - topQuotas.length} more
                </span>
              )}
            </div>
          ) : (
            <span className="muted small">no quota</span>
          )}
        </td>
        <td className="cell-actions">
          <div className="key-actions">
            <button
              type="button"
              className="copy-btn"
              onClick={() => void validate()}
              disabled={validating}
              title="Validate key"
            >
              {validating ? "…" : "validate"}
            </button>
            <button
              type="button"
              className="copy-btn"
              onClick={() => void toggleStatus()}
            >
              {credential.status === "active" ? "disable" : "enable"}
            </button>
            <button type="button" className="copy-btn" onClick={onAddQuota}>
              quota +
            </button>
            <button
              type="button"
              className="copy-btn"
              onClick={() => void remove()}
              aria-label="Delete key"
            >
              <Icon name="trash" size={13} />
            </button>
            <button
              type="button"
              className="copy-btn"
              onClick={() => setExpanded((value) => !value)}
              aria-label="Toggle key details"
            >
              <Icon
                name={expanded ? "chevron-down" : "chevron-right"}
                size={13}
              />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} style={{ background: "var(--ink-2)", padding: 0 }}>
            <div className="usage-panel">
              <div className="usage-cell">
                <div className="usage-cell__value">
                  {usage.data?.requests ?? "—"}
                </div>
                <div className="usage-cell__label">requests · 24h</div>
              </div>
              <div className="usage-cell">
                <div className="usage-cell__value">
                  {fmtNum(usage.data?.total_tokens)}
                </div>
                <div className="usage-cell__label">tokens · 24h</div>
              </div>
              <div className="usage-cell">
                <div className="usage-cell__value">
                  {fmtNum(usage.data?.searches)}
                </div>
                <div className="usage-cell__label">searches · 24h</div>
              </div>
              <div className="usage-cell">
                <div className="usage-cell__value">
                  {rate === null ? "—" : `${Math.round(rate * 100)}%`}
                </div>
                <div className="usage-cell__label">success · recent</div>
              </div>
            </div>
            <div style={{ padding: "4px 14px 14px" }}>
              <div className="row row--between" style={{ marginBottom: 6 }}>
                <span className="drawer-heading" style={{ margin: 0 }}>
                  Quota windows
                </span>
                <button type="button" className="copy-btn" onClick={onAddQuota}>
                  <Icon name="plus" size={12} /> add window
                </button>
              </div>
              {orderedQuotas.length ? (
                orderedQuotas.map((quota) => (
                  <div className="quota-window-row" key={quota.id}>
                    <span className="quota-window-row__metric">
                      {quota.metric}
                    </span>
                    <QuotaBar quota={quota} />
                    <span className="quota-window-row__reset">
                      {fmtCountdown(quota.resetAt)}
                    </span>
                    <Badge tone={quota.hard ? "warn" : "neutral"}>
                      {quota.hard ? "hard" : "soft"}
                    </Badge>
                    <Badge>{quota.source}</Badge>
                    <div className="quota-window-row__actions">
                      <button
                        type="button"
                        className="copy-btn"
                        onClick={() => onEditQuota(quota)}
                      >
                        edit
                      </button>
                      <button
                        type="button"
                        className="copy-btn"
                        onClick={() => void removeQuota(quota)}
                      >
                        delete
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No quota windows"
                  message="Add a window so burn-aware routing can reason about this key."
                  action={
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={onAddQuota}
                    >
                      Add quota window
                    </button>
                  }
                  icon="bolt"
                />
              )}
              {usage.error && <p className="text-bad small">{usage.error}</p>}
              {usage.data && (
                <p className="table-note">
                  Usage since {usage.data.since} · input{" "}
                  {fmtNum(usage.data.input_tokens)} / output{" "}
                  {fmtNum(usage.data.output_tokens)}
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
