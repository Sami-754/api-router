import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader, Section, Tabs } from "../components/ui";
import { AddKeyForm } from "../features/keys/AddKeyForm";
import { AddModelForm } from "../features/models/AddModelForm";

type AddTab = "key" | "model";

export function AddPage() {
  const [tab, setTab] = useState<AddTab>("key");

  return (
    <div className="page">
      <PageHeader
        title="Add"
        subtitle="Store a provider API key, or create a model route manually. Keys are the normal path."
      />

      <div className="row row--between" style={{ marginBottom: 12 }}>
        <Tabs
          label="What to add"
          value={tab}
          onChange={(value) => setTab(value as AddTab)}
          items={[
            { id: "key", label: "API key" },
            { id: "model", label: "Model route" },
          ]}
        />
        <span className="muted small">
          {tab === "key"
            ? "Pick provider → paste key → label"
            : "Canonical model plus provider mapping"}
        </span>
      </div>

      <div className="admin-layout">
        {tab === "key" ? <AddKeyForm /> : <AddModelForm />}

        <div className="admin-side">
          {tab === "key" ? (
            <Section
              title="How keys work"
              description="Provider rows and accounts are plumbing; you only supply the key."
            >
              <ol className="admin-steps">
                <li>
                  Pick the provider adapter. Tavily/Exa/Firecrawl can be created
                  from a key even if they have no provider row yet.
                </li>
                <li>
                  Paste the API key. It is encrypted at rest and never returned
                  by the API.
                </li>
                <li>
                  Label it so multiple keys are easy to tell apart. The key goes
                  under <code className="mono">provider-main</code> unless that
                  account already exists.
                </li>
                <li>
                  Tool keys automatically get capability mappings, so a Tavily
                  key immediately serves{" "}
                  <code className="mono">web.search</code>, scrape, extract,
                  crawl and map.
                </li>
                <li>
                  Keys are not probed automatically because probes can spend
                  provider quota. Validate from the provider page when ready.
                </li>
              </ol>
            </Section>
          ) : (
            <Section
              title="How model routes work"
              description="Models are canonical; routes are provider-specific."
            >
              <ol className="admin-steps">
                <li>
                  Pick a provider that already exists. Providers and adapters
                  are added in code, not here.
                </li>
                <li>
                  Use the provider's exact upstream model ID for the route. The
                  logical model name is what clients call.
                </li>
                <li>
                  Add an active key on the provider page. A mapping without a
                  key is stored but cannot execute.
                </li>
                <li>
                  To give the same logical model a second provider, submit the
                  same model name again with another provider.
                </li>
                <li>
                  For automatic catalog discovery, use{" "}
                  <Link to="/models">Sync models</Link> instead.
                </li>
              </ol>
            </Section>
          )}

          <Section title="Shortcuts">
            <div className="admin-links">
              <Link to="/providers">Providers, accounts and keys</Link>
              <Link to="/models">Browse models and routes</Link>
              <Link to="/playground">Test a route in Playground</Link>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
