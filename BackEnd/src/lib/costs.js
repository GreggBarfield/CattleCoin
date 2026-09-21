import { HttpError, toCents, money } from "./routeHelpers.js";

// Shared rules for herd costs (routes/expenses.js) and LRP records (routes/lrp.js).
//
// Who may do what:
//   read    admin, the herd's owner, and investors who hold shares in the herd
//   add     the herd's owner (a rancher or feedlot), unless a sale is pending/approved
//   change  the owner, only while no investor has bought in and only for costs
//           they typed in themselves; after that, only an admin, with a reason
//   frozen  once the herd's sale is approved, nobody can change anything
// A cost is never deleted. "Void" keeps the row (marked voided, with a reason)
// and leaves it out of the sale split. Every change goes to a history table.

export const OWNER_ROLES = ["rancher", "feedlot"];
// 'purchase' (booked when the herd was bought), 'lrp_premium' (booked from an
// LRP record) and 'herd_value' (a rancher's herd valued at its listing price when
// it is opened to investors) are system-made and cannot be typed in by hand.
export const MANUAL_CATEGORIES = ["feed", "yardage", "vet", "death_loss_reserve", "other"];
export const MAX_AMOUNT_DOLLARS = 999999999;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const reasonOf = (body) => (body?.reason ? String(body.reason).trim().slice(0, 255) : "");

// Dollars typed by a person -> whole cents. Must be > 0, at most 2 decimals.
export function parseAmountInput(v, label = "amount") {
  if (v === undefined || v === null || v === "") throw new HttpError(400, `${label} is required.`);
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `${label} must be a number greater than 0.`);
  if (n > MAX_AMOUNT_DOLLARS) throw new HttpError(400, `${label} is too large.`);
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    throw new HttpError(400, `${label} can have at most 2 decimal places.`);
  }
  return Math.round(n * 100);
}

// "2026-10-15" -> "2026-10-15" (or null when empty). Anything else is a 400.
export function parseDateInput(v, label = "date") {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v);
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) {
    throw new HttpError(400, `${label} must look like 2026-10-15.`);
  }
  return s;
}

export async function loadHerd(db, herdId) {
  const r = await db.query(
    "SELECT herd_id, rancher_id, herd_name, head_count, feedlot_status FROM herds WHERE herd_id = $1",
    [herdId]
  );
  if (r.rowCount === 0) throw new HttpError(404, "Herd not found.");
  return r.rows[0];
}

// True once any investor has bought into the herd (same idea as the fee lock).
export async function herdHasInvestors(db, herdId) {
  const r = await db.query(
    `SELECT (
        COALESCE((SELECT tokens_sold FROM herds WHERE herd_id = $1), 0) > 0
        OR EXISTS (SELECT 1 FROM investor_payments WHERE herd_id = $1)
        OR EXISTS (
             SELECT 1 FROM ownership o
               JOIN token_pools tp ON tp.pool_id = o.pool_id
               JOIN users u ON u.user_id = o.user_id
              WHERE tp.herd_id = $1 AND u.role = 'investor' AND o.token_amount > 0)
      ) AS locked`,
    [herdId]
  );
  return r.rows[0].locked === true;
}

// 'approved' beats 'pending_approval'; null when the herd has no live sale.
export async function herdSaleState(db, herdId) {
  const r = await db.query(
    "SELECT status FROM herd_sales WHERE herd_id = $1 AND status IN ('pending_approval', 'approved')",
    [herdId]
  );
  if (r.rows.some((x) => x.status === "approved")) return "approved";
  if (r.rows.some((x) => x.status === "pending_approval")) return "pending_approval";
  return null;
}

// Who is asking, relative to this herd.
export async function getViewerAccess(db, user, herd) {
  const isAdmin = user.role === "admin";
  const isOwner = herd.rancher_id === user.userId && OWNER_ROLES.includes(user.role);
  let isInvestor = false;
  if (!isAdmin && !isOwner && user.role === "investor") {
    const r = await db.query(
      `SELECT (
          EXISTS (SELECT 1 FROM ownership o JOIN token_pools tp ON tp.pool_id = o.pool_id
                   WHERE tp.herd_id = $1 AND o.user_id = $2 AND o.token_amount > 0)
          OR EXISTS (SELECT 1 FROM investor_payments WHERE herd_id = $1 AND user_id = $2)
        ) AS yes`,
      [herd.herd_id, user.userId]
    );
    isInvestor = r.rows[0].yes === true;
  }
  return { isAdmin, isOwner, isInvestor, canView: isAdmin || isOwner || isInvestor };
}

// Can this person change (edit or void) this cost right now?
// Returns { ok, status, message, reasonRequired }.
export function costChangeRule({ isAdmin, isOwner, locked, saleState, expense }) {
  const no = (status, message) => ({ ok: false, status, message, reasonRequired: false });
  if (expense.status !== "active") return no(409, "This cost is already voided.");
  if (saleState === "approved") return no(409, "This herd's sale has been approved, so its costs are frozen.");
  if (expense.source === "lrp") {
    return no(409, "This cost comes from an LRP insurance record. Correct the premium on the LRP record instead.");
  }
  if (isAdmin) return { ok: true, reasonRequired: true };
  if (!isOwner) return no(403, "Only the herd's owner or an admin can change this cost.");
  if (saleState === "pending_approval") {
    return no(409, "A sale is waiting for approval, so costs are locked. Ask an admin for a correction.");
  }
  if (expense.source === "value") {
    return no(403, "This is the herd's starting value, booked by the system when the herd was opened to investors. Ask an admin to correct it.");
  }
  if (expense.source !== "manual") {
    return no(403, "This cost was booked by the system when the herd was bought. Ask an admin to correct it.");
  }
  if (locked) {
    return no(403, "Investors have bought into this herd, so the owner can no longer change costs. Ask an admin for a correction (a reason is required).");
  }
  return { ok: true, reasonRequired: false };
}

export function shapeExpense(r, rule) {
  return {
    expenseId:        r.expense_id,
    herdId:           r.herd_id,
    category:         r.category,
    description:      r.description ?? null,
    amount:           Number(r.amount),
    accruedDate:      r.accrued_date,
    billingDirection: r.billing_direction,
    source:           r.source,
    status:           r.status,
    lrpPolicyId:      r.lrp_policy_id ?? null,
    createdBy:        r.created_by_slug ?? null,
    createdAt:        r.created_at,
    voidedAt:         r.voided_at ?? null,
    voidReason:       r.void_reason ?? null,
    canChange:        rule ? rule.ok : undefined,
    changeNeedsReason: rule && rule.ok ? rule.reasonRequired : undefined,
  };
}

export const EXPENSE_SELECT = `
  e.expense_id, e.herd_id, e.category, e.description, e.amount,
  e.accrued_date::text AS accrued_date, e.billing_direction, e.source, e.status,
  e.lrp_policy_id, e.created_at, e.voided_at, e.void_reason,
  cu.slug AS created_by_slug
`;
export const EXPENSE_FROM = `FROM herd_expenses e LEFT JOIN users cu ON cu.user_id = e.created_by_user_id`;

// The fields worth keeping in the history (dates as text).
export const expenseSnapshot = (r) => ({
  category: r.category, description: r.description ?? null, amount: Number(r.amount),
  accruedDate: r.accrued_date, status: r.status,
});

export async function writeExpenseHistory(client, { expenseId, herdId, action, userId, reason, before, after }) {
  await client.query(
    `INSERT INTO herd_expense_history
       (expense_id, herd_id, action, changed_by_user_id, reason, before_values, after_values)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [expenseId, herdId, action, userId ?? null, reason || null,
     before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]
  );
}

// A rancher's herd has no purchase price, so its starting value would otherwise
// be missing from the costs and investors would be paid their money back AND a
// share of the whole sale. When a rancher-owned herd goes to investors, its
// listing price is booked as the herd's starting cost (category 'herd_value',
// source 'value'), just as a feedlot's purchase price is. Investors then share
// only the gain above that value.
//
//   priceCents   the listing price to book (default: the herd's current one)
//   createOnly   do not change an existing starting-value cost (used once
//                investors have paid in, as a safety net)
//
// Feedlot-owned herds are not touched: the feedlot's own purchase (or the cost
// it logs) is its starting cost. Call inside a transaction with the herd locked.
export async function ensureHerdValueCost(client, herdId, { priceCents = null, userId = null, createOnly = false } = {}) {
  const h = await client.query(
    `SELECT h.listing_price, u.role
       FROM herds h JOIN users u ON u.user_id = h.rancher_id
      WHERE h.herd_id = $1`,
    [herdId]
  );
  if (h.rowCount === 0 || h.rows[0].role !== "rancher") return { booked: false, reason: "not a rancher-owned herd" };
  const price = priceCents ?? (h.rows[0].listing_price != null ? toCents(h.rows[0].listing_price) : 0);
  if (!(price > 0)) return { booked: false, reason: "no listing price" };

  const cur = await client.query(
    "SELECT expense_id, amount FROM herd_expenses WHERE herd_id = $1 AND source = 'value' AND status = 'active'",
    [herdId]
  );
  if (cur.rowCount > 0) {
    if (createOnly || toCents(cur.rows[0].amount) === price) {
      return { booked: false, reason: "already booked", amountCents: toCents(cur.rows[0].amount) };
    }
    await client.query(
      "UPDATE herd_expenses SET amount = $2, updated_at = NOW() WHERE expense_id = $1",
      [cur.rows[0].expense_id, money(price)]
    );
    return { booked: true, updated: true, amountCents: price };
  }
  await client.query(
    `INSERT INTO herd_expenses
       (herd_id, category, description, amount, accrued_date, billing_direction, source, created_by_user_id)
     VALUES ($1, 'herd_value', $2, $3, CURRENT_DATE, 'self', 'value', $4)`,
    [herdId, "Starting value of the herd when it was opened to investors (its listing price)", money(price), userId]
  );
  return { booked: true, updated: false, amountCents: price };
}

// When a herd is taken back off the marketplace (nobody has bought), its
// starting-value cost goes with it; opening it again books a fresh one.
export async function voidHerdValueCost(client, herdId, reason = "Herd closed to investors.") {
  await client.query(
    `UPDATE herd_expenses
        SET status = 'voided', voided_at = NOW(), void_reason = $2, updated_at = NOW()
      WHERE herd_id = $1 AND source = 'value' AND status = 'active'`,
    [herdId, reason]
  );
}
