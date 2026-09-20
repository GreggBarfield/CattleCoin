import pool from "../db.js";

// Small helpers shared by the settlement, fees and funds routes.
// All money math in these routes is done in whole cents (integers).

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);
export const toCents = (v) => Math.round(Number(v) * 100);
export const dollars = (cents) => Number(cents) / 100;
export const money = (cents) => (Number(cents) / 100).toFixed(2);

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function sendError(res, label, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(`${label} error:`, err);
  return res.status(500).json({ error: "Request failed." });
}
