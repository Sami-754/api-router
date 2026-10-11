import { z } from "zod";

export const capabilitySchema = z.enum([
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
]);

export const policySchema = z.enum([
  "auto",
  "burn",
  "preserve",
  "fast",
  "reliable",
  "cheap",
  "priority",
]);

export const providerSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-_]*$/i),
  displayName: z.string().min(1).max(128),
  baseUrl: z.string().url().optional().nullable(),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(100),
  metadata: z.record(z.unknown()).optional(),
});

export const accountSchema = z.object({
  id: z.string().min(1).max(128),
  providerId: z.string().min(1),
  displayName: z.string().max(128).optional().nullable(),
  enabled: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
});

export const credentialCreateSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  accountId: z.string().min(1),
  label: z.string().max(128).optional().nullable(),
  /** Raw secret; server encrypts before storage. Never persisted in plain text. */
  secret: z.string().min(1).max(4096),
  status: z.enum(["active", "disabled", "invalid"]).default("active"),
});

export const resourceSchema = z.object({
  id: z.string().min(1).max(256),
  kind: z.enum(["llm_model", "capability"]),
  displayName: z.string().min(1).max(256),
  capabilities: z.array(capabilitySchema).default([]),
  contextTokens: z.number().int().positive().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

export const providerResourceSchema = z.object({
  id: z.string().min(1).max(256).optional(),
  resourceId: z.string().min(1),
  providerId: z.string().min(1),
  upstreamId: z.string().min(1).max(512),
  capabilities: z.array(capabilitySchema).default([]),
  contextTokens: z.number().int().positive().optional().nullable(),
  enabled: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
});

export const quotaWindowSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  credentialId: z.string().min(1),
  providerResourceId: z.string().min(1).optional().nullable(),
  metric: z.enum([
    "requests",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "credits",
    "usd",
    "searches",
    "pages",
    "crawl_units",
  ]),
  limitValue: z.number().nonnegative(),
  usedValue: z.number().nonnegative().default(0),
  remainingValue: z.number().nonnegative().optional().nullable(),
  windowKind: z.enum([
    "rolling_seconds",
    "calendar_minute",
    "calendar_hour",
    "calendar_day",
    "calendar_week",
    "calendar_month",
    "fixed",
  ]),
  windowSeconds: z.number().int().positive().optional().nullable(),
  windowStartedAt: z.string().datetime().optional().nullable(),
  resetAt: z.string().datetime().optional().nullable(),
  hard: z.boolean().default(true),
  source: z
    .enum([
      "provider_api",
      "response_headers",
      "configured",
      "learned",
      "estimated",
    ])
    .default("configured"),
  confidence: z.number().min(0).max(1).optional().nullable(),
});

export const routingHintSchema = z.object({
  provider: z.string().min(1).optional().nullable(),
  account: z.string().min(1).optional().nullable(),
  credential: z.string().min(1).optional().nullable(),
  policy: policySchema.optional().nullable(),
  allowCrossProviderFallback: z.boolean().optional().nullable(),
  estimatedCost: z.number().nonnegative().optional().nullable(),
});

const chatMessageSchema = z.object({
  role: z.string().min(1),
  content: z.union([z.string(), z.array(z.unknown())]),
  name: z.string().optional(),
  tool_calls: z.array(z.unknown()).optional(),
  tool_call_id: z.string().optional(),
});

export const chatCompletionsSchema = z.object({
  model: z.string().min(1).max(512),
  messages: z.array(chatMessageSchema).min(1).max(500),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().max(1_000_000).optional(),
  max_completion_tokens: z.number().int().positive().max(1_000_000).optional(),
  stream: z.boolean().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
  user: z.string().max(256).optional(),
  routing: routingHintSchema.optional(),
});

export const searchRequestSchema = z.object({
  query: z.string().min(1).max(2000),
  maxResults: z.number().int().min(1).max(50).default(5),
  includeDomains: z.array(z.string().max(256)).max(50).optional(),
  excludeDomains: z.array(z.string().max(256)).max(50).optional(),
  recencyDays: z.number().int().min(1).max(3650).optional(),
  routing: routingHintSchema.optional(),
});

export const scrapeRequestSchema = z.object({
  url: z.string().url().max(2048),
  maxChars: z.number().int().min(100).max(500_000).default(50_000),
  onlyMainContent: z.boolean().default(true),
  routing: routingHintSchema.optional(),
});

export const extractRequestSchema = z.object({
  urls: z.array(z.string().url().max(2048)).min(1).max(20),
  query: z.string().max(2000).optional(),
  routing: routingHintSchema.optional(),
});

export const crawlRequestSchema = z.object({
  url: z.string().url().max(2048),
  limit: z.number().int().min(1).max(1000).default(20),
  includePaths: z.array(z.string().max(512)).max(100).optional(),
  excludePaths: z.array(z.string().max(512)).max(100).optional(),
  routing: routingHintSchema.optional(),
});

export const mapRequestSchema = z.object({
  url: z.string().url().max(2048),
  limit: z.number().int().min(1).max(5000).default(100),
  routing: routingHintSchema.optional(),
});
