import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();

// ─── helpers ─────────────────────────────────────────────────────────────────

const BREED_LABEL = {
  AN: "Angus AI Select",
  HH: "Hereford Registered",
  WA: "Wagyu F1 Cross",
  BR: "Brahman AI Select",
  BA: "Black Angus Premium AI",
  CH: "Charolais Fullblood",
  SM: "Simmental Registered AI",
  RA: "Red Angus AI Elite",
};

function shapePendingHerd(row) {
  const lp = parseFloat(row.listing_price) || 0;
  return {
    herdId:        row.herd_id,
    herdName:      row.herd_name || row.herd_id,
    rancherId:     row.rancher_id,
    listingPrice:  lp,
    headCount:     parseInt(row.head_count, 10) || 0,
    breedCode:     row.breed_code || "AN",
    geneticsLabel: BREED_LABEL[row.breed_code] ?? row.breed_code ?? "Unknown",
    dominantStage: row.dominant_stage || "RANCH",
    season:        row.season || "Fall",
    verified:      Boolean(row.verified_flag),
    riskScore:     row.risk_score != null ? parseInt(row.risk_score, 10) : null,
    feedlotStatus: row.feedlot_status || "pending",
    investorPct:   row.investor_pct != null ? parseFloat(row.investor_pct) : null,
    createdAt:     row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

// ─── GET /api/feedlot/pending ─────────────────────────────────────────────────
// Public browse: herds that ranchers have listed but no feedlot has claimed yet.
router.get("/pending", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        h.herd_id, h.rancher_id, h.herd_name, h.listing_price,
        h.head_count, h.verified_flag, h.breed_code, h.dominant_stage,
        h.season, h.risk_score, h.feedlot_status, h.investor_pct, h.created_at
      FROM herds h
      JOIN users ou ON ou.user_id = h.rancher_id AND ou.role = 'rancher'
      WHERE h.feedlot_status = 'pending'
      ORDER BY h.created_at DESC
    `);
    res.json(result.rows.map(shapePendingHerd));
  } catch (err) {
    console.error("GET /api/feedlot/pending error:", err.message);
    res.status(500).json({ error: "Failed to fetch pending herds", detail: err.message });
  }
});

// ─── GET /api/feedlot/:slug/dashboard ─────────────────────────────────────────
// Returns herds claimed by this feedlot (listed or sold). A feedlot may only
// view its own dashboard - the verified token's slug must match the URL slug.
router.get("/:slug/dashboard", requireAuth, requireRole("feedlot"), async (req, res) => {
  try {
    const { slug } = req.params;

    if (req.user.slug !== slug) {
      return res.status(403).json({ error: "Feedlot is not allowed to view this dashboard." });
    }

    const userId = req.user.userId;

    const result = await pool.query(`
      SELECT
        h.herd_id, h.rancher_id, h.herd_name, h.listing_price,
        h.head_count, h.verified_flag, h.breed_code, h.dominant_stage,
        h.season, h.risk_score, h.feedlot_status, h.investor_pct,
        h.created_at,
        COALESCE(h.tokens_sold, 0)  AS tokens_sold,
        tp.total_supply,
        COALESCE(
          (SELECT SUM(o.token_amount)
           FROM ownership o
           JOIN users u ON u.user_id = o.user_id
           WHERE o.pool_id = tp.pool_id AND u.role = 'investor'),
          0
        )::int AS investor_tokens_sold
      FROM herds h
      LEFT JOIN token_pools tp ON tp.herd_id = h.herd_id
      WHERE h.feedlot_user_id = $1
        AND h.feedlot_status IN ('listed', 'sold')
      ORDER BY h.created_at DESC
    `, [userId]);

    const herds = result.rows.map((row) => {
      const base = shapePendingHerd(row);
      const totalSupply = parseInt(row.total_supply, 10) || 0;
      const investorTokensSold = parseInt(row.investor_tokens_sold, 10) || 0;
      const investorAllocation = base.investorPct != null
        ? Math.floor(totalSupply * base.investorPct / 100)
        : totalSupply;
      return {
        ...base,
        totalSupply,
        investorAllocation,
        investorTokensSold,
        investorTokensRemaining: Math.max(0, investorAllocation - investorTokensSold),
      };
    });

    res.json({ feedlotSlug: slug, claimedHerds: herds });
  } catch (err) {
    console.error("GET /api/feedlot/:slug/dashboard error:", err.message);
    res.status(500).json({ error: "Failed to fetch feedlot dashboard", detail: err.message });
  }
});

// ─── POST /api/feedlot/claim ──────────────────────────────────────────────────
// Feedlot claims a pending herd and sets the investor percentage.
// Body: { herdId: string, investorPct: number (1-100) }
// feedlotSlug is no longer accepted from the body - the claiming feedlot is
// always the verified token holder, never a client-supplied value.
router.post("/claim", requireAuth, requireRole("feedlot"), async (req, res) => {
  const { herdId, investorPct } = req.body;
  const feedlotSlug = req.user.slug;

  if (!herdId || investorPct == null) {
    return res.status(400).json({ error: "herdId and investorPct are required" });
  }

  const pct = parseFloat(investorPct);
  if (isNaN(pct) || pct <= 0 || pct > 100) {
    return res.status(400).json({ error: "investorPct must be between 1 and 100" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock + validate herd is still pending
    const herdRes = await client.query(
      "SELECT herd_id, feedlot_status FROM herds WHERE herd_id = $1 FOR UPDATE",
      [herdId]
    );
    if (herdRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Herd not found" });
    }
    if (herdRes.rows[0].feedlot_status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Herd is no longer available (already claimed)" });
    }

    // Only herds owned by a rancher account can be claimed. A herd owned by a
    // feedlot (a feeder's own herd) is not up for claiming by other feedlots.
    const ownerRes = await client.query(
      "SELECT u.role FROM herds h JOIN users u ON u.user_id = h.rancher_id WHERE h.herd_id = $1",
      [herdId]
    );
    if (ownerRes.rows[0].role !== "rancher") {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "This herd is not available to claim" });
    }
    // Resolve feedlot user from the verified token, not the request body
    const userRes = await client.query(
      "SELECT user_id FROM users WHERE slug = $1 AND role = 'feedlot'",
      [feedlotSlug]
    );
    if (userRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: `Feedlot user not found: ${feedlotSlug}` });
    }
    const feedlotUserId = userRes.rows[0].user_id;

    // Claim the herd
    const updated = await client.query(
      `UPDATE herds
       SET feedlot_user_id = $1,
           investor_pct    = $2,
           feedlot_status  = 'listed',
           last_updated    = NOW()
       WHERE herd_id = $3
       RETURNING herd_id, herd_name, feedlot_status, investor_pct`,
      [feedlotUserId, pct, herdId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Herd "${updated.rows[0].herd_name}" listed with ${pct}% available to investors.`,
      herdId:        updated.rows[0].herd_id,
      herdName:      updated.rows[0].herd_name,
      feedlotStatus: updated.rows[0].feedlot_status,
      investorPct:   parseFloat(updated.rows[0].investor_pct),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/feedlot/claim error:", err.message);
    res.status(500).json({ error: "Failed to claim herd", detail: err.message });
  } finally {
    client.release();
  }
});

export default router;
