import { HttpError, dollars } from "./routeHelpers.js";

// Fee terms shared by the fees, funds and settlement routes.
//
// Every fee is a PLACEHOLDER until an admin sets it. The platform defaults
// start at zero, and a herd cannot release investor money until it has its own
// fee terms row (created from the defaults, then adjusted per deal).
//
// Fee kinds:
//   raise fee      % of investor money, deducted when the money is released to
//                  the producer
//   per-head fee   flat dollars per head, charged to the producer, either on
//                  the first release ("raise") or out of the sale proceeds
//                  ("exit")
//   exit profit fee  % of each investor's profit at sale (payout minus what
//                  that investor paid), charged to the investor or the producer
//                  depending on exit_fee_payer
//
// Percentages are stored with 2 decimals (10.25 = 10.25%) and applied in
// basis points with floor rounding, in whole cents.

export const MAX_FEE_PCT = 25;
export const MAX_PER_HEAD_FEE = 500;
export const TIMINGS = ["raise", "exit"];
export const PAYERS = ["investor", "producer"];

export const pctToBps = (pct) => Math.round(Number(pct) * 100);
// floor(cents * bps / 10000), integer math
export const feeOnCents = (cents, bps) => Number((BigInt(cents) * BigInt(bps)) / 10000n);

export function shapeTerms(row) {
  if (!row) return null;
  return {
    raiseFeePct:       Number(row.raise_fee_pct),
    exitProfitFeePct:  Number(row.exit_profit_fee_pct),
    exitFeePayer:      row.exit_fee_payer,
    perHeadFee:        Number(row.per_head_fee),
    perHeadFeeTiming:  row.per_head_fee_timing,
    note:              row.note ?? null,
    lockedAt:          row.locked_at ?? null,
    updatedAt:         row.updated_at ?? null,
  };
}

export async function loadDefaults(db) {
  const r = await db.query("SELECT * FROM platform_fee_defaults WHERE id = 1");
  if (r.rowCount === 0) {
    throw new HttpError(500, "Platform fee defaults are missing - run migration 010.");
  }
  return r.rows[0];
}

export async function loadHerdTerms(db, herdId, { lock = false } = {}) {
  const r = await db.query(
    `SELECT * FROM herd_fee_terms WHERE herd_id = $1${lock ? " FOR UPDATE" : ""}`,
    [herdId]
  );
  return r.rows[0] ?? null;
}

function parseNumber(value, label, max) {
  const n = Number(value);
  if (value === "" || value === null || typeof value === "boolean" || !Number.isFinite(n)) {
    throw new HttpError(400, `${label} must be a number.`);
  }
  if (n < 0) throw new HttpError(400, `${label} cannot be negative.`);
  if (n > max) throw new HttpError(400, `${label} cannot be more than ${max}.`);
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-7) {
    throw new HttpError(400, `${label} can have at most 2 decimal places.`);
  }
  return Math.round(n * 100) / 100;
}

// Body keys -> validated column values. Anything the body leaves out keeps the
// value from `base` (an existing terms row or the platform defaults).
export function parseTermsInput(body, base) {
  const b = body ?? {};
  const out = {
    raise_fee_pct:       Number(base.raise_fee_pct),
    exit_profit_fee_pct: Number(base.exit_profit_fee_pct),
    exit_fee_payer:      base.exit_fee_payer,
    per_head_fee:        Number(base.per_head_fee),
    per_head_fee_timing: base.per_head_fee_timing,
  };
  if (b.raiseFeePct !== undefined)      out.raise_fee_pct = parseNumber(b.raiseFeePct, "raiseFeePct", MAX_FEE_PCT);
  if (b.exitProfitFeePct !== undefined) out.exit_profit_fee_pct = parseNumber(b.exitProfitFeePct, "exitProfitFeePct", MAX_FEE_PCT);
  if (b.perHeadFee !== undefined)       out.per_head_fee = parseNumber(b.perHeadFee, "perHeadFee", MAX_PER_HEAD_FEE);
  if (b.perHeadFeeTiming !== undefined) {
    if (!TIMINGS.includes(b.perHeadFeeTiming)) {
      throw new HttpError(400, `perHeadFeeTiming must be one of: ${TIMINGS.join(", ")}`);
    }
    out.per_head_fee_timing = b.perHeadFeeTiming;
  }
  if (b.exitFeePayer !== undefined) {
    if (!PAYERS.includes(b.exitFeePayer)) {
      throw new HttpError(400, `exitFeePayer must be one of: ${PAYERS.join(", ")}`);
    }
    out.exit_fee_payer = b.exitFeePayer;
  }
  return out;
}

// Money raised from investors vs money already released to the producer.
export async function getFundsPosition(db, herdId) {
  const raised = await db.query(
    "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM investor_payments WHERE herd_id = $1",
    [herdId]
  );
  const released = await db.query(
    "SELECT COALESCE(SUM(gross_amount), 0) AS total, COUNT(*) AS n FROM herd_releases WHERE herd_id = $1",
    [herdId]
  );
  const raisedCents = Math.round(Number(raised.rows[0].total) * 100);
  const releasedCents = Math.round(Number(released.rows[0].total) * 100);
  return {
    raisedCents,
    releasedCents,
    availableCents: raisedCents - releasedCents,
    paymentCount: Number(raised.rows[0].n),
    releaseCount: Number(released.rows[0].n),
  };
}

export function shapeFunds(f) {
  return {
    raised:        dollars(f.raisedCents),
    released:      dollars(f.releasedCents),
    available:     dollars(f.availableCents),
    paymentCount:  f.paymentCount,
    releaseCount:  f.releaseCount,
  };
}

export async function writeAudit(db, { action, herdId = null, investorUserId = null, oldValues = null, newValues = null, changedBy }) {
  await db.query(
    `INSERT INTO fee_audit_log (action, herd_id, investor_user_id, old_values, new_values, changed_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      action, herdId, investorUserId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      changedBy,
    ]
  );
}
