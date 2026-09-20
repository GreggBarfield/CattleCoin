import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { HttpError, isUuid, money, withTransaction, sendError } from "../lib/routeHelpers.js";
import {
  OWNER_ROLES, MAX_AMOUNT_DOLLARS, reasonOf, parseDateInput,
  loadHerd, herdHasInvestors, herdSaleState, getViewerAccess, writeExpenseHistory, expenseSnapshot,
  EXPENSE_SELECT, EXPENSE_FROM,
} from "../lib/costs.js";

const router = express.Router();

// LRP (Livestock Risk Protection) insurance records on a herd.
//
// CattleCoin does not sell or verify insurance. This only RECORDS a real policy
// that the herd's owner bought through a USDA-approved agent, so the herd can
// show "insured floor $X/cwt". Every field is optional (a placeholder until an
// agent feed exists) and `agentVerified` stays false until an admin marks it.
//
// The premium, if entered, is booked automatically as an 'lrp_premium' cost on
// the herd, and follows the record: change or clear the premium and the cost
// changes or is voided with it.
//
// Same protection as the cost list (see lib/costs.js): the owner can add a
// record any time before a sale is pending, but once an investor has bought in
// only an admin can change one (with a reason). A pending sale locks it for the
// owner; an approved sale freezes it for everyone. Every change is in the
// history list.

const ENDORSEMENTS = ["feeder_cattle", "fed_cattle", "other"];
const POLICY_SELECT = `
  p.policy_id, p.herd_id, p.policy_number, p.endorsement_type, p.coverage_level_pct,
  p.floor_price_cwt, p.premium_amount, p.effective_date::text AS effective_date,
  p.end_date::text AS end_date, p.agent_verified, p.created_at, p.updated_at,
  cu.slug AS created_by_slug
`;
const POLICY_FROM = `FROM herd_lrp_policies p LEFT JOIN users cu ON cu.user_id = p.created_by_user_id`;

const shapePolicy = (r) => ({
  policyId:         r.policy_id,
  herdId:           r.herd_id,
  policyNumber:     r.policy_number ?? null,
  endorsementType:  r.endorsement_type,
  coverageLevelPct: r.coverage_level_pct != null ? Number(r.coverage_level_pct) : null,
  floorPriceCwt:    r.floor_price_cwt != null ? Number(r.floor_price_cwt) : null,
  premiumAmount:    r.premium_amount != null ? Number(r.premium_amount) : null,
  effectiveDate:    r.effective_date ?? null,
  endDate:          r.end_date ?? null,
  agentVerified:    r.agent_verified,
  createdBy:        r.created_by_slug ?? null,
  createdAt:        r.created_at,
  updatedAt:        r.updated_at ?? null,
});

const snapshot = (r) => ({
  policyNumber: r.policy_number ?? null, endorsementType: r.endorsement_type,
  coverageLevelPct: r.coverage_level_pct != null ? Number(r.coverage_level_pct) : null,
  floorPriceCwt: r.floor_price_cwt != null ? Number(r.floor_price_cwt) : null,
  premiumAmount: r.premium_amount != null ? Number(r.premium_amount) : null,
  effectiveDate: r.effective_date ?? null, endDate: r.end_date ?? null, agentVerified: r.agent_verified,
});

const isBlank = (v) => v === null || v === "";

// Turns the request body into column values. Only fields that were sent are
// returned. Sending null or "" clears an optional field.
function parseLrpFields(body) {
  const out = {};
  if (body.policyNumber !== undefined) {
    out.policy_number = isBlank(body.policyNumber) ? null : String(body.policyNumber).trim().slice(0, 60) || null;
  }
  if (body.endorsementType !== undefined) {
    const e = String(body.endorsementType).trim();
    if (!ENDORSEMENTS.includes(e)) throw new HttpError(400, `endorsementType must be one of: ${ENDORSEMENTS.join(", ")}.`);
    out.endorsement_type = e;
  }
  if (body.coverageLevelPct !== undefined) {
    if (isBlank(body.coverageLevelPct)) out.coverage_level_pct = null;
    else {
      const n = Number(body.coverageLevelPct);
      if (!Number.isFinite(n) || n <= 0 || n > 100) throw new HttpError(400, "coverageLevelPct must be more than 0 and at most 100.");
      if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw new HttpError(400, "coverageLevelPct can have at most 2 decimal places.");
      out.coverage_level_pct = n.toFixed(2);
    }
  }
  if (body.floorPriceCwt !== undefined) {
    if (isBlank(body.floorPriceCwt)) out.floor_price_cwt = null;
    else {
      const n = Number(body.floorPriceCwt);
      if (!Number.isFinite(n) || n < 0 || n > 999999) throw new HttpError(400, "floorPriceCwt must be a price per hundredweight of 0 or more.");
      if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw new HttpError(400, "floorPriceCwt can have at most 2 decimal places.");
      out.floor_price_cwt = n.toFixed(2);
    }
  }
  if (body.premiumAmount !== undefined) {
    if (isBlank(body.premiumAmount)) out.premium_amount = null;
    else {
      const n = Number(body.premiumAmount);
      if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT_DOLLARS) throw new HttpError(400, "premiumAmount must be a dollar amount of 0 or more.");
      if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw new HttpError(400, "premiumAmount can have at most 2 decimal places.");
      out.premium_amount = n.toFixed(2);
    }
  }
  if (body.effectiveDate !== undefined) out.effective_date = parseDateInput(body.effectiveDate, "effectiveDate");
  if (body.endDate !== undefined) out.end_date = parseDateInput(body.endDate, "endDate");
  return out;
}

async function loadPolicy(db, policyId, lock = false) {
  const r = await db.query(
    `SELECT ${POLICY_SELECT} ${POLICY_FROM} WHERE p.policy_id = $1${lock ? " FOR UPDATE OF p" : ""}`,
    [policyId]
  );
  if (r.rowCount === 0) throw new HttpError(404, "LRP record not found.");
  return r.rows[0];
}

async function writeLrpHistory(client, { policyId, herdId, action, userId, reason, before, after }) {
  await client.query(
    `INSERT INTO herd_lrp_history (policy_id, herd_id, action, changed_by_user_id, reason, before_values, after_values)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [policyId, herdId, action, userId ?? null, reason || null,
     before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]
  );
}

// Keep the herd's 'lrp_premium' cost in step with the record's premium.
async function syncPremiumCost(client, { policy, userId, reason }) {
  const premium = policy.premium_amount != null ? Number(policy.premium_amount) : 0;
  const linked = await client.query(
    `SELECT ${EXPENSE_SELECT} ${EXPENSE_FROM} WHERE e.lrp_policy_id = $1 AND e.status = 'active' FOR UPDATE OF e`,
    [policy.policy_id]
  );
  const cur = linked.rows[0];
  if (premium > 0) {
    const desc = `LRP premium${policy.policy_number ? " - policy " + policy.policy_number : ""}`.slice(0, 255);
    if (cur) {
      if (Number(cur.amount) !== premium || (cur.description ?? null) !== desc) {
        await client.query(
          "UPDATE herd_expenses SET amount = $2, description = $3, updated_at = NOW() WHERE expense_id = $1",
          [cur.expense_id, money(Math.round(premium * 100)), desc]
        );
        const after = await client.query(`SELECT ${EXPENSE_SELECT} ${EXPENSE_FROM} WHERE e.expense_id = $1`, [cur.expense_id]);
        await writeExpenseHistory(client, {
          expenseId: cur.expense_id, herdId: policy.herd_id, action: "update", userId, reason,
          before: expenseSnapshot(cur), after: expenseSnapshot(after.rows[0]),
        });
      }
    } else {
      const ins = await client.query(
        `INSERT INTO herd_expenses
           (herd_id, category, description, amount, accrued_date, billing_direction, source, created_by_user_id, lrp_policy_id)
         VALUES ($1, 'lrp_premium', $2, $3, COALESCE($4::date, CURRENT_DATE), 'self', 'lrp', $5, $6)
         RETURNING expense_id`,
        [policy.herd_id, desc, money(Math.round(premium * 100)), policy.effective_date, userId, policy.policy_id]
      );
      const after = await client.query(`SELECT ${EXPENSE_SELECT} ${EXPENSE_FROM} WHERE e.expense_id = $1`, [ins.rows[0].expense_id]);
      await writeExpenseHistory(client, {
        expenseId: ins.rows[0].expense_id, herdId: policy.herd_id, action: "create", userId, reason,
        before: null, after: expenseSnapshot(after.rows[0]),
      });
    }
  } else if (cur) {
    await client.query(
      `UPDATE herd_expenses SET status = 'voided', voided_at = NOW(), voided_by_user_id = $2,
              void_reason = 'Premium removed from the LRP record.', updated_at = NOW()
        WHERE expense_id = $1`,
      [cur.expense_id, userId]
    );
    const after = await client.query(`SELECT ${EXPENSE_SELECT} ${EXPENSE_FROM} WHERE e.expense_id = $1`, [cur.expense_id]);
    await writeExpenseHistory(client, {
      expenseId: cur.expense_id, herdId: policy.herd_id, action: "void", userId,
      reason: reason || "Premium removed from the LRP record.",
      before: expenseSnapshot(cur), after: expenseSnapshot(after.rows[0]),
    });
  }
}

// --- GET /api/lrp/herds/:herdId ---------------------------------------------
router.get("/herds/:herdId", requireAuth, async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  try {
    const herd = await loadHerd(pool, herdId);
    const who = await getViewerAccess(pool, req.user, herd);
    if (!who.canView) throw new HttpError(403, "You are not allowed to see this herd's LRP records.");
    const r = await pool.query(`SELECT ${POLICY_SELECT} ${POLICY_FROM} WHERE p.herd_id = $1 ORDER BY p.created_at`, [herdId]);
    return res.json({
      herd: { herdId: herd.herd_id, herdName: herd.herd_name },
      note: "Placeholder records of policies bought through an insurance agent. CattleCoin does not verify or sell insurance.",
      policies: r.rows.map(shapePolicy),
    });
  } catch (err) {
    return sendError(res, "GET /api/lrp/herds/:herdId", err);
  }
});

// --- POST /api/lrp/herds/:herdId --------------------------------------------
// Owner records a policy. Body: any of { policyNumber, endorsementType,
// coverageLevelPct, floorPriceCwt, premiumAmount, effectiveDate, endDate }
router.post("/herds/:herdId", requireAuth, requireRole(...OWNER_ROLES), async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  const body = req.body ?? {};
  try {
    if (body.agentVerified !== undefined) throw new HttpError(403, "Only an admin can mark a policy as verified.");
    const f = parseLrpFields(body);
    if (Object.keys(f).length === 0) throw new HttpError(400, "Send at least one LRP field (for example policyNumber or floorPriceCwt).");
    if (f.effective_date && f.end_date && f.end_date < f.effective_date) {
      throw new HttpError(400, "endDate cannot be before effectiveDate.");
    }

    const out = await withTransaction(async (client) => {
      const lockRes = await client.query("SELECT herd_id, rancher_id FROM herds WHERE herd_id = $1 FOR UPDATE", [herdId]);
      if (lockRes.rowCount === 0) throw new HttpError(404, "Herd not found.");
      if (lockRes.rows[0].rancher_id !== req.user.userId) throw new HttpError(403, "You can only record LRP on a herd you own.");
      if (await herdSaleState(client, herdId)) {
        throw new HttpError(409, "This herd has a sale in progress or approved, so its records are locked.");
      }
      const ins = await client.query(
        `INSERT INTO herd_lrp_policies
           (herd_id, policy_number, endorsement_type, coverage_level_pct, floor_price_cwt, premium_amount,
            effective_date, end_date, created_by_user_id)
         VALUES ($1, $2, COALESCE($3, 'other'), $4, $5, $6, $7::date, $8::date, $9)
         RETURNING policy_id`,
        [herdId, f.policy_number ?? null, f.endorsement_type ?? null, f.coverage_level_pct ?? null,
         f.floor_price_cwt ?? null, f.premium_amount ?? null, f.effective_date ?? null, f.end_date ?? null, req.user.userId]
      );
      const policy = await loadPolicy(client, ins.rows[0].policy_id);
      await writeLrpHistory(client, {
        policyId: policy.policy_id, herdId, action: "create", userId: req.user.userId, reason: null,
        before: null, after: snapshot(policy),
      });
      await syncPremiumCost(client, { policy, userId: req.user.userId, reason: null });
      return policy;
    });
    return res.status(201).json({
      message: "LRP record saved (placeholder - not verified with an insurance agent).",
      policy: shapePolicy(out),
    });
  } catch (err) {
    return sendError(res, "POST /api/lrp/herds/:herdId", err);
  }
});

// --- PUT /api/lrp/policies/:policyId ----------------------------------------
// Owner (before any investor has bought in) or admin (always, with a reason).
// Body: any of the create fields, plus { reason }, plus { agentVerified } (admin only).
router.put("/policies/:policyId", requireAuth, async (req, res) => {
  const { policyId } = req.params;
  if (!isUuid(policyId)) return res.status(400).json({ error: "Invalid policyId." });
  const body = req.body ?? {};
  try {
    const f = parseLrpFields(body);
    let verified = null;
    if (body.agentVerified !== undefined) {
      if (req.user.role !== "admin") throw new HttpError(403, "Only an admin can mark a policy as verified.");
      verified = body.agentVerified === true || body.agentVerified === "true";
    }
    if (Object.keys(f).length === 0 && verified === null) {
      throw new HttpError(400, "Nothing to change. Send an LRP field or agentVerified.");
    }

    const out = await withTransaction(async (client) => {
      const peek = await loadPolicy(client, policyId);
      const herdRes = await client.query(
        "SELECT herd_id, rancher_id, herd_name, head_count, feedlot_status FROM herds WHERE herd_id = $1 FOR UPDATE",
        [peek.herd_id]
      );
      const herd = herdRes.rows[0];
      const before = await loadPolicy(client, policyId, true);
      const who = await getViewerAccess(client, req.user, herd);
      if (!who.isAdmin && !who.isOwner) throw new HttpError(403, "Only the herd's owner or an admin can change this record.");
      const [locked, saleState] = await Promise.all([herdHasInvestors(client, herd.herd_id), herdSaleState(client, herd.herd_id)]);
      if (saleState === "approved") throw new HttpError(409, "This herd's sale has been approved, so its records are frozen.");
      if (!who.isAdmin) {
        if (saleState === "pending_approval") throw new HttpError(409, "A sale is waiting for approval, so this record is locked. Ask an admin for a correction.");
        if (locked) throw new HttpError(403, "Investors have bought into this herd, so the owner can no longer change its LRP record. Ask an admin for a correction (a reason is required).");
      }
      const reason = reasonOf(body);
      if (who.isAdmin && !reason) throw new HttpError(400, "A reason is required for an admin correction.");

      const finalEffective = "effective_date" in f ? f.effective_date : before.effective_date;
      const finalEnd = "end_date" in f ? f.end_date : before.end_date;
      if (finalEffective && finalEnd && finalEnd < finalEffective) throw new HttpError(400, "endDate cannot be before effectiveDate.");

      const sets = [];
      const vals = [policyId];
      const casts = { effective_date: "::date", end_date: "::date" };
      for (const [col, val] of Object.entries(f)) { vals.push(val); sets.push(`${col} = $${vals.length}${casts[col] ?? ""}`); }
      if (verified !== null) { vals.push(verified); sets.push(`agent_verified = $${vals.length}`); }
      await client.query(`UPDATE herd_lrp_policies SET ${sets.join(", ")}, updated_at = NOW() WHERE policy_id = $1`, vals);

      const after = await loadPolicy(client, policyId);
      await writeLrpHistory(client, {
        policyId, herdId: herd.herd_id, action: "update", userId: req.user.userId, reason,
        before: snapshot(before), after: snapshot(after),
      });
      await syncPremiumCost(client, { policy: after, userId: req.user.userId, reason });
      return after;
    });
    return res.json({ message: "LRP record updated.", policy: shapePolicy(out) });
  } catch (err) {
    return sendError(res, "PUT /api/lrp/policies/:policyId", err);
  }
});

// --- GET /api/lrp/policies/:policyId/history --------------------------------
router.get("/policies/:policyId/history", requireAuth, async (req, res) => {
  const { policyId } = req.params;
  if (!isUuid(policyId)) return res.status(400).json({ error: "Invalid policyId." });
  try {
    const p = await loadPolicy(pool, policyId);
    const herd = await loadHerd(pool, p.herd_id);
    const who = await getViewerAccess(pool, req.user, herd);
    if (!who.canView) throw new HttpError(403, "You are not allowed to see this herd's LRP records.");
    const h = await pool.query(
      `SELECT h.history_id, h.action, h.changed_at, h.reason, h.before_values, h.after_values, u.slug AS changed_by
         FROM herd_lrp_history h LEFT JOIN users u ON u.user_id = h.changed_by_user_id
        WHERE h.policy_id = $1 ORDER BY h.changed_at, h.history_id`,
      [policyId]
    );
    return res.json({
      policyId,
      history: h.rows.map((r) => ({
        historyId: r.history_id, action: r.action, changedAt: r.changed_at, changedBy: r.changed_by ?? null,
        reason: r.reason ?? null, before: r.before_values ?? null, after: r.after_values ?? null,
      })),
    });
  } catch (err) {
    return sendError(res, "GET /api/lrp/policies/:policyId/history", err);
  }
});

export default router;
