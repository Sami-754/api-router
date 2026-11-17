import { useEffect, useState, type FormEvent } from "react";
import { POLICIES } from "../../lib/constants";
import type { Provider } from "../../lib/types";
import { ResultView } from "./ResultView";
import { Badge, Button, CopyButton, Field, Notice } from "../../components/ui";

interface ToolResult {
  json: unknown;
  via: string | null;
  attempts: string | null;
  latencyMs: number;
}

const DEFAULTS: Record<string, Record<string, string>> = {
  search: { query: "", maxResults: "5" },
  scrape: { url: "", maxChars: "8000", onlyMainContent: "true" },
  extract: { urls: "", query: "" },
  crawl: { url: "", limit: "10" },
  map: { url: "", limit: "50" },
};

export function ToolPanel({
  tool,
  providers,
  available,
}: {
  tool: string;
  providers: Provider[];
  available: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    DEFAULTS[tool] ?? {},
  );
  const [providerPin, setProviderPin] = useState("");
  const [policy, setPolicy] = useState("");
  const [result, setResult] = useState<ToolResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`router:playground:${tool}`);
      setValues(
        raw
          ? { ...(DEFAULTS[tool] ?? {}), ...JSON.parse(raw) }
          : (DEFAULTS[tool] ?? {}),
      );
    } catch {
      setValues(DEFAULTS[tool] ?? {});
    }
    setResult(null);
    setError(null);
  }, [tool]);

  const value = (key: string) => values[key] ?? DEFAULTS[tool]?.[key] ?? "";

  const setValue = (key: string, next: string) => {
    const updated = { ...values, [key]: next };
    setValues(updated);
    try {
      window.localStorage.setItem(
        `router:playground:${tool}`,
        JSON.stringify(updated),
      );
    } catch {
      /* unavailable */
    }
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = {};
    if (tool === "search") {
      payload.query = value("query");
      if (value("maxResults")) payload.maxResults = Number(value("maxResults"));
    } else if (tool === "scrape") {
      payload.url = value("url");
      if (value("maxChars")) payload.maxChars = Number(value("maxChars"));
      payload.onlyMainContent = value("onlyMainContent") === "true";
    } else if (tool === "extract") {
      payload.urls = value("urls")
        .split("\n")
        .map((url) => url.trim())
        .filter(Boolean)
        .slice(0, 20);
      if (value("query")) payload.query = value("query");
    } else if (tool === "crawl") {
      payload.url = value("url");
      if (value("limit")) payload.limit = Number(value("limit"));
    } else {
      payload.url = value("url");
      if (value("limit")) payload.limit = Number(value("limit"));
    }
    const routing: Record<string, string> = {};
    if (providerPin.trim()) routing.provider = providerPin.trim();
    if (policy) routing.policy = policy;
    if (Object.keys(routing).length) payload.routing = routing;
    return payload;
  };

  const run = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const started = Date.now();
    try {
      const response = await fetch(`/v1/tools/${tool}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error?.message || `HTTP ${response.status}`);
      }
      setResult({
        json,
        via: response.headers.get("x-router-via"),
        attempts: response.headers.get("x-router-attempts"),
        latencyMs: Date.now() - started,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const payload = JSON.stringify(buildPayload(), null, 2);
  const curl = `curl -s ${location.origin}/v1/tools/${tool} \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(buildPayload())}'`;

  return (
    <div className="pg-layout">
      <aside className="pg-side">
        <form className="stack" style={{ gap: 12 }} onSubmit={run}>
          {tool === "search" && (
            <>
              <Field label="Query">
                <input
                  value={value("query")}
                  onChange={(event) => setValue("query", event.target.value)}
                  placeholder="latest news about routing"
                  required
                />
              </Field>
              <Field label="Max results">
                <input
                  type="number"
                  min="1"
                  value={value("maxResults")}
                  onChange={(event) =>
                    setValue("maxResults", event.target.value)
                  }
                />
              </Field>
            </>
          )}
          {tool === "scrape" && (
            <>
              <Field label="URL">
                <input
                  type="url"
                  value={value("url")}
                  onChange={(event) => setValue("url", event.target.value)}
                  placeholder="https://example.com"
                  required
                />
              </Field>
              <div className="form-grid">
                <Field label="Max chars">
                  <input
                    type="number"
                    value={value("maxChars")}
                    onChange={(event) =>
                      setValue("maxChars", event.target.value)
                    }
                  />
                </Field>
                <Field label="Main content">
                  <select
                    value={value("onlyMainContent")}
                    onChange={(event) =>
                      setValue("onlyMainContent", event.target.value)
                    }
                  >
                    <option value="true">only main</option>
                    <option value="false">full page</option>
                  </select>
                </Field>
              </div>
            </>
          )}
          {tool === "extract" && (
            <>
              <Field label="URLs" hint="One per line, up to 20.">
                <textarea
                  value={value("urls")}
                  onChange={(event) => setValue("urls", event.target.value)}
                  rows={4}
                  placeholder={"https://example.com\nhttps://example.org"}
                  required
                />
              </Field>
              <Field label="Query" hint="Optional extraction prompt.">
                <input
                  value={value("query")}
                  onChange={(event) => setValue("query", event.target.value)}
                  placeholder="what is this about?"
                />
              </Field>
            </>
          )}
          {(tool === "crawl" || tool === "map") && (
            <>
              <Field label="URL">
                <input
                  type="url"
                  value={value("url")}
                  onChange={(event) => setValue("url", event.target.value)}
                  placeholder="https://example.com"
                  required
                />
              </Field>
              <Field label={tool === "crawl" ? "Page limit" : "Link limit"}>
                <input
                  type="number"
                  min="1"
                  value={value("limit")}
                  onChange={(event) => setValue("limit", event.target.value)}
                />
              </Field>
            </>
          )}
          <div className="form-grid">
            <Field label="Provider pin">
              <select
                value={providerPin}
                onChange={(event) => setProviderPin(event.target.value)}
              >
                <option value="">(none)</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Policy">
              <select
                value={policy}
                onChange={(event) => setPolicy(event.target.value)}
              >
                <option value="">default</option>
                {POLICIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {!available && (
            <Notice tone="warn">
              No enabled provider mapping supports <strong>web.{tool}</strong>.
              Add one in Models before running this capability.
            </Notice>
          )}
          <Button
            type="submit"
            variant="primary"
            icon="send"
            busy={busy}
            disabled={!available}
          >
            Run {tool}
          </Button>
          <CopyButton value={curl} label="Copy as curl" />
          <details>
            <summary className="copy-btn" style={{ cursor: "pointer" }}>
              request preview
            </summary>
            <pre className="code-block" style={{ marginTop: 8 }}>
              {payload}
            </pre>
          </details>
        </form>
      </aside>

      <section className="pg-main">
        <div className="pg-main__head">
          <span className="pg-main__title">Result</span>
          {result && (
            <div className="row row--wrap" style={{ gap: 4 }}>
              {result.via && <Badge tone="accent">via {result.via}</Badge>}
              {result.attempts && <Badge>{result.attempts} attempts</Badge>}
              <Badge>{result.latencyMs}ms</Badge>
            </div>
          )}
        </div>
        <div className="tool-output">
          {error && <Notice tone="error">{error}</Notice>}
          {result ? (
            <ResultView capability={tool} json={result.json} />
          ) : (
            <div className="chat-empty">
              Run a {tool} request to inspect the normalized result and the
              route that served it.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
