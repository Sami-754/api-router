export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  base_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  display_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_provider ON accounts(provider_id);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  label TEXT,
  secret_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_validated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credentials_account ON credentials(account_id);
CREATE INDEX IF NOT EXISTS idx_credentials_provider ON credentials(provider_id);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',
  context_tokens INTEGER,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_resources (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  upstream_id TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',
  context_tokens INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(resource_id, provider_id, upstream_id)
);
CREATE INDEX IF NOT EXISTS idx_presource_resource ON provider_resources(resource_id);
CREATE INDEX IF NOT EXISTS idx_presource_provider ON provider_resources(provider_id);

CREATE TABLE IF NOT EXISTS quota_windows (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  provider_resource_id TEXT REFERENCES provider_resources(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  limit_value REAL NOT NULL,
  used_value REAL NOT NULL DEFAULT 0,
  remaining_value REAL,
  window_kind TEXT NOT NULL,
  window_seconds INTEGER,
  window_started_at TEXT,
  reset_at TEXT,
  hard INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'configured',
  confidence REAL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quota_cred ON quota_windows(credential_id);
CREATE INDEX IF NOT EXISTS idx_quota_reset ON quota_windows(reset_at);

CREATE TABLE IF NOT EXISTS health_snapshots (
  credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  provider_resource_id TEXT REFERENCES provider_resources(id) ON DELETE CASCADE,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_failure_at TEXT,
  last_error_class TEXT,
  cooldown_until TEXT,
  latency_ema_ms REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (credential_id, provider_resource_id)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  provider_resource_id TEXT REFERENCES provider_resources(id) ON DELETE SET NULL,
  metric TEXT NOT NULL,
  quantity REAL NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_cred ON usage_events(credential_id);
CREATE INDEX IF NOT EXISTS idx_usage_req ON usage_events(request_id);

CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT PRIMARY KEY,
  requested_resource_id TEXT NOT NULL,
  requested_capability TEXT,
  provider_pin TEXT,
  account_pin TEXT,
  credential_pin TEXT,
  policy TEXT NOT NULL,
  selected_provider_id TEXT,
  selected_account_id TEXT,
  selected_credential_id TEXT,
  selected_upstream_id TEXT,
  selection_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  error_class TEXT,
  error_message TEXT,
  latency_ms REAL NOT NULL,
  prompt_tokens REAL,
  completion_tokens REAL,
  total_tokens REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reql_created ON request_logs(created_at);
`;
