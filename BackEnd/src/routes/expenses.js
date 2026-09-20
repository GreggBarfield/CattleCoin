import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { HttpError, isUuid, dollars, money, withTransaction, sendError } from "../lib/routeHelpers.js";
import {
  OWNER_ROLES, MANUAL_CATEGORIES, reasonOf, parseAmountInput, parseDateInput,
  loadHerd, herdHasInvestors, herdSaleState, getViewerAccess, costChangeRule,
  shapeExpense, EXPENSE_SELECT, EXPENSE_FROM, expenseSnapshot, writeExpenseHistory,
} from "../lib/costs.js";

const router = express.Router();

// A herd's cost list (feed, yardage, vet, ...). These are the costs taken off
// the sale price before profit is split (see routes/settlement.js), so the
// rules protect the investors:
//   - the owner logs costs against a herd they own;
//   - anyone who holds shares in the herd, the owner and admins can read them;
//   - once an investor has bought in, the owner can only ADD costs. Changing or
//     voiding one is an admin correction with a reason;
//   - voided costs are kept and marked, never deleted;
//   - every create / change / void goes to a history list;
//   - when a sale is pending only an admin can correct; once it is approved
//     everything is frozen.
// Costs booked by the system (the purchase price, an LRP premium) cannot be
// typed in here - see lib/transfer.js and routes/lrp.js.

const descOf = (v) => (v === undefined || v === null ? null : String(v).trim().slice(0, 255) || null);

async function loadExpense(db, expenseId, lock = false) {
  const r = await db.query(
    `SELECT ${EXPENSE_SELECT} ${EXPENSE_FROM} WHERE e.expense_id = $1${lock ? " FOR UPDATE OF e" : ""}`,
    [expenseId]
  );
  if (r.rowCount === 0) throw new HttpError(404, "Cost not found.");
  return r.rows[0];
}

// --- GET /api/expenses/herds/:herdId ----------------------------------------
router.get("/herds/:herdId", requireAuth, async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  try {
    const herd = await loadHerd(pool, herdId);
    const who = await getViewerAccess(pool, req.user, herd);
    if (!who.canView) throw new HttpError(403, "You are not allowed to see this herd's costs.");

    const [rows, locked, saleState] = await Promise.all([
      pool.query(
        `SELECT ${EXPENSE_SELECT} ${EXPENSE_FROM} WHERE e.herd_id = $1 ORDER BY e.accrued_date, e.created_at`,
        [herdId]
      ),
      herdHasInvestors(pool, herdId),
      herdSaleState(pool, herdId),
    ]);

    const byCategory = {};
    let totalCents = 0;
    const expenses = rows.rows.map((r) => {
      if (r.status === "active") {
        const c = Math.round(Number(r.amount) * 100);
        totalCents += c;
        byCategory[r.category] = (byCategory[r.category] ?? 0) + c;
      }
      return shapeExpense(r, costChangeRule({ ...who, locked, saleState, expense: r }));
    });
    for (const k of Object.keys(byCategory)) byCategory[k] = dollars(byCategory[k]);

    return res.json({
      herd: { herdId: herd.herd_id, herdName: herd.herd_name, investorsHaveBought: locked, saleState },
      viewer: who.isAdmin ? "admin" : who.isOwner ? "owner" : "investor",
      total: dollars(totalCents),
      byCategory,
      expenses,
    });
  } catch (err) {
    return sendError(res, "GET /api/expenses/herds/:herdId", err);
  }
});

// --- POST /api/expenses/herds/:herdId ---------------------------------------
// Owner logs a cost. Body: { category, amount, description?, accruedDate? }
router.post("/herds/:herdId", requireAuth, requireRole(...OWNER_ROLES), async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  const body = req.body ?? {};
  try {
    const category = String(body.category ?? "").trim();
    if (!MANUAL_CATEGORIES.includes(category)) {
      throw new HttpError(
        400,
        `category must be one of: ${MANUAL_CATEGORIES.join(", ")}. ` +
          "The purchase price and LRP premiums are booked by the system."
      );
    }
    const cents = parseAmountInput(body.amount);
    const accrued = parseDateInput(body.accruedDate, "accruedDate");

    const out = await withTransaction(async (client) => {
      const lockRes = await client.query(
        "SELECT herd_id, rancher_id FROM herds WHERE herd_id = $1 FOR UPDATE", [herdId]
      );
      if (lockRes.rowCount === 0) throw new HttpError(404, "Herd not found.");
      if (lockRes.rows[0].rancher_id !== req.user.userId) {
        throw new HttpError(403, "You can only log costs on a herd you own.");
      }
      const saleState = await herdSaleState(client, herdId);
      if (saleState) {
        throw new HttpError(409, "This herd has a sale in progress or approved, so its costs are locked.");
      }
      const ins = await client.query(
        `INSERT INTO herd_expenses
           (herd_id, category, description, amount, accrued_date, billing_direction, source, created_by_user_id)
         VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), 'self', 'manual', $6)
         RETURNING expense_id`,
        [herdId, category, descOf(body.description), money(cents), accrued, req.user.userId]
      );
      const row = await loadExpense(client, ins.rows[0].expense_id);
      await writeExpenseHistory(client, {
        expenseId: row.expense_id, herdId, action: "create", userId: req.user.userId,
        reason: null, before: null, after: expenseSnapshot(row),
      });
      return row;
    });
    return res.status(201).json({ message: "Cost logged.", expense: shapeExpense(out) });
  } catch (err) {
    return sendError(res, "POST /api/expenses/herds/:herdId", err);
  }
});

// Shared by PATCH and void: work out who is asking and whether they may change this cost.
async function authorizeChange(client, req, expenseId) {
  const peek = await loadExpense(client, expenseId);
  // Lock the herd first (same order as a sale submit), then the cost.
  const herdRes = await client.query(
    "SELECT herd_id, rancher_id, herd_name, head_count, feedlot_status FROM herds WHERE herd_id = $1 FOR UPDATE",
    [peek.herd_id]
  );
  const herd = herdRes.rows[0];
  const expense = await loadExpense(client, expenseId, true);
  const who = await getViewerAccess(client, req.user, herd);
  if (!who.isAdmin && !who.isOwner) throw new HttpError(403, "Only the herd's owner or an admin can change this cost.");
  const [locked, saleState] = await Promise.all([herdHasInvestors(client, herd.herd_id), herdSaleState(client, herd.herd_id)]);
  const rule = costChangeRule({ ...who, locked, saleState, expense });
  if (!rule.ok) throw new HttpError(rule.status, rule.message);
  const reason = reasonOf(req.body);
  if (rule.reasonRequired && !reason) {
    throw new HttpError(400, "A reason is required for an admin correction.");
  }
  return { herd, expense, reason };
}

// --- PATCH /api/expenses/:expenseId -----------------------------------------
// Body: any of { category, amount, description, accruedDate, reason }
router.patch("/:expenseId", requireAuth, async (req, res) => {
  const { expenseId } = req.params;
  if (!isUuid(expenseId)) return res.status(400).json({ error: "Invalid expenseId." });
  const body = req.body ?? {};
  try {
    const out = await withTransaction(async (client) => {
      const { herd, expense, reason } = await authorizeChange(client, req, expenseId);

      const sets = [];
      const vals = [expenseId];
      const add = (col, val, cast = "") => { vals.push(val); sets.push(`${col} = $${vals.length}${cast}`); };

      if (body.category !== undefined) {
        const category = String(body.category).trim();
        if (expense.source !== "manual") {
          throw new HttpError(400, "The category of a system-booked cost cannot be changed.");
        }
        if (!MANUAL_CATEGORIES.includes(category)) {
          throw new HttpError(400, `category must be one of: ${MANUAL_CATEGORIES.join(", ")}.`);
        }
        if (category !== expense.category) add("category", category);
      }
      if (body.amount !== undefined) {
        const cents = parseAmountInput(body.amount);
        if (money(cents) !== Number(expense.amount).toFixed(2)) add("amount", money(cents));
      }
      if (body.description !== undefined) {
        const d = descOf(body.description);
        if (d !== (expense.description ?? null)) add("description", d);
      }
      if (body.accruedDate !== undefined) {
        const d = parseDateInput(body.accruedDate, "accruedDate");
        if (!d) throw new HttpError(400, "accruedDate cannot be empty.");
        if (d !== expense.accrued_date) add("accrued_date", d, "::date");
      }
      if (sets.length === 0) throw new HttpError(400, "Nothing to change. Send category, amount, description or accruedDate.");

      await client.query(`UPDATE herd_expenses SET ${sets.join(", ")}, updated_at = NOW() WHERE expense_id = $1`, vals);
      const after = await loadExpense(client, expenseId);
      await writeExpenseHistory(client, {
        expenseId, herdId: herd.herd_id, action: "update", userId: req.user.userId, reason,
        before: expenseSnapshot(expense), after: expenseSnapshot(after),
      });
      return after;
    });
    return res.json({ message: "Cost updated.", expense: shapeExpense(out) });
  } catch (err) {
    return sendError(res, "PATCH /api/expenses/:expenseId", err);
  }
});

// --- POST /api/expenses/:expenseId/void -------------------------------------
// Body: { reason } (required for an admin). The row is kept, marked voided,
// and left out of the sale split.
router.post("/:expenseId/void", requireAuth, async (req, res) => {
  const { expenseId } = req.params;
  if (!isUuid(expenseId)) return res.status(400).json({ error: "Invalid expenseId." });
  try {
    const out = await withTransaction(async (client) => {
      const { herd, expense, reason } = await authorizeChange(client, req, expenseId);
      await client.query(
        `UPDATE herd_expenses
            SET status = 'voided', voided_at = NOW(), voided_by_user_id = $2, void_reason = $3, updated_at = NOW()
          WHERE expense_id = $1`,
        [expenseId, req.user.userId, reason || "Voided by the owner."]
      );
      const after = await loadExpense(client, expenseId);
      await writeExpenseHistory(client, {
        expenseId, herdId: herd.herd_id, action: "void", userId: req.user.userId, reason: reason || null,
        before: expenseSnapshot(expense), after: expenseSnapshot(after),
      });
      return after;
    });
    return res.json({ message: "Cost voided. It is kept on record but no longer counts.", expense: shapeExpense(out) });
  } catch (err) {
    return sendError(res, "POST /api/expenses/:expenseId/void", err);
  }
});

// --- GET /api/expenses/:expenseId/history -----------------------------------
router.get("/:expenseId/history", requireAuth, async (req, res) => {
  const { expenseId } = req.params;
  if (!isUuid(expenseId)) return res.status(400).json({ error: "Invalid expenseId." });
  try {
    const exp = await loadExpense(pool, expenseId);
    const herd = await loadHerd(pool, exp.herd_id);
    const who = await getViewerAccess(pool, req.user, herd);
    if (!who.canView) throw new HttpError(403, "You are not allowed to see this herd's costs.");
    const h = await pool.query(
      `SELECT h.history_id, h.action, h.changed_at, h.reason, h.before_values, h.after_values, u.slug AS changed_by
         FROM herd_expense_history h LEFT JOIN users u ON u.user_id = h.changed_by_user_id
        WHERE h.expense_id = $1 ORDER BY h.changed_at, h.history_id`,
      [expenseId]
    );
    return res.json({
      expenseId,
      history: h.rows.map((r) => ({
        historyId: r.history_id, action: r.action, changedAt: r.changed_at, changedBy: r.changed_by ?? null,
        reason: r.reason ?? null, before: r.before_values ?? null, after: r.after_values ?? null,
      })),
    });
  } catch (err) {
    return sendError(res, "GET /api/expenses/:expenseId/history", err);
  }
});

export default router;
