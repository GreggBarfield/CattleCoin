// Runs one SQL file, or one query, against the database the app uses.
//   node scripts\run_sql.mjs Database\migrations\018_InvestorWallets.sql
//   node scripts\run_sql.mjs -q "SELECT count(*) FROM token_pools"
// Reads the same .env the app reads (the one in the folder above BackEnd).
// Never prints the password or the connection string.
import fs from "fs";
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

const args = process.argv.slice(2);
let sql;
if (args[0] === "-q" && args[1]) sql = args[1];
else if (args[0]) sql = fs.readFileSync(path.resolve(args[0]), "utf8");
else { console.error("Give a .sql file path, or -q \"SELECT ...\""); process.exit(1); }

const cs = connectionString();
if (!cs) { console.error("No database settings found in .env (need DATABASE_URL or POSTGRES_USER/POSTGRES_DB)."); process.exit(1); }

const pool = new pg.Pool({ connectionString: cs });
try {
  const res = await pool.query(sql);
  const list = Array.isArray(res) ? res : [res];
  for (const r of list) {
    if (r.rows && r.rows.length) console.table(r.rows);
  }
  console.log("OK");
} catch (err) {
  const inner = (err.errors || []).map((e) => e.code || e.message).filter(Boolean).join(", ");
  console.error("FAILED:", err.message || err.code || inner || String(err));
  if (inner) console.error("Details:", inner);
  if (err.code === "ECONNREFUSED" || /ECONNREFUSED/.test(inner)) console.error("The database did not answer. Is it running (Docker Desktop for the local one), and is the port in .env right?");
  process.exitCode = 1;
} finally {
  await pool.end();
}
