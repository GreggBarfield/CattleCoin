import { HttpError } from "./routeHelpers.js";

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
// 'purchase' (booked when the herd was bought) and 'lrp_premium' (booked from an
// LRP record) are system-made and cannot be typed in by hand.
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
