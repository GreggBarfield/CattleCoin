import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();

const BREED_LABEL = {
  AN: "Angus AI Select", HH: "Hereford Registered", WA: "Wagyu F1 Cross",
  BR: "Brahman AI Select", BA: "Black Angus Premium AI", CH: "Charolais Fullblood",
  SM: "Simmental Registered AI", RA: "Red Angus AI Elite",
};

const ALL_STAGES = ["RANCH","BACKGROUNDING","FEEDLOT","PROCESSING","DISTRIBUTION"];

// â”€â”€â”€ GET /api/investors/:slug/portfolio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns the Dashboard data scoped to a single investor (by slug, e.g. "investor2")
// Security fix 2026-09-21: this route previously had no requireAuth at all -
// anyone who knew (or guessed) an investor's slug could read that investor's
// full portfolio. Now requires a logged-in investor/admin, and (unless the
// caller is an admin) the token's own slug must match the :slug being read.
// See handoff-next-chat.md / technical reference section 13.3.
router.get("/:slug/portfolio", requireAuth, requireRole("investor", "admin"), async (req, res) => {
  try {
    const { slug } = req.params;

    if (req.user.role !== "admin" && req.user.slug !== slug) {
      return res.status(403).json({ error: "Investors may only view their own portfolio." });
    }

    // Resolve user
    const userRes = await pool.query(
      "SELECT user_id, email FROM users WHERE slug = $1 AND role = 'investor'",
      [slug]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: `Investor '${slug}' not found` });
    }
    const { user_id } = userRes.rows[0];

    // Herds this investor owns tokens in
    const herdsRes = await pool.query(`
      SELECT
        h.herd_id, h.rancher_id, h.herd_name, h.listing_price, h.purchase_status,
        h.head_count, h.verified_flag, h.last_updated, h.cohort_label, h.season,
        h.breed_code, h.dominant_stage, h.risk_score,
        tp.pool_id, tp.total_supply, tp.contract_address,
        o.token_amount,
        COALESCE(
          (SELECT SUM(latest.fair_value)
           FROM animals a
           CROSS JOIN LATERAL (
             SELECT cv.fair_value FROM cow_valuation cv
             WHERE cv.cow_id = a.animal_id
             ORDER BY cv.valuation_date DESC LIMIT 1
           ) latest
           WHERE a.herd_id = h.herd_id),
          h.listing_price * 1.25
        ) AS position_value_usd
      FROM herds h
      JOIN token_pools tp ON tp.herd_id = h.herd_id
      JOIN ownership o   ON o.pool_id = tp.pool_id AND o.user_id = $1
      ORDER BY h.last_updated DESC
    `, [user_id]);

    const pools = herdsRes.rows.map((r) => {
      const stage = r.dominant_stage || "RANCH";
      const lp = parseFloat(r.listing_price) || 0;
      const positionValueUsd = parseFloat(r.position_value_usd) || lp * 1.25;
      const expectedRevenueUsd = lp * 1.40;
      return {
        id: r.herd_id,
        herdId: r.herd_id,
        rancherId: r.rancher_id || "",
        listingPrice: lp,
        purchaseStatus: r.purchase_status || "available",
        poolId: r.pool_id || "",
        totalSupply: parseInt(r.total_supply, 10) || 20,
        contractAddress: r.contract_address || "",
        tokenAmount: parseInt(r.token_amount, 10) || 0,
        name: r.herd_name || r.herd_id,
        poolType: "herd",
        cohortLabel: r.cohort_label || null,
        geneticsLabel: BREED_LABEL[r.breed_code] ?? r.breed_code ?? "Unknown",
        season: r.season || "Fall",
        positionValueUsd,
        backingHerdCount: parseInt(r.head_count, 10) || 0,
        expectedRevenueUsd,
        netExpectedUsd: expectedRevenueUsd - lp,
        stageBreakdown: ALL_STAGES.map((s) => ({ stage: s, pct: s === stage ? 100 : 0 })),
        dominantStage: stage,
        verified: Boolean(r.verified_flag),
        riskScore: r.risk_score != null ? parseInt(r.risk_score, 10) : null,
        lastUpdateIso: r.last_updated ? new Date(r.last_updated).toISOString() : new Date().toISOString(),
      };
    });

    const portfolioValueUsd = pools.reduce((s, p) => s + p.positionValueUsd, 0);
    const avgRisk = pools.length
      ? Math.round(pools.filter(p => p.riskScore != null).reduce((s, p) => s + p.riskScore, 0) / pools.filter(p => p.riskScore != null).length)
      : 55;

    const history30d = Array.from({ length: 31 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (30 - i));
      const variance = 0.97 + (i / 30) * 0.06 + Math.sin(i * 0.4) * 0.01;
      return { dateIso: d.toISOString(), value: Math.round(portfolioValueUsd * variance) };
    });

    // Recent events scoped to this investor's herds
    const herdIds = pools.map(p => p.herdId);
    let recentEvents = [];
    if (herdIds.length > 0) {
      const evRes = await pool.query(`
        SELECT 'ev-' || av.animal_vacc_id::text AS id,
          a.herd_id AS pool_id, a.animal_id::text AS cow_id,
          COALESCE(h.dominant_stage, 'RANCH') AS stage,
          h.verified_flag AS verified,
          av.administration_date::timestamptz AS timestamp_iso,
          v.vaccine_name || ' administered' AS note
        FROM animal_vaccinations av
        JOIN animals a ON a.animal_id = av.animal_id
        JOIN herds h   ON h.herd_id = a.herd_id
        JOIN vaccines v ON v.vaccine_id = av.vaccine_id
        WHERE a.herd_id = ANY($1::uuid[])
        ORDER BY av.administration_date DESC LIMIT 8
      `, [herdIds]);
      recentEvents = evRes.rows.map((e) => ({
        id: e.id, poolId: e.pool_id, cowId: e.cow_id,
        stage: e.stage, verified: Boolean(e.verified),
        timestampIso: new Date(e.timestamp_iso).toISOString(), note: e.note,
      }));
    }

    const topPools = [...pools].sort((a, b) => b.positionValueUsd - a.positionValueUsd).slice(0, 5);

    res.json({
      investorSlug: slug,
      asOfIso: new Date().toISOString(),
      portfolioValueUsd,
      change30dPct: 4.2,
      poolsHeld: pools.length,
      avgRisk,
      history30d,
      recentEvents,
      topPools,
    });
  } catch (err) {
    console.error("GET /api/investors/:slug/portfolio", err.message);
    res.status(500).json({ error: "Failed to fetch investor portfolio", detail: err.message });
  }
});

// â”€â”€â”€ GET /api/investors/:slug/holdings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns only this investor's held pools (for the Holdings page).
// Security fix 2026-09-21: same fix as /portfolio above - requireAuth plus a
// same-investor-or-admin check.
router.get("/:slug/holdings", requireAuth, requireRole("investor", "admin"), async (req, res) => {
  try {
    const { slug } = req.params;

    if (req.user.role !== "admin" && req.user.slug !== slug) {
      return res.status(403).json({ error: "Investors may only view their own holdings." });
    }

    const userRes = await pool.query(
      "SELECT user_id FROM users WHERE slug = $1 AND role = 'investor'",
      [slug]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: "Investor not found" });
    const { user_id } = userRes.rows[0];

    const result = await pool.query(`
      SELECT
        h.herd_id, h.herd_name, h.listing_price, h.purchase_status,
        h.head_count, h.verified_flag, h.last_updated, h.cohort_label, h.season,
        h.breed_code, h.dominant_stage, h.risk_score,
        tp.pool_id, tp.total_supply, tp.contract_address,
        o.token_amount
      FROM herds h
      JOIN token_pools tp ON tp.herd_id = h.herd_id
      JOIN ownership o   ON o.pool_id = tp.pool_id AND o.user_id = $1
      ORDER BY h.last_updated DESC
    `, [user_id]);

    const pools = result.rows.map((r) => ({
      id: r.herd_id,
      herdId: r.herd_id,
      name: r.herd_name || r.herd_id,
      listingPrice: parseFloat(r.listing_price) || 0,
      purchaseStatus: r.purchase_status || "available",
      poolId: r.pool_id || "",
      totalSupply: parseInt(r.total_supply, 10) || 20,
      tokenAmount: parseInt(r.token_amount, 10) || 0,
      dominantStage: r.dominant_stage || "RANCH",
      verified: Boolean(r.verified_flag),
      riskScore: r.risk_score != null ? parseInt(r.risk_score, 10) : null,
      geneticsLabel: BREED_LABEL[r.breed_code] ?? r.breed_code ?? "Unknown",
      season: r.season || "Fall",
      cohortLabel: r.cohort_label || null,
      backingHerdCount: parseInt(r.head_count, 10) || 0,
      stageBreakdown: ["RANCH","AUCTION","BACKGROUNDING","FEEDLOT","PROCESSING","DISTRIBUTION"]
        .map((s) => ({ stage: s, pct: s === (r.dominant_stage || "RANCH") ? 100 : 0 })),
      positionValueUsd: (parseFloat(r.listing_price) || 0) * 1.25,
      expectedRevenueUsd: (parseFloat(r.listing_price) || 0) * 1.40,
      netExpectedUsd: (parseFloat(r.listing_price) || 0) * 0.40,
      lastUpdateIso: r.last_updated ? new Date(r.last_updated).toISOString() : new Date().toISOString(),
      contractAddress: r.contract_address || "",
      rancherId: "",
      poolType: "herd",
    }));
    res.json(pools);
  } catch (err) {
    console.error("GET /api/investors/:slug/holdings", err.message);
    res.status(500).json({ error: "Failed to fetch holdings", detail: err.message });
  }
});

export default router;