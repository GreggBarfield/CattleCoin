// Sends tokens for any purchase that is still waiting or that failed earlier.
//   node scripts\retry_chain_deliveries.mjs
// Safe to run any time and as often as you like: a purchase that was already
// delivered is never sent twice.
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "..", "..", ".env"), quiet: true });

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_HOST, POSTGRES_PORT } = process.env;
  if (!POSTGRES_USER || !POSTGRES_DB) return null;
  return `postgresql://${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(POSTGRES_PASSWORD || "")}@${POSTGRES_HOST || "localhost"}:${POSTGRES_PORT || 5432}/${POSTGRES_DB}`;
}

const cs = connectionString();
if (!cs) { console.error("No database settings found in .env."); process.exit(1); }

// loaded after .env is read, because the blockchain code reads its settings when it loads
const { retryPendingDeliveries } = await import("../src/lib/chainDelivery.js");

const pool = new pg.Pool({ connectionString: cs });
try {
  const results = await retryPendingDeliveries(pool, 50);
  if (results.length === 0) console.log("Nothing waiting. All purchases are delivered or skipped.");
  else console.table(results.map((r) => ({ purchase: r.transactionId, result: r.status, txHash: r.txHash || "" })));
} catch (err) {
  const inner = (err.errors || []).map((e) => e.code || e.message).filter(Boolean).join(", ");
  console.error("FAILED:", err.message || err.code || inner || String(err));
  if (inner) console.error("Details:", inner);
  if (err.code === "ECONNREFUSED" || /ECONNREFUSED/.test(inner)) console.error("The database did not answer. Is it running (Docker Desktop for the local one), and is the port in .env right?");
  process.exitCode = 1;
} finally {
  await pool.end();
}
// the blockchain connection can keep the process alive after a failure, so exit explicitly
process.exit(process.exitCode ?? 0);
