import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useApi, useAction } from "../../lib/hooks";
import { useRefresh } from "../../lib/refresh";
import { useToast } from "../../components/ToastProvider";
import type { AdapterInfo } from "../../lib/types";
import {
  Badge,
  Button,
  ErrorState,
  Field,
  Notice,
  Section,
  Skeleton,
} from "../../components/ui";

interface AddKeyResult {
  provider: { id: string; displayName: string; created: boolean };
  account: { id: string; created: boolean };
  credential: {
    id: string;
    accountId: string;
    providerId: string;
    label?: string | null;
    status: string;
    redacted: string;
  };
  adapterRegistered: boolean;
  toolRoutes: string[];
}

export function AddKeyForm() {
  const { bump } = useRefresh();
  const { notify } = useToast();
  const { run, busy } = useAction();
  const adapters = useApi<AdapterInfo[]>("/api/adapters");

  const [providerId, setProviderId] = useState("");
  const [secret, setSecret] = useState("");
  const [label, setLabel] = useState("");
  const [result, setResult] = useState<AddKeyResult | null>(null);

  const adapterList = adapters.data ?? [];
  const tools = adapterList.filter((adapter) => adapter.kind === "tool");
  const llms = adapterList.filter((adapter) => adapter.kind !== "tool");
  const selected = adapterList.find((adapter) => adapter.id === providerId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!providerId || !secret.trim()) return;

    const outcome = await run(() =>
      api.post<AddKeyResult>("/api/keys", {
        providerId,
        secret,
        label: label.trim() || null,
      }),
    );
    if (!outcome) return;

    notify(`Key stored for ${outcome.provider.displayName}`, "ok");
    setResult(outcome);
    setSecret("");
    setLabel("");
    adapters.reload();
    bump();
  };

  if (adapters.loading && !adapters.data) {
    return (
      <Section
        title="Add key"
        description="Pick a provider, paste the key, label it."
      >
        <Skeleton rows={6} />
      </Section>
    );
  }

  return (
    <Section
      title="Add key"
      description="Choose where the key belongs, paste it, and label it. Missing provider or account rows are created for you."
    >
      {adapters.error && (
        <ErrorState message={adapters.error} onRetry={adapters.reload} />
      )}

      <form className="form-grid" onSubmit={submit}>
        <Field
          label="Provider"
          hint="Tool providers can be provisioned from a key; LLM provider rows already exist."
          className="field--full"
        >
          <select
            value={providerId}
            onChange={(event) => {
              setProviderId(event.target.value);
              setResult(null);
            }}
            required
          >
            <option value="">Select provider…</option>
            {tools.length > 0 && (
              <optgroup label="Tool providers">
                {tools.map((adapter) => (
                  <option key={adapter.id} value={adapter.id}>
                    {adapter.displayName} ({adapter.id})
                  </option>
                ))}
              </optgroup>
            )}
            {llms.length > 0 && (
              <optgroup label="LLM providers">
                {llms.map((adapter) => (
                  <option key={adapter.id} value={adapter.id}>
                    {adapter.displayName} ({adapter.id})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>

        {selected && (
          <div className="field field--full">
            <span className="field__label">Capabilities</span>
            <div className="check-cluster">
              {selected.capabilities.map((capability) => (
                <Badge key={capability} tone="neutral">
                  {capability}
                </Badge>
              ))}
            </div>
            <span className="field__hint">
              {selected.kind === "tool"
                ? "The provider row, main account and these tool routes are created automatically."
                : "The key is attached to the provider's main account (created if missing)."}
            </span>
          </div>
        )}

        <Field
          label="API key"
          hint="Encrypted at rest and never returned by the API. Probes are not run automatically."
          className="field--full"
        >
          <input
            type="password"
            value={secret}
            onChange={(event) => {
              setSecret(event.target.value);
              setResult(null);
            }}
            placeholder={
              providerId === "tavily"
                ? "tvly-…"
                : providerId === "firecrawl"
                  ? "fc-…"
                  : "paste the provider key"
            }
            autoComplete="off"
            required
          />
        </Field>

        <Field
          label="Label"
          hint="Optional note to tell keys apart, e.g. main, backup, personal."
          className="field--full"
        >
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="main"
          />
        </Field>

        <div className="form-actions field--full">
          <Button
            type="submit"
            variant="primary"
            icon="key"
            busy={busy}
            disabled={!providerId || !secret.trim()}
          >
            Store key
          </Button>
          <Link className="btn btn--ghost btn--md" to="/providers">
            Open Providers
          </Link>
        </div>
      </form>

      {result && (
        <div style={{ marginTop: 14 }}>
          <Notice tone="info">
            Key stored for{" "}
            <Link to={`/providers/${encodeURIComponent(result.provider.id)}`}>
              {result.provider.displayName}
            </Link>{" "}
            under <code className="mono">{result.account.id}</code>
            {result.provider.created ? " (provider created)" : ""}.{" "}
            {result.toolRoutes.length > 0
              ? `Tool routes ready: ${result.toolRoutes.join(", ")}. `
              : ""}
            It is not validated yet — use <strong>Validate stale keys</strong>{" "}
            on the provider page when you want to probe it.
          </Notice>
        </div>
      )}
    </Section>
  );
}
