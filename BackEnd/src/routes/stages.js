import express from "express";
import pool from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { HttpError, isUuid, withTransaction, sendError } from "../lib/routeHelpers.js";
import { OWNER_ROLES, getViewerAccess, herdSaleState, reasonOf } from "../lib/costs.js";
import { STAGES, shapeStageEntry, stageChangeRule } from "../lib/stages.js";

const router = express.Router();

// A herd's custody stage (RANCH -> BACKGROUNDING -> FEEDLOT -> PROCESSING ->
// DISTRIBUTION), moved forward by its owner one stage at a time and corrected
// by an admin (any stage, with a reason). See lib/stages.js for the rules.
// Every change is kept in herd_stage_history, oldest first.

const HISTORY_SELECT = `
  hh.history_id, hh.herd_id, hh.from_stage, hh.to_stage, hh.changed_at, hh.note, hh.is_correction,
  u.slug AS changed_by_slug
`;
const HISTORY_FROM = `FROM herd_stage_history hh LEFT JOIN users u ON u.user_id = hh.changed_by_user_id`;

async function loadHerdWithStage(db, herdId, lock = false) {
  const r = await db.query(
    `SELECT herd_id, rancher_id, herd_name, head_count, feedlot_status, dominant_stage
       FROM herds WHERE herd_id = $1${lock ? " FOR UPDATE" : ""}`,
    [herdId]
  );
  if (r.rowCount === 0) throw new HttpError(404, "Herd not found.");
  return r.rows[0];
}

// --- POST /api/herds/:herdId/stage ------------------------------------------
// Body: { stage, note? } (reason/note optional for the owner; a reason is
// required for an admin correction - send it as `reason` or `note`).
router.post("/:herdId/stage", requireAuth, async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  const body = req.body ?? {};
  const toStage = String(body.stage ?? "").trim().toUpperCase();
  if (!toStage) return res.status(400).json({ error: `stage is required. Must be one of: ${STAGES.join(", ")}.` });
  try {
    const out = await withTransaction(async (client) => {
      const herd = await loadHerdWithStage(client, herdId, true);
      const isAdmin = req.user.role === "admin";
      const isOwner = herd.rancher_id === req.user.userId && OWNER_ROLES.includes(req.user.role);
      const fromStage = herd.dominant_stage || "RANCH";
      const saleState = await herdSaleState(client, herdId);
      const rule = stageChangeRule({ isAdmin, isOwner, from: fromStage, to: toStage, hasSale: saleState !== null });
      if (!rule.ok) throw new HttpError(rule.status, rule.message);

      if (saleState === "approved") {
        throw new HttpError(409, "This herd's sale has been approved, so its stage is frozen.");
      }
      const reason = reasonOf(body) || (body.note ? String(body.note).trim().slice(0, 255) : "");
      if (rule.isCorrection && !reason) {
        throw new HttpError(400, "A reason is required for an admin correction (send it as reason or note).");
      }

      await client.query(
        `UPDATE herds SET dominant_stage = $2, dominant_stage_updated_at = NOW(), last_updated = NOW() WHERE herd_id = $1`,
        [herdId, toStage]
      );
      const ins = await client.query(
        `INSERT INTO herd_stage_history (herd_id, from_stage, to_stage, changed_by_user_id, note, is_correction)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING history_id`,
        [herdId, fromStage, toStage, req.user.userId, reason || null, rule.isCorrection]
      );
      const entry = await client.query(`SELECT ${HISTORY_SELECT} ${HISTORY_FROM} WHERE hh.history_id = $1`, [ins.rows[0].history_id]);
      return { fromStage, toStage, entry: entry.rows[0] };
    });
    return res.status(201).json({
      message: `Stage updated to ${out.toStage}.`,
      herdId,
      dominantStage: out.toStage,
      entry: shapeStageEntry(out.entry),
    });
  } catch (err) {
    return sendError(res, "POST /api/herds/:herdId/stage", err);
  }
});

// --- GET /api/herds/:herdId/stage-history -----------------------------------
router.get("/:herdId/stage-history", requireAuth, async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  try {
    const herd = await loadHerdWithStage(pool, herdId);
    const who = await getViewerAccess(pool, req.user, herd);
    if (!who.canView) throw new HttpError(403, "You are not allowed to see this herd's stage history.");
    const r = await pool.query(
      `SELECT ${HISTORY_SELECT} ${HISTORY_FROM} WHERE hh.herd_id = $1 ORDER BY hh.changed_at, hh.history_id`,
      [herdId]
    );
    return res.json({
      herd: { herdId: herd.herd_id, herdName: herd.herd_name, dominantStage: herd.dominant_stage },
      stages: STAGES,
      history: r.rows.map(shapeStageEntry),
    });
  } catch (err) {
    return sendError(res, "GET /api/herds/:herdId/stage-history", err);
  }
});

export default router;