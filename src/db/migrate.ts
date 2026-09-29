import "dotenv/config";
import { loadConfig } from "../shared/config.js";
import { openDatabase } from "./sqlite-store.js";

// `pnpm db:migrate` — SQLite schema is applied idempotently on open.
const config = loadConfig();
const db = openDatabase(config.databasePath);
console.log(`[api-router] database ready at ${config.databasePath}`);
db.close();
