import "dotenv/config";
import { loadConfig } from "../shared/config.js";
import { runValidationJob } from "./validate.js";
import { boot } from "./boot.js";

const config = loadConfig();
if (!config.masterKey) {
  // Credential encryption requires MASTER_KEY; chat routing without stored
  // credentials will simply report "no eligible routes".
  console.warn("[api-router] MASTER_KEY is not set — credential storage is disabled until configured. See .env.example.");
}

const { app, store, registry } = await boot();

await app.listen({ port: config.port, host: config.host });
console.log(`[api-router] listening on http://${config.host}:${config.port}`);

// Optional background credential validation (off by default — enable with
// VALIDATE_INTERVAL_H, e.g. 24, to re-probe stale keys in small batches).
const intervalH = Number(process.env.VALIDATE_INTERVAL_H ?? 0);
const batchSize = Number(process.env.VALIDATE_BATCH ?? 25);
if (intervalH > 0 && config.masterKey) {
  const run = async () => {
    try {
      const s = await runValidationJob({ store, registry, limit: batchSize, maxAgeHours: intervalH, staggerMs: 1000 });
      console.log(`[api-router] validation job: ${s.ok}/${s.checked} ok, ${s.invalid} invalid, ${s.skippedFresh} fresh-skipped`);
    } catch (e) {
      console.warn(`[api-router] validation job failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  console.log(`[api-router] validation job every ${intervalH}h, ${batchSize} keys per run`);
  setInterval(run, intervalH * 3_600_000).unref();
}
