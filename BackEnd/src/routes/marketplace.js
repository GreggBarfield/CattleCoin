import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { sendError } from "../lib/routeHelpers.js";

const router = express.Router();

const BREED_LABEL = {
  AN: "Angus AI Select", HH: "Hereford Registered", WA: "Wagyu F1 Cross",
  BR: "Brahman AI Select", BA: "Black Angus Premium AI", CH: "Charolais Fullblood",
  SM: "Simmental Registered AI", RA: "Red Angus AI Elite",
};

// GET /api/marketplace
// What an investor can browse: every herd that is open to investors, described
// with real numbers only (nothing projected). For each lot:
//   division  cow-calf (the owner is a rancher) or feeder (the owner is a feedyard)
//   track     sold_outright (the herd is sold at exit). Retained-ownership herds are
//             not listed at all until that track can pay out (stage changes and
//             carcass payouts are not built yet), so nothing is sold that cannot settle.
//   price per token, tokens offered / sold / left, head count, breed
//   exitFee   the exit fee taken from the investor's profit, if the terms set one
//   lrp       the price protection (LRP) policy on file, if any
//   myTokens  what this investor already holds in the lot
// Identity comes only from the login token.
router.get("/", requireAuth, requireRole("investor"), async (req, res) => {
  const userId = req.user.userId;
  try {
    const r = await pool.query(
      `SELECT h.herd_id, h.herd_name, h.listing_price, h.purchase_status, h.head_count,
              h.verified_flag, h.breed_code, h.investor_pct, h.dominant_stage,
              COALESCE(h.tokens_sold, 0) AS tokens_sold, h.ownership_model, h.last_updated,
              ow.role AS owner_role, tp.total_supply,
              ft.exit_profit_fee_pct, ft.exit_fee_payer,
              lrp.policy_id, lrp.endorsement_type, lrp.coverage_level_pct, lrp.floor_price_cwt,
              lrp.end_date::text AS lrp_end_date, lrp.agent_verified,
              COALESCE((SELECT SUM(o.token_amount) FROM ownership o
                         WHERE o.pool_id = tp.pool_id AND o.user_id = $1), 0) AS my_tokens
         FROM herds h
         JOIN users ow ON ow.user_id = h.rancher_id
         LEFT JOIN token_pools tp ON tp.herd_id = h.herd_id
         LEFT JOIN herd_fee_terms ft ON ft.herd_id = h.herd_id
         LEFT JOIN LATERAL (
           SELECT p.policy_id, p.endorsement_type, p.coverage_level_pct, p.floor_price_cwt,
                  p.end_date, p.agent_verified
             FROM herd_lrp_policies p
            WHERE p.herd_id = h.herd_id AND (p.end_date IS NULL OR p.end_date >= CURRENT_DATE)
            ORDER BY p.created_at DESC
            LIMIT 1
         ) lrp ON TRUE
        WHERE h.feedlot_status = 'listed'
          AND h.ownership_model = 'sold_outright'
        ORDER BY h.last_updated DESC NULLS LAST, h.herd_name`,
      [userId]
    );

    const lots = r.rows.map((row) => {
      const totalSupply = parseInt(row.total_supply, 10) || 0;
      const investorPct = row.investor_pct != null ? parseFloat(row.investor_pct) : null;
      const investorAllocation = totalSupply > 0
        ? (investorPct != null ? Math.floor(totalSupply * investorPct / 100) : totalSupply)
        : 0;
      const tokensSold = parseInt(row.tokens_sold, 10) || 0;
      const tokensRemaining = Math.max(0, investorAllocation - tokensSold);
      const listingPrice = parseFloat(row.listing_price) || 0;
      const pricePerToken = totalSupply > 0 ? Math.round((listingPrice / totalSupply) * 100) / 100 : null;
      const exitPct = row.exit_profit_fee_pct != null ? Number(row.exit_profit_fee_pct) : 0;
      return {
        herdId: row.herd_id,
        name: row.herd_name || row.herd_id,
        division: row.owner_role === "feedlot" ? "feeder" : "cow-calf",
        track: row.ownership_model || "sold_outright",
        breed: BREED_LABEL[row.breed_code] ?? row.breed_code ?? "Unknown",
        headCount: parseInt(row.head_count, 10) || 0,
        verified: Boolean(row.verified_flag),
        dominantStage: row.dominant_stage || "RANCH",
        listingPrice,
        pricePerToken,
        totalSupply,
        investorPct,
        tokensOffered: investorAllocation,
        tokensSold,
        tokensRemaining,
        canInvest: tokensRemaining > 0 && row.purchase_status !== "sold" && totalSupply > 0,
        myTokens: parseInt(row.my_tokens, 10) || 0,
        exitFee: exitPct > 0 ? { pct: exitPct, paidBy: row.exit_fee_payer || "investor" } : null,
        lrp: row.policy_id
          ? {
              endorsementType: row.endorsement_type,
              coveragePct: row.coverage_level_pct != null ? Number(row.coverage_level_pct) : null,
              floorPriceCwt: row.floor_price_cwt != null ? Number(row.floor_price_cwt) : null,
              endDate: row.lrp_end_date || null,
              agentVerified: Boolean(row.agent_verified),
            }
          : null,
        lastUpdateIso: row.last_updated ? new Date(row.last_updated).toISOString() : null,
      };
    });

    res.json({ lots });
  } catch (err) {
    sendError(res, "GET /api/marketplace", err);
  }
});

export default router;
