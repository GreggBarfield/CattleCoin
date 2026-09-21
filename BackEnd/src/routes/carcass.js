import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { HttpError, isUuid, withTransaction, sendError } from "../lib/routeHelpers.js";
import { OWNER_ROLES, reasonOf, loadHerd, herdHasInvestors, getViewerAccess } from "../lib/costs.js";
import {
  parseCarcassFields, shapeCarcassRecord, snapshot, carcassChangeRule,
  CARCASS_SELECT, CARCASS_FROM, writeCarcassHistory, resolveHerdAnimal,
} from "../lib/carcass.js";

const router = express.Router();

// Per-animal carcass grade records. See lib/carcass.js for the rules and
// field list. Record-keeping only - not wired to any payout yet.

async function loadRecord(db, recordId, lock = false) {
  const r = await db.query(
    `SELECT ${CARCASS_SELECT} ${CARCASS_FROM} WHERE c.record_id = $1${lock ? " FOR UPDATE OF c" : ""}`,
    [recordId]
  );
  if (r.rowCount === 0) throw new HttpError(404, "Carcass record not found.");
  return r.rows[0];
}

// --- GET /api/carcass/herds/:herdId -----------------------------------------
router.get("/herds/:herdId", requireAuth, async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  try {
    const herd = await loadHerd(pool, herdId);
    const who = await getViewerAccess(pool, req.user, herd);
    if (!who.canView) throw new HttpError(403, "You are not allowed to see this herd's carcass records.");
    const r = await pool.query(
      `SELECT ${CARCASS_SELECT} ${CARCASS_FROM} WHERE c.herd_id = $1 ORDER BY c.created_at`,
      [herdId]
    );
    return res.json({
      herd: { herdId: herd.herd_id, herdName: herd.herd_name },
      note: "Placeholder records of what a packer reported. CattleCoin does not grade carcasses itself, and these do not affect any payout yet.",
      records: r.rows.map(shapeCarcassRecord),
    });
  } catch (err) {
    return sendError(res, "GET /api/carcass/herds/:herdId", err);
  }
});

// --- GET /api/carcass/animals/:animalId -------------------------------------
router.get("/animals/:animalId", requireAuth, async (req, res) => {
  const animalId = Number(req.params.animalId);
  if (!Number.isInteger(animalId) || animalId <= 0) return res.status(400).json({ error: "Invalid animalId." });
  try {
    const a = await pool.query("SELECT animal_id, herd_id, official_id FROM animals WHERE animal_id = $1", [animalId]);
    if (a.rowCount === 0) throw new HttpError(404, "Animal not found.");
    const herd = await loadHerd(pool, a.rows[0].herd_id);
    const who = await getViewerAccess(pool, req.user, herd);
    if (!who.canView) throw new HttpError(403, "You are not allowed to see this animal's carcass records.");
    const r = await pool.query(
      `SELECT ${CARCASS_SELECT} ${CARCASS_FROM} WHERE c.animal_id = $1 ORDER BY c.created_at`,
      [animalId]
    );
    return res.json({
      animal: { animalId: a.rows[0].animal_id, officialId: a.rows[0].official_id ?? null, herdId: herd.herd_id },
      records: r.rows.map(shapeCarcassRecord),
    });
  } catch (err) {
    return sendError(res, "GET /api/carcass/animals/:animalId", err);
  }
});

// --- POST /api/carcass/herds/:herdId ----------------------------------------
// Owner (or admin) logs a record for one animal. Body: { animalId | officialId,
// hotCarcassWeightLbs?, qualityGrade?, yieldGrade?, dressingPct?, backfatIn?,
// ribeyeAreaSqin?, marblingScore?, gridPremiumDiscount?, saleId? }
router.post("/herds/:herdId", requireAuth, requireRole(...OWNER_ROLES, "admin"), async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  const body = req.body ?? {};
  try {
    if (body.verified !== undefined) throw new HttpError(403, "Only an admin can mark a record as verified.");
    const f = parseCarcassFields(body);
    if (Object.keys(f).length === 0) {
      throw new HttpError(400, "Send at least one carcass field (for example hotCarcassWeightLbs or qualityGrade).");
    }
    if (body.saleId !== undefined && body.saleId !== null && !isUuid(body.saleId)) {
      throw new HttpError(400, "Invalid saleId.");
    }

    const out = await withTransaction(async (client) => {
      const herdRes = await client.query(
        "SELECT herd_id, rancher_id FROM herds WHERE herd_id = $1 FOR UPDATE", [herdId]
      );
      if (herdRes.rowCount === 0) throw new HttpError(404, "Herd not found.");
      const isAdmin = req.user.role === "admin";
      if (!isAdmin && herdRes.rows[0].rancher_id !== req.user.userId) {
        throw new HttpError(403, "You can only log carcass records on a herd you own.");
      }
      const animal = await resolveHerdAnimal(client, herdId, { animalId: body.animalId, officialId: body.officialId });

      const ins = await client.query(
        `INSERT INTO carcass_records
           (animal_id, herd_id, sale_id, hot_carcass_weight_lbs, quality_grade, yield_grade, dressing_pct,
            backfat_in, ribeye_area_sqin, marbling_score, grid_premium_discount, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING record_id`,
        [animal.animal_id, herdId, body.saleId ?? null, f.hot_carcass_weight_lbs ?? null, f.quality_grade ?? null,
         f.yield_grade ?? null, f.dressing_pct ?? null, f.backfat_in ?? null, f.ribeye_area_sqin ?? null,
         f.marbling_score ?? null, f.grid_premium_discount ?? null, req.user.userId]
      );
      const row = await loadRecord(client, ins.rows[0].record_id);
      await writeCarcassHistory(client, {
        recordId: row.record_id, herdId, action: "create", userId: req.user.userId,
        reason: null, before: null, after: snapshot(row),
      });
      return row;
    });
    return res.status(201).json({ message: "Carcass record saved.", record: shapeCarcassRecord(out) });
  } catch (err) {
    return sendError(res, "POST /api/carcass/herds/:herdId", err);
  }
});

// Shared by PUT and void: work out who is asking and whether they may change this record.
async function authorizeChange(client, req, recordId) {
  const peek = await loadRecord(client, recordId);
  const herdRes = await client.query(
    "SELECT herd_id, rancher_id, herd_name, head_count, feedlot_status FROM herds WHERE herd_id = $1 FOR UPDATE",
    [peek.herd_id]
  );
  const herd = herdRes.rows[0];
  const record = await loadRecord(client, recordId, true);
  const who = await getViewerAccess(client, req.user, herd);
  if (!who.isAdmin && !who.isOwner) throw new HttpError(403, "Only the herd's owner or an admin can change this record.");
  const locked = await herdHasInvestors(client, herd.herd_id);
  const rule = carcassChangeRule({ isAdmin: who.isAdmin, isOwner: who.isOwner, locked, record });
  if (!rule.ok) throw new HttpError(rule.status, rule.message);
  const reason = reasonOf(req.body);
  if (rule.reasonRequired && !reason) throw new HttpError(400, "A reason is required for an admin correction.");
  return { herd, record, reason };
}

// --- PUT /api/carcass/records/:recordId -------------------------------------
// Body: any create field, plus { reason }, plus { verified } (admin only).
router.put("/records/:recordId", requireAuth, async (req, res) => {
  const { recordId } = req.params;
  if (!isUuid(recordId)) return res.status(400).json({ error: "Invalid recordId." });
  const body = req.body ?? {};
  try {
    const f = parseCarcassFields(body);
    let verified = null;
    if (body.verified !== undefined) {
      if (req.user.role !== "admin") throw new HttpError(403, "Only an admin can mark a record as verified.");
      verified = body.verified === true || body.verified === "true";
    }
    if (Object.keys(f).length === 0 && verified === null) {
      throw new HttpError(400, "Nothing to change. Send a carcass field or verified.");
    }

    const out = await withTransaction(async (client) => {
      const { herd, record, reason } = await authorizeChange(client, req, recordId);
      const sets = [];
      const vals = [recordId];
      for (const [col, val] of Object.entries(f)) { vals.push(val); sets.push(`${col} = $${vals.length}`); }
      if (verified !== null) { vals.push(verified); sets.push(`verified = $${vals.length}`); }
      await client.query(`UPDATE carcass_records SET ${sets.join(", ")}, updated_at = NOW() WHERE record_id = $1`, vals);
      const after = await loadRecord(client, recordId);
      await writeCarcassHistory(client, {
        recordId, herdId: herd.herd_id, action: "update", userId: req.user.userId, reason,
        before: snapshot(record), after: snapshot(after),
      });
      return after;
    });
    return res.json({ message: "Carcass record updated.", record: shapeCarcassRecord(out) });
  } catch (err) {
    return sendError(res, "PUT /api/carcass/records/:recordId", err);
  }
});

// --- POST /api/carcass/records/:recordId/void -------------------------------
router.post("/records/:recordId/void", requireAuth, async (req, res) => {
  const { recordId } = req.params;
  if (!isUuid(recordId)) return res.status(400).json({ error: "Invalid recordId." });
  try {
    const out = await withTransaction(async (client) => {
      const { herd, record, reason } = await authorizeChange(client, req, recordId);
      await client.query(
        `UPDATE carcass_records
            SET status = 'voided', voided_at = NOW(), voided_by_user_id = $2, void_reason = $3, updated_at = NOW()
          WHERE record_id = $1`,
        [recordId, req.user.userId, reason || "Voided by the owner."]
      );
      const after = await loadRecord(client, recordId);
      await writeCarcassHistory(client, {
        recordId, herdId: herd.herd_id, action: "void", userId: req.user.userId, reason: reason || null,
        before: snapshot(record), after: snapshot(after),
      });
      return after;
    });
    return res.json({ message: "Carcass record voided. It is kept on record but no longer counts.", record: shapeCarcassRecord(out) });
  } catch (err) {
    return sendError(res, "POST /api/carcass/records/:recordId/void", err);
  }
});

// --- GET /api/carcass/records/:recordId/history -----------------------------
router.get("/records/:recordId/history", requireAuth, async (req, res) => {
  const { recordId } = req.params;
  if (!isUuid(recordId)) return res.status(400).json({ error: "Invalid recordId." });
  try {
    const rec = await loadRecord(pool, recordId);
    const herd = await loadHerd(pool, rec.herd_id);
    const who = await getViewerAccess(pool, req.user, herd);
    if (!who.canView) throw new HttpError(403, "You are not allowed to see this herd's carcass records.");
    const h = await pool.query(
      `SELECT h.history_id, h.action, h.changed_at, h.reason, h.before_values, h.after_values, u.slug AS changed_by
         FROM carcass_record_history h LEFT JOIN users u ON u.user_id = h.changed_by_user_id
        WHERE h.record_id = $1 ORDER BY h.changed_at, h.history_id`,
      [recordId]
    );
    return res.json({
      recordId,
      history: h.rows.map((r) => ({
        historyId: r.history_id, action: r.action, changedAt: r.changed_at, changedBy: r.changed_by ?? null,
        reason: r.reason ?? null, before: r.before_values ?? null, after: r.after_values ?? null,
      })),
    });
  } catch (err) {
    return sendError(res, "GET /api/carcass/records/:recordId/history", err);
  }
});

export default router;