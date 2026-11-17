import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { TOOL_TABS } from "../lib/constants";
import type { Provider, ProviderResource } from "../lib/types";
import { ChatPanel } from "../features/playground/ChatPanel";
import { ToolPanel } from "../features/playground/ToolPanel";
import { PageHeader, Tabs } from "../components/ui";

export function PlaygroundPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "chat";
  const providers = useApi<Provider[]>("/api/providers");
  const mappings = useApi<ProviderResource[]>("/api/provider-resources");

  const availability = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const tool of TOOL_TABS) {
      map[tool.id] = (mappings.data ?? []).some(
        (mapping) =>
          mapping.enabled &&
          mapping.capabilities.includes(tool.capability as never),
      );
    }
    return map;
  }, [mappings.data]);

  const setTab = (next: string) => {
    const nextParams = new URLSearchParams(params);
    if (next === "chat") nextParams.delete("tab");
    else nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  };

  const activeTool = TOOL_TABS.find((tool) => tool.id === tab);

  return (
    <div className="page">
      <PageHeader
        title="Playground"
        subtitle="Send real requests through the routing core. Every response exposes the route that served it."
        actions={
          <Tabs
            label="Playground capability"
            value={tab}
            onChange={setTab}
            items={[
              { id: "chat", label: "Chat" },
              ...TOOL_TABS.map((tool) => ({
                id: tool.id,
                label: tool.label,
              })),
            ]}
          />
        }
      />

      {tab === "chat" || !activeTool ? (
        <ChatPanel />
      ) : (
        <ToolPanel
          key={activeTool.id}
          tool={activeTool.id}
          providers={providers.data ?? []}
          available={availability[activeTool.id] ?? false}
        />
      )}
    </div>
  );
}
