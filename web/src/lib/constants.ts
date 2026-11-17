import type { Capability, QuotaMetric, QuotaWindowKind } from "./types";

export const CAPABILITIES: Capability[] = [
  "llm.chat",
  "llm.responses",
  "llm.tools",
  "llm.vision",
  "llm.embeddings",
  "web.search",
  "web.extract",
  "web.scrape",
  "web.crawl",
  "web.map",
];

export const LLM_CAPABILITIES: Capability[] = CAPABILITIES.filter(
  (capability) => capability.startsWith("llm."),
);

export const POLICIES = [
  "auto",
  "burn",
  "preserve",
  "fast",
  "reliable",
  "cheap",
  "priority",
] as const;

export const QUOTA_METRICS: QuotaMetric[] = [
  "requests",
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "credits",
  "usd",
  "searches",
  "pages",
  "crawl_units",
];

export const WINDOW_KINDS: QuotaWindowKind[] = [
  "calendar_minute",
  "calendar_hour",
  "calendar_day",
  "calendar_week",
  "calendar_month",
  "rolling_seconds",
  "fixed",
];

export const QUOTA_SOURCES = [
  "configured",
  "provider_api",
  "response_headers",
  "learned",
  "estimated",
] as const;

export const TOOL_TABS = [
  { id: "search", label: "Search", capability: "web.search" },
  { id: "scrape", label: "Scrape", capability: "web.scrape" },
  { id: "extract", label: "Extract", capability: "web.extract" },
  { id: "crawl", label: "Crawl", capability: "web.crawl" },
  { id: "map", label: "Map", capability: "web.map" },
] as const;
