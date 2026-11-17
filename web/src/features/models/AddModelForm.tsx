import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useApi, useAction } from "../../lib/hooks";
import { useRefresh } from "../../lib/refresh";
import { useToast } from "../../components/ToastProvider";
import { LLM_CAPABILITIES } from "../../lib/constants";
import type {
  AdapterInfo,
  Capability,
  Credential,
  Provider,
  ProviderResource,
  Resource,
} from "../../lib/types";
import {
  Button,
  ErrorState,
  Field,
  Notice,
  Section,
  Skeleton,
} from "../../components/ui";

interface AddResult {
  modelId: string;
  modelName: string;
  providerId?: string;
  routeAdded: boolean;
  hadKeys: boolean;
}

export function AddModelForm() {
  const { bump } = useRefresh();
  const { notify } = useToast();
  const { run, busy } = useAction();

  const providers = useApi<Provider[]>("/api/providers");
  const resources = useApi<Resource[]>("/api/resources");
  const mappings = useApi<ProviderResource[]>("/api/provider-resources");
  const credentials = useApi<Credential[]>("/api/credentials");
  const adapters = useApi<AdapterInfo[]>("/api/adapters");

  const [modelName, setModelName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [providerId, setProviderId] = useState("");
  const [upstreamId, setUpstreamId] = useState("");
  const [upstreamTouched, setUpstreamTouched] = useState(false);
  const [contextTokens, setContextTokens] = useState("");
  const [capabilities, setCapabilities] = useState<Capability[]>([
    "llm.chat",
    "llm.tools",
  ]);
  const [result, setResult] = useState<AddResult | null>(null);

  const loading = [providers, resources, mappings, credentials, adapters].some(
    (state) => state.loading && !state.data,
  );
  const error =
    providers.error ||
    resources.error ||
    mappings.error ||
    credentials.error ||
    adapters.error;

  const normalized = modelName.trim().toLowerCase();
  const canonicalId = normalized ? `llm:model:${normalized}` : "";
  const existing = useMemo(
    () =>
      (resources.data ?? []).find((resource) => resource.id === canonicalId),
    [resources.data, canonicalId],
  );
  const existingRoutes = useMemo(
    () =>
      (mappings.data ?? []).filter(
        (mapping) => mapping.resourceId === canonicalId,
      ),
    [mappings.data, canonicalId],
  );
  const existingRoute = existingRoutes.find(
    (mapping) =>
      mapping.providerId === providerId &&
      mapping.upstreamId === upstreamId.trim(),
  );
  const nameError =
    normalized && (/\s/.test(normalized) || normalized.includes("::"))
      ? "No spaces or :: — :: is the router's provider-pin separator."
      : null;
  const contextError =
    contextTokens.trim() &&
    (!Number.isInteger(Number(contextTokens)) || Number(contextTokens) <= 0)
      ? "Use a positive whole number."
      : null;
  const selectedProvider = (providers.data ?? []).find(
    (provider) => provider.id === providerId,
  );
  const selectedAdapter = (adapters.data ?? []).find(
    (adapter) => adapter.id === providerId,
  );
  const activeKeys = (credentials.data ?? []).filter(
    (credential) =>
      credential.providerId === providerId && credential.status === "active",
  ).length;
  const canSubmit = Boolean(
    normalized &&
    !nameError &&
    !contextError &&
    (existing || capabilities.length > 0) &&
    (providerId ? upstreamId.trim() : !existing),
  );

  const setModel = (value: string) => {
    setModelName(value);
    setResult(null);
    if (!upstreamTouched) setUpstreamId(value);
  };

  const toggleCapability = (capability: Capability) => {
    setCapabilities((current) =>
      current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability],
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    const ctx = contextTokens.trim() ? Number(contextTokens) : null;
    const modelId = `llm:model:${normalized}`;
    const routeCapabilities: Capability[] = existing
      ? existing.capabilities.length
        ? existing.capabilities
        : ["llm.chat"]
      : capabilities;

    const outcome = await run(async () => {
      if (!existing) {
        await api.post<Resource>("/api/resources", {
          id: modelId,
          kind: "llm_model",
          displayName: displayName.trim() || normalized,
          capabilities,
          contextTokens: ctx,
        });
      }
      if (providerId) {
        await api.post<ProviderResource>("/api/provider-resources", {
          resourceId: modelId,
          providerId,
          upstreamId: upstreamId.trim(),
          capabilities: routeCapabilities,
          contextTokens: ctx,
          enabled: true,
        });
      }
      return {
        modelId,
        modelName: displayName.trim() || normalized,
        providerId: providerId || undefined,
        routeAdded: Boolean(providerId),
        hadKeys: activeKeys > 0,
      } satisfies AddResult;
    });

    if (!outcome) return;
    const verb = outcome.routeAdded
      ? existing
        ? "Route saved"
        : "Model and route created"
      : "Model created";
    notify(verb, "ok");
    setResult(outcome);
    resources.reload();
    mappings.reload();
    bump();
  };

  if (loading) {
    return (
      <Section
        title="New model"
        description="Create a canonical model and its provider route."
      >
        <Skeleton rows={8} />
      </Section>
    );
  }

  return (
    <Section
      title="New model"
      description="This writes a canonical llm:model row and, when a provider is chosen, one executable route."
    >
      {error && <ErrorState message={error} onRetry={bump} />}

      <form className="form-grid" onSubmit={submit}>
        <Field
          label="Model name"
          hint="What clients pass as model. Lowercase; no spaces or ::."
          error={nameError ?? undefined}
          className="field--full"
        >
          <input
            list="admin-model-names"
            value={modelName}
            onChange={(event) => setModel(event.target.value)}
            placeholder="my-model"
            autoComplete="off"
            required
          />
          <datalist id="admin-model-names">
            {(resources.data ?? [])
              .filter((resource) => resource.kind === "llm_model")
              .map((resource) => {
                const logical = resource.id.replace(/^llm:model:/, "");
                return (
                  <option key={resource.id} value={logical}>
                    {resource.displayName}
                  </option>
                );
              })}
          </datalist>
        </Field>

        {existing ? (
          <div className="field--full">
            <Notice tone="info">
              <strong>{existing.displayName}</strong> already exists with{" "}
              {existingRoutes.length} route
              {existingRoutes.length === 1 ? "" : "s"}. The canonical row is
              kept as-is; submitting adds another route.{" "}
              <Link to={`/models/${encodeURIComponent(existing.id)}`}>
                Open model →
              </Link>
            </Notice>
          </div>
        ) : (
          <>
            <Field
              label="Display name"
              hint="Optional. Defaults to the model name."
            >
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={normalized || "My model"}
              />
            </Field>
            <Field
              label="Context tokens"
              hint="Optional. Used for context-length eligibility."
              error={contextError ?? undefined}
            >
              <input
                inputMode="numeric"
                value={contextTokens}
                onChange={(event) => setContextTokens(event.target.value)}
                placeholder="128000"
              />
            </Field>
            <div className="field field--full">
              <span className="field__label">Capabilities</span>
              <div className="check-cluster">
                {LLM_CAPABILITIES.map((capability) => (
                  <label className="check-row" key={capability}>
                    <input
                      type="checkbox"
                      checked={capabilities.includes(capability)}
                      onChange={() => toggleCapability(capability)}
                    />
                    {capability}
                  </label>
                ))}
              </div>
              {!capabilities.length && (
                <span className="field__error">
                  Pick at least one capability.
                </span>
              )}
            </div>
          </>
        )}

        <Field
          label="Provider route"
          hint="Optional. Without one the model has no executable route."
        >
          <select
            value={providerId}
            onChange={(event) => {
              setProviderId(event.target.value);
              setResult(null);
            }}
          >
            <option value="">No route yet</option>
            {(providers.data ?? []).map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.displayName} ({provider.id})
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Upstream model ID"
          hint="The provider's exact model id. `/` and `:` are fine."
        >
          <input
            value={upstreamId}
            onChange={(event) => {
              setUpstreamId(event.target.value);
              setUpstreamTouched(true);
              setResult(null);
            }}
            placeholder="provider/model-name"
            disabled={!providerId}
            required={Boolean(providerId)}
          />
        </Field>

        {providerId && (
          <div className="field--full">
            <Notice tone={activeKeys && selectedAdapter ? "info" : "warn"}>
              {!selectedAdapter && (
                <>
                  No registered adapter for <strong>{providerId}</strong>. The
                  route will be stored but cannot execute until the adapter is
                  added in code and the server restarts.{" "}
                </>
              )}
              {selectedAdapter && !activeKeys && (
                <>
                  <strong>{selectedProvider?.displayName ?? providerId}</strong>{" "}
                  has no active keys.{" "}
                  <Link
                    to={`/providers/${encodeURIComponent(providerId)}?addKey=1`}
                  >
                    Add a key →
                  </Link>
                </>
              )}
              {selectedAdapter && activeKeys > 0 && (
                <>
                  {activeKeys} active key{activeKeys === 1 ? "" : "s"} available
                  for <strong>{providerId}</strong>.
                </>
              )}
              {existingRoute &&
                " This exact route already exists and will be updated."}
            </Notice>
          </div>
        )}

        <div className="form-actions field--full">
          <Button
            type="submit"
            variant="primary"
            icon="plus"
            busy={busy}
            disabled={!canSubmit}
          >
            {existing ? "Add route" : "Create model"}
          </Button>
          <Link className="btn btn--ghost btn--md" to="/models">
            Open Models
          </Link>
        </div>
      </form>

      {result && (
        <div style={{ marginTop: 14 }}>
          <Notice tone="info">
            {result.routeAdded ? "Route saved for " : "Created "}
            <Link to={`/models/${encodeURIComponent(result.modelId)}`}>
              {result.modelName}
            </Link>
            {result.routeAdded
              ? ` via ${result.providerId}.`
              : " with no route yet."}{" "}
            {result.routeAdded && !result.hadKeys
              ? "Add a key before sending traffic. "
              : ""}
            Canonical id: <code className="mono">{result.modelId}</code>
          </Notice>
        </div>
      )}
    </Section>
  );
}
