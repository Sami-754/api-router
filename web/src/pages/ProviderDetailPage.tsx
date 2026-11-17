import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api } from "../lib/api";
import { useApi } from "../lib/hooks";
import { fmtNum, hostOf } from "../lib/format";
import { stats24hBy } from "../lib/group";
import type {
  Account,
  AdapterInfo,
  Credential,
  Provider,
  ProviderResource,
  QuotaWindow,
  RequestLog,
  ValidationSummary,
} from "../lib/types";
import { useConfirm } from "../components/ConfirmProvider";
import { useToast } from "../components/ToastProvider";
import { Icon } from "../components/Icon";
import { AccountDialog } from "../features/providers/AccountDialog";
import { AddKeyDialog } from "../features/providers/AddKeyDialog";
import { QuotaDialog } from "../features/providers/QuotaDialog";
import { CredentialRow } from "../features/providers/CredentialRow";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Notice,
  PageHeader,
  Section,
  Skeleton,
  StatusPill,
  statusTone,
} from "../components/ui";

interface ConfigState {
  displayName: string;
  baseUrl: string;
  priority: string;
  enabled: boolean;
}

export function ProviderDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { notify } = useToast();

  const providers = useApi<Provider[]>("/api/providers");
  const accounts = useApi<Account[]>(
    `/api/accounts?provider=${encodeURIComponent(id)}`,
  );
  const credentials = useApi<Credential[]>("/api/credentials");
  const quotas = useApi<QuotaWindow[]>("/api/quotas");
  const mappings = useApi<ProviderResource[]>(
    `/api/provider-resources?provider=${encodeURIComponent(id)}`,
  );
  const logs = useApi<RequestLog[]>("/api/requests?limit=500");
  const adapters = useApi<AdapterInfo[]>("/api/adapters");

  const provider = providers.data?.find((item) => item.id === id);
  const [config, setConfig] = useState<ConfigState>({
    displayName: "",
    baseUrl: "",
    priority: "100",
    enabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationSummary | null>(null);
  const [accountDialog, setAccountDialog] = useState<{
    account?: Account;
  } | null>(null);
  const [keyDialog, setKeyDialog] = useState<{ accountId?: string } | null>(
    null,
  );
  const [quotaDialog, setQuotaDialog] = useState<{
    credentialId: string;
    quota?: QuotaWindow;
  } | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(
    new Set(),
  );
  const initializedAccountsKey = useRef("");
  const autoOpenedKey = useRef(false);

  useEffect(() => {
    autoOpenedKey.current = false;
  }, [id]);

  useEffect(() => {
    if (autoOpenedKey.current || params.get("addKey") !== "1") return;
    if (accounts.loading || !accounts.data) return;
    autoOpenedKey.current = true;
    if (accounts.data.length) {
      setKeyDialog({ accountId: accounts.data[0]?.id });
    } else {
      setAccountDialog({});
      notify("Add an account first, then store a key.", "info");
    }
  }, [params, accounts.loading, accounts.data, notify]);

  useEffect(() => {
    if (!accounts.data?.length) return;
    const key = `${id}:${accounts.data.map((account) => account.id).join(",")}`;
    if (initializedAccountsKey.current === key) return;
    initializedAccountsKey.current = key;
    setExpandedAccounts(
      new Set(accounts.data.slice(0, 2).map((account) => account.id)),
    );
  }, [id, accounts.data]);

  const toggleAccountBody = (accountId: string) => {
    setExpandedAccounts((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  useEffect(() => {
    if (!provider) return;
    setConfig({
      displayName: provider.displayName,
      baseUrl: provider.baseUrl ?? "",
      priority: String(provider.priority),
      enabled: provider.enabled,
    });
  }, [provider]);

  const error =
    providers.error ||
    accounts.error ||
    credentials.error ||
    quotas.error ||
    mappings.error ||
    logs.error ||
    adapters.error;
  const loading = [
    providers,
    accounts,
    credentials,
    quotas,
    mappings,
    logs,
    adapters,
  ].some((state) => state.loading && !state.data);

  if (loading) {
    return (
      <div className="page">
        <PageHeader title="Provider" subtitle={id} />
        <Skeleton rows={7} />
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="page">
        <PageHeader
          title="Unknown provider"
          breadcrumb={[{ label: "Providers", to: "/providers" }]}
        />
        <EmptyState
          title="Provider not found"
          message={id}
          action={
            <Link className="btn btn--primary btn--sm" to="/providers">
              Back to providers
            </Link>
          }
          icon="plug"
        />
      </div>
    );
  }

  const accountList = accounts.data ?? [];
  const credentialList = (credentials.data ?? []).filter(
    (credential) => credential.providerId === provider.id,
  );
  const credentialIds = new Set(
    credentialList.map((credential) => credential.id),
  );
  const quotaList = (quotas.data ?? []).filter((quota) =>
    credentialIds.has(quota.credentialId),
  );
  const mappingList = mappings.data ?? [];
  const stats = stats24hBy(logs.data ?? [], (log) => log.selectedCredentialId);
  const adapterRegistered = (adapters.data ?? []).some(
    (adapter) => adapter.id === provider.id,
  );
  const total24h = [...stats.values()].reduce(
    (sum, stat) => sum + stat.requests,
    0,
  );

  const saveConfig = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/api/providers/${encodeURIComponent(provider.id)}`, {
        displayName: config.displayName.trim() || provider.id,
        baseUrl: config.baseUrl.trim() || null,
        priority: Number(config.priority) || 100,
        enabled: config.enabled,
      });
      notify("Provider saved", "ok");
      providers.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const validateAll = async () => {
    setValidating(true);
    try {
      const summary = await api.post<ValidationSummary>(
        "/api/maintenance/validate",
        {
          provider: provider.id,
          limit: 50,
        },
      );
      setValidation(summary);
      notify(
        `Validated ${summary.checked}: ${summary.ok} ok, ${summary.invalid} invalid`,
        summary.invalid ? "error" : "ok",
      );
      credentials.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setValidating(false);
    }
  };

  const deleteProvider = async () => {
    const ok = await confirm({
      title: "Delete provider",
      message: `Delete ${provider.id} with ${accountList.length} accounts and ${credentialList.length} keys? Mappings and quotas cascade.`,
      confirmLabel: "Delete provider",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/providers/${encodeURIComponent(provider.id)}`);
      notify("Provider deleted", "ok");
      navigate("/providers");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const toggleAccount = async (account: Account) => {
    try {
      await api.post("/api/accounts", {
        id: account.id,
        providerId: account.providerId,
        displayName: account.displayName ?? null,
        enabled: !account.enabled,
      });
      notify(`Account ${account.enabled ? "disabled" : "enabled"}`, "ok");
      accounts.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const deleteAccount = async (account: Account) => {
    const count = credentialList.filter(
      (credential) => credential.accountId === account.id,
    ).length;
    const ok = await confirm({
      title: "Delete account",
      message: `Delete ${account.id} and its ${count} key${count === 1 ? "" : "s"}? Quotas, health and usage cascade.`,
      confirmLabel: "Delete account",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/accounts/${encodeURIComponent(account.id)}`);
      notify("Account deleted", "ok");
      accounts.reload();
      credentials.reload();
      quotas.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const reloadKeys = () => {
    credentials.reload();
    quotas.reload();
  };

  return (
    <div className="page">
      <PageHeader
        breadcrumb={[
          { label: "Providers", to: "/providers" },
          { label: provider.id },
        ]}
        title={
          <span className="row row--wrap" style={{ gap: 8 }}>
            {provider.displayName || provider.id}
            <StatusPill
              tone={statusTone(provider.enabled ? "enabled" : "disabled")}
            >
              {provider.enabled ? "enabled" : "disabled"}
            </StatusPill>
          </span>
        }
        subtitle={
          <span className="row row--wrap" style={{ gap: 6 }}>
            <span className="mono">{provider.id}</span>
            <span className="muted">· {hostOf(provider.baseUrl)}</span>
            <span className="muted">· priority {provider.priority}</span>
            <span className="muted">· {total24h} requests / 24h</span>
          </span>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon="key"
              onClick={() => {
                if (accountList.length) {
                  setKeyDialog({ accountId: accountList[0]?.id });
                } else {
                  setAccountDialog({});
                  notify("Add an account first, then store a key.", "info");
                }
              }}
            >
              Add key
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="check"
              busy={validating}
              onClick={() => void validateAll()}
            >
              Validate stale keys
            </Button>
            <Link
              className="btn btn--secondary btn--sm"
              to={`/models?provider=${encodeURIComponent(provider.id)}`}
            >
              Models
            </Link>
            <Button
              variant="danger"
              size="sm"
              icon="trash"
              onClick={() => void deleteProvider()}
            >
              Delete
            </Button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={providers.reload} />}

      {!adapterRegistered && adapters.data && (
        <Notice tone="warn">
          No adapter is registered for <strong>{provider.id}</strong>. Restart
          the router after adding the provider or its adapter; until then its
          routes are filtered as “no adapter”.
        </Notice>
      )}

      {validation && (
        <div style={{ marginTop: 10 }}>
          <Notice tone={validation.invalid ? "warn" : "info"}>
            Validation checked {validation.checked}: {validation.ok} valid,{" "}
            {validation.invalid} invalid, {validation.inconclusive ?? 0}{" "}
            inconclusive, {validation.skippedFresh} fresh skipped.
          </Notice>
        </div>
      )}

      <Section
        title="Configuration"
        description="Base URL and priority feed adapter construction and the priority policy."
      >
        <form
          className="config-panel form-grid"
          onSubmit={(event) => void saveConfig(event)}
        >
          <Field label="Display name">
            <input
              value={config.displayName}
              onChange={(event) =>
                setConfig({ ...config, displayName: event.target.value })
              }
            />
          </Field>
          <Field label="Priority" hint="Lower wins under the priority policy.">
            <input
              type="number"
              value={config.priority}
              onChange={(event) =>
                setConfig({ ...config, priority: event.target.value })
              }
            />
          </Field>
          <Field
            label="Base URL"
            className="field--full"
            hint="Changing this changes adapter construction on the next boot."
          >
            <input
              type="url"
              value={config.baseUrl}
              onChange={(event) =>
                setConfig({ ...config, baseUrl: event.target.value })
              }
              placeholder="https://api.example.com/v1"
            />
          </Field>
          <Field label="State">
            <select
              value={config.enabled ? "true" : "false"}
              onChange={(event) =>
                setConfig({ ...config, enabled: event.target.value === "true" })
              }
            >
              <option value="true">enabled</option>
              <option value="false">disabled</option>
            </select>
          </Field>
          <div className="form-actions field--full">
            <Button type="submit" variant="primary" busy={saving}>
              Save provider
            </Button>
          </div>
        </form>
      </Section>

      <Section
        id="keys"
        title={`Accounts & keys (${accountList.length})`}
        description="Secrets are encrypted at rest; the API only ever returns key ids and labels."
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => setAccountDialog({})}
          >
            Add account
          </Button>
        }
      >
        {accountList.length ? (
          accountList.map((account) => {
            const keys = credentialList.filter(
              (credential) => credential.accountId === account.id,
            );
            const open = expandedAccounts.has(account.id);
            const activeKeys = keys.filter(
              (credential) => credential.status === "active",
            ).length;
            return (
              <div className="account-card" key={account.id}>
                <div className="account-card__head">
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={() => toggleAccountBody(account.id)}
                    aria-label={open ? "Collapse account" : "Expand account"}
                  >
                    <Icon
                      name={open ? "chevron-down" : "chevron-right"}
                      size={13}
                    />
                  </button>
                  <div className="account-card__title">
                    <span className="mono">{account.id}</span>
                    <span className="muted">{account.displayName}</span>
                    <StatusPill
                      tone={statusTone(account.enabled ? "on" : "off")}
                    >
                      {account.enabled ? "on" : "off"}
                    </StatusPill>
                  </div>
                  <div className="account-card__meta">
                    <Badge tone={activeKeys === keys.length ? "ok" : "warn"}>
                      {activeKeys}/{keys.length} active
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="plus"
                      onClick={() => setKeyDialog({ accountId: account.id })}
                    >
                      Add key
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAccountDialog({ account })}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void toggleAccount(account)}
                    >
                      {account.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void deleteAccount(account)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                {!open ? null : keys.length ? (
                  <div className="account-card__body">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Key</th>
                          <th>Status</th>
                          <th>Validated</th>
                          <th className="cell-num">24h / success / latency</th>
                          <th>Quota</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {keys.map((credential) => (
                          <CredentialRow
                            key={credential.id}
                            credential={credential}
                            quotas={quotaList.filter(
                              (quota) => quota.credentialId === credential.id,
                            )}
                            stat={stats.get(credential.id)}
                            onReload={reloadKeys}
                            onAddQuota={() =>
                              setQuotaDialog({ credentialId: credential.id })
                            }
                            onEditQuota={(quota) =>
                              setQuotaDialog({
                                credentialId: credential.id,
                                quota,
                              })
                            }
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="account-card__empty">
                    No keys in this account.{" "}
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() => setKeyDialog({ accountId: account.id })}
                    >
                      Add one
                    </button>
                    .
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <EmptyState
            title="No accounts"
            message="Create an account to hold one or more keys for this provider."
            action={
              <Button
                variant="primary"
                size="sm"
                icon="plus"
                onClick={() => setAccountDialog({})}
              >
                Add account
              </Button>
            }
            icon="key"
          />
        )}
      </Section>

      <Section
        title="Models served"
        description="Provider mappings for this upstream. Manage and inspect them in Models."
      >
        <div className="panel row row--between">
          <div>
            <span className="metric__value" style={{ fontSize: 18 }}>
              {fmtNum(mappingList.length)}
            </span>
            <div className="metric__label">provider mappings</div>
          </div>
          <Link
            className="btn btn--secondary btn--sm"
            to={`/models?provider=${encodeURIComponent(provider.id)}`}
          >
            Open in Models
          </Link>
        </div>
      </Section>

      <AccountDialog
        open={Boolean(accountDialog)}
        onClose={() => setAccountDialog(null)}
        onDone={() => accounts.reload()}
        providerId={provider.id}
        account={accountDialog?.account}
      />
      <AddKeyDialog
        open={Boolean(keyDialog)}
        onClose={() => setKeyDialog(null)}
        onDone={reloadKeys}
        accounts={accountList}
        accountId={keyDialog?.accountId}
      />
      <QuotaDialog
        open={Boolean(quotaDialog)}
        onClose={() => setQuotaDialog(null)}
        onDone={reloadKeys}
        credentialId={quotaDialog?.credentialId ?? ""}
        quota={quotaDialog?.quota}
      />
    </div>
  );
}
