import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { POLICIES } from "../../lib/constants";
import type {
  HealthResponse,
  ModelSyncSummary,
  Settings,
  ValidationSummary,
} from "../../lib/types";
import { useToast } from "../../components/ToastProvider";
import { Icon } from "../../components/Icon";
import {
  Button,
  CopyButton,
  Dialog,
  Field,
  KeyValue,
  Notice,
  Section,
} from "../../components/ui";

const ENDPOINTS = [
  { label: "OpenAI base URL", path: "/v1" },
  { label: "Chat completions", path: "/v1/chat/completions" },
  { label: "Models", path: "/v1/models" },
  { label: "Responses shim", path: "/v1/responses" },
  { label: "Anthropic messages", path: "/v1/messages" },
  { label: "Search", path: "/v1/tools/search" },
  { label: "Scrape", path: "/v1/tools/scrape" },
  { label: "Extract", path: "/v1/tools/extract" },
  { label: "Crawl", path: "/v1/tools/crawl" },
  { label: "Map", path: "/v1/tools/map" },
];

export function SettingsDrawer({
  open,
  onClose,
  settings,
  reloadSettings,
  health,
}: {
  open: boolean;
  onClose: () => void;
  settings?: Settings;
  reloadSettings: () => void;
  health?: HealthResponse | null;
}) {
  const { notify } = useToast();
  const [policy, setPolicy] = useState("auto");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [validateProvider, setValidateProvider] = useState("");
  const [validateLimit, setValidateLimit] = useState("25");
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<ModelSyncSummary | null>(null);

  useEffect(() => {
    if (settings?.defaultPolicy) setPolicy(settings.defaultPolicy);
  }, [settings?.defaultPolicy]);

  const savePolicy = async (event: FormEvent) => {
    event.preventDefault();
    setSavingPolicy(true);
    try {
      const result = await api.patch<Settings>("/api/settings", {
        defaultPolicy: policy,
      });
      notify(`Default policy → ${result.defaultPolicy}`, "ok");
      reloadSettings();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingPolicy(false);
    }
  };

  const runValidation = async (event: FormEvent) => {
    event.preventDefault();
    setValidating(true);
    setValidation(null);
    try {
      const result = await api.post<ValidationSummary>(
        "/api/maintenance/validate",
        {
          provider: validateProvider.trim() || undefined,
          limit: Number(validateLimit) || 25,
        },
      );
      setValidation(result);
      notify(
        `Validated ${result.checked}: ${result.ok} ok, ${result.invalid} invalid`,
        result.invalid ? "error" : "ok",
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setValidating(false);
    }
  };

  const syncModels = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api.post<ModelSyncSummary>("/api/maintenance/sync");
      setSyncResult(result);
      notify(
        `Sync complete — ${result.mapped} mappings, ${result.pruned} pruned`,
        result.skipped.length ? "error" : "ok",
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSyncing(false);
    }
  };

  const origin = location.origin;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Settings"
      description="Runtime defaults, client endpoints and maintenance jobs."
      variant="drawer"
      size="lg"
      footer={
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      <Section
        title="Routing"
        description="Runtime setting; a restart resets it to DEFAULT_POLICY."
      >
        <form
          className="row"
          onSubmit={savePolicy}
          style={{ alignItems: "flex-end" }}
        >
          <Field label="Default policy">
            <select
              value={policy}
              onChange={(event) => setPolicy(event.target.value)}
            >
              {POLICIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" variant="primary" busy={savingPolicy}>
            Save
          </Button>
        </form>
      </Section>

      <Section
        title="Client connection"
        description="No auth — this is a local-first single-user service."
      >
        <div className="stack">
          {ENDPOINTS.map((endpoint) => (
            <div className="copy-row" key={endpoint.path}>
              <span
                className="muted small"
                style={{ width: 132, flex: "0 0 auto" }}
              >
                {endpoint.label}
              </span>
              <span className="mono grow truncate">
                {origin + endpoint.path}
              </span>
              <CopyButton value={origin + endpoint.path} compact />
            </div>
          ))}
        </div>
        <Notice tone="info">
          <span className="row" style={{ gap: 6 }}>
            <Icon name="info" size={14} />
            Bind to loopback or trust the local network. There is no dashboard
            auth.
          </span>
        </Notice>
      </Section>

      <Section
        title="Maintenance"
        description="Live probes and model catalog sync."
      >
        <form className="stack" onSubmit={runValidation}>
          <div className="form-grid">
            <Field label="Provider" hint="Empty = all providers.">
              <input
                value={validateProvider}
                onChange={(event) => setValidateProvider(event.target.value)}
                placeholder="(all)"
              />
            </Field>
            <Field label="Limit">
              <input
                type="number"
                min={1}
                max={500}
                value={validateLimit}
                onChange={(event) => setValidateLimit(event.target.value)}
              />
            </Field>
          </div>
          <div className="row">
            <Button
              type="submit"
              variant="secondary"
              icon="check"
              busy={validating}
            >
              Validate stale keys
            </Button>
            <Button
              type="button"
              variant="secondary"
              icon="refresh"
              busy={syncing}
              onClick={() => void syncModels()}
            >
              Sync models
            </Button>
          </div>
        </form>
        {validation && (
          <div style={{ marginTop: 10 }}>
            <Notice tone={validation.invalid ? "warn" : "info"}>
              Checked {validation.checked}: {validation.ok} valid,{" "}
              {validation.invalid} invalid, {validation.inconclusive ?? 0}{" "}
              inconclusive, {validation.skippedFresh} fresh skipped.
            </Notice>
          </div>
        )}
        {syncResult && (
          <div style={{ marginTop: 10 }}>
            <Notice tone={syncResult.skipped.length ? "warn" : "info"}>
              {syncResult.mapped} mappings, {syncResult.pruned} pruned,{" "}
              {syncResult.autoFreeMappings} auto:free rows.
              {syncResult.skipped.length
                ? ` Discovery failed: ${syncResult.skipped.join(", ")}.`
                : ""}
            </Notice>
          </div>
        )}
      </Section>

      <Section title="Service">
        <KeyValue
          columns={2}
          items={[
            { key: "Service", value: health?.service ?? "api-router" },
            { key: "Version", value: health?.version ?? "—" },
            {
              key: "Health",
              value: health ? (health.ok ? "online" : "offline") : "unknown",
            },
            {
              key: "Dashboard",
              value: <span className="mono">/dashboard</span>,
            },
          ]}
        />
      </Section>
    </Dialog>
  );
}
