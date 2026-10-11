export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  masterKey: string;
  defaultPolicy: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "127.0.0.1",
    databasePath: env.DATABASE_PATH ?? "./data/router.db",
    masterKey: env.MASTER_KEY ?? "",
    defaultPolicy: env.DEFAULT_POLICY ?? "auto",
    logLevel: env.LOG_LEVEL ?? "info",
  };
}

/** Validate user-supplied custom base URLs (SSRF guard basics). */
export function validateBaseUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`invalid base URL: ${raw}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("base URL must be http(s)");
  }
  const host = u.hostname.toLowerCase();
  const blocked = [
    "localhost",
    "metadata.google.internal",
    "169.254.169.254",
    "[::ffff:169.254.169.254]",
  ];
  if (blocked.includes(host)) throw new Error("base URL host is not allowed");
  if (host.startsWith("127.") || host === "::1" || host === "[::1]") {
    throw new Error("base URL host is not allowed");
  }
  if (u.username || u.password)
    throw new Error("base URL must not contain credentials");
  return u;
}
