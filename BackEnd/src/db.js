import pkg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const { Pool, types, defaults } = pkg;

// Times: every time column in this database is TIMESTAMP (no time zone).
// Rule: they all hold UTC. The database session runs in UTC (forced below), so
// NOW()/CURRENT_TIMESTAMP defaults store UTC.
// node-postgres, left alone, uses the Node server's LOCAL zone in both
// directions. The live server's Windows zone is Central, so:
//   - reading: every UTC time came back 5 hours ahead (6 in winter)
//   - writing: a JS Date sent as a query value was stored as Central wall time
//     (Postgres drops the offset when saving into a TIMESTAMP column)
// These two settings make node-postgres use UTC both ways.
// 1114 = the Postgres type id for TIMESTAMP WITHOUT TIME ZONE.
types.setTypeParser(1114, (value) =>
  value === null ? null : new Date(value.replace(" ", "T") + "Z")
);
defaults.parseInputDatesAsUTC = true;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Keep every connection in UTC, so NOW()/CURRENT_TIMESTAMP defaults store
  // UTC no matter what the database server's own default time zone is.
  options: "-c TimeZone=UTC",
});

export default pool;