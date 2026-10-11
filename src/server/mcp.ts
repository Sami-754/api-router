import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// MCP wrapper around the running router. Thin forwarder only — ALL routing
// (eligibility, policy scoring, per-key rotation, fallback, accounting) runs
// in the router core, so every MCP tool call inherits it with zero extra
// logic here. Same pattern as the /v1/responses and /v1/messages shims.
//
// Run: `pnpm mcp` (env ROUTER_URL, default http://127.0.0.1:4500).
// Client config: { "command": "pnpm", "args": ["mcp"], "cwd": "<repo>" }.

export interface McpOptions {
  routerUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  name?: string;
  version?: string;
}

const providerField = z
  .string()
  .optional()
  .describe(
    "Pin to one provider (e.g. exa, tavily, firecrawl). Omit for auto-routing.",
  );

const policyField = z
  .enum(["auto", "burn", "preserve", "fast", "reliable", "cheap", "priority"])
  .optional()
  .describe("Routing policy. Omit for the server default.");

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function createMcpServer(opts: McpOptions): McpServer {
  const base = opts.routerUrl.replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const server = new McpServer({
    name: opts.name ?? "api-router",
    version: opts.version ?? "0.1.0",
  });

  const post = async (
    path: string,
    body: Record<string, unknown>,
  ): Promise<ToolResult> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
      if (!res.ok) {
        const msg =
          (json as { error?: { message?: string } })?.error?.message ??
          `router HTTP ${res.status}`;
        return { content: [{ type: "text", text: msg }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(json) }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text", text: `router request failed: ${msg}` }],
        isError: true,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const routingOf = (a: { provider?: string; policy?: string }) => ({
    ...(a.provider ? { provider: a.provider } : {}),
    ...(a.policy ? { policy: a.policy } : {}),
  });

  server.registerTool(
    "web_search",
    {
      description:
        "Web search through the router (auto-routes across Exa/Tavily/Firecrawl keys with fallback).",
      inputSchema: z.object({
        query: z.string().min(1).describe("Search query"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Max results (default 5)"),
        provider: providerField,
        policy: policyField,
      }),
    },
    async (a) =>
      post("/v1/tools/search", {
        query: a.query,
        maxResults: a.maxResults,
        routing: routingOf(a),
      }),
  );

  server.registerTool(
    "web_scrape",
    {
      description: "Scrape one page to markdown through the router.",
      inputSchema: z.object({
        url: z.string().url().describe("Page URL to scrape"),
        provider: providerField,
        policy: policyField,
      }),
    },
    async (a) =>
      post("/v1/tools/scrape", { url: a.url, routing: routingOf(a) }),
  );

  server.registerTool(
    "web_extract",
    {
      description: "Extract content from up to 20 URLs through the router.",
      inputSchema: z.object({
        urls: z.array(z.string().url()).min(1).max(20).describe("Page URLs"),
        query: z.string().optional().describe("Focus query for extraction"),
        provider: providerField,
        policy: policyField,
      }),
    },
    async (a) =>
      post("/v1/tools/extract", {
        urls: a.urls,
        query: a.query,
        routing: routingOf(a),
      }),
  );

  server.registerTool(
    "web_crawl",
    {
      description:
        "Crawl a site through the router (may take a while; polled server-side).",
      inputSchema: z.object({
        url: z.string().url().describe("Starting URL"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max pages (default 20)"),
        provider: providerField,
        policy: policyField,
      }),
    },
    async (a) =>
      post("/v1/tools/crawl", {
        url: a.url,
        limit: a.limit,
        routing: routingOf(a),
      }),
  );

  server.registerTool(
    "web_map",
    {
      description: "Discover URLs on a site through the router.",
      inputSchema: z.object({
        url: z.string().url().describe("Site URL"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Max links (default 100)"),
        provider: providerField,
        policy: policyField,
      }),
    },
    async (a) =>
      post("/v1/tools/map", {
        url: a.url,
        limit: a.limit,
        routing: routingOf(a),
      }),
  );

  server.registerTool(
    "chat",
    {
      description:
        "LLM chat through the router (auto-routes across provider keys; provider::model pins one).",
      inputSchema: z.object({
        model: z
          .string()
          .min(1)
          .describe(
            'Logical model ("nemotron-...") or pinned ("groq::nemotron-...")',
          ),
        message: z.string().min(1).describe("User message"),
        provider: providerField,
        policy: policyField,
      }),
    },
    async (a) =>
      post("/v1/chat/completions", {
        model: a.model,
        messages: [{ role: "user", content: a.message }],
        routing: routingOf(a),
      }),
  );

  return server;
}

// stdio entrypoint — only when executed directly (`pnpm mcp`), never on import.
const invokedAs = process.argv[1] ?? "";
if (
  invokedAs.endsWith("src/server/mcp.ts") ||
  invokedAs.endsWith("dist/server/mcp.js")
) {
  const server = createMcpServer({
    routerUrl: process.env.ROUTER_URL ?? "http://127.0.0.1:4500",
    timeoutMs: Number(process.env.ROUTER_TIMEOUT_MS ?? 90_000),
  });
  await server.connect(new StdioServerTransport());
  console.error(
    `[api-router-mcp] serving tools from ${process.env.ROUTER_URL ?? "http://127.0.0.1:4500"}`,
  );
}
