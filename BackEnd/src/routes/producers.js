import express from "express";
import pool from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { HttpError, isUuid, sendError } from "../lib/routeHelpers.js";
import { getTrackRecord } from "../lib/trackRecord.js";

const router = express.Router();

// A producer's track record (see lib/trackRecord.js). Mounted at /api/producers.
// Any logged-in user can read it: the point is that an investor can look a
// producer up before buying. It shows the producer's username, nothing else
// about them. Read only; nothing here changes any data.

// GET /api/producers/:slug/track-record
router.get("/:slug/track-record", requireAuth, async (req, res) => {
  try {
    const slug = String(req.params.slug ?? "").trim().toLowerCase();
    const u = await pool.query("SELECT user_id FROM users WHERE slug = $1 AND role IN ('rancher', 'feedlot')", [slug]);
    if (u.rowCount === 0) throw new HttpError(404, "Producer not found.");
    return res.json(await getTrackRecord(pool, u.rows[0].user_id));
  } catch (err) {
    return sendError(res, "GET /api/producers/:slug/track-record", err);
  }
});

// GET /api/producers/by-herd/:herdId/track-record
// The record of whoever owns this herd (for a lot page, which knows the herd
// and not the producer).
router.get("/by-herd/:herdId/track-record", requireAuth, async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  try {
    const h = await pool.query("SELECT rancher_id FROM herds WHERE herd_id = $1", [herdId]);
    if (h.rowCount === 0) throw new HttpError(404, "Herd not found.");
    const rec = await getTrackRecord(pool, h.rows[0].rancher_id);
    if (!rec) throw new HttpError(404, "Producer not found.");
    return res.json(rec);
  } catch (err) {
    return sendError(res, "GET /api/producers/by-herd/:herdId/track-record", err);
  }
});

export default router;
