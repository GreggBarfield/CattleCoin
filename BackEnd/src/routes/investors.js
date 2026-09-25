import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { getInvestorMoney } from "../lib/investorMoney.js";

const router = express.Router();

const BREED_LABEL = {
  AN: "Angus AI Select", HH: "Hereford Registered", WA: "Wagyu F1 Cross",
  BR: "Brahman AI Select", BA: "Black Angus Premium AI", CH: "Charolais Fullblood",
  SM: "Simmental Registered AI", RA: "Red Angus AI Elite",
};

const ALL_STAGES = ["RANCH","BACKGROUNDING","FEEDLOT","PROCESSING","DISTRIBUTION"];

// Merge the real per-herd money numbers (lib/investorMoney.js) with the
// display fields the dashboard/lot cards need (breed label, stage, verified,
// risk score) that the money query does not carry. One extra query, keyed by
// the same herd ids getInvestorMoney already resolved.
async function attachDisplayFields(moneyHerds) {
  const herdIds = moneyHerds.map((h) => h.herdId);
  if (herdIds.length === 0) return [];
  const res = await pool.query(
    `SELECT h.herd_id, h.rancher_id, h.purchase_status, h.verified_flag, h.last_updated,
            h.cohort_label, h.season, h.breed_code, h.dominant_stage, h.risk_score,
            h.listing_price, tp.pool_id, tp.contract_address
       FROM herds h
       LEFT JOIN token_pools tp ON tp.herd_id = h.herd_id
      WHERE h.herd_id = ANY($1::uuid[])`,
    [herdIds]
  );
  const byId = new Map(res.rows.map((r) => [r.herd_id, r]));
  return moneyHerds.map((m) => {
    const r = byId.get(m.herdId) ?? {};
    const stage = r.dominant_stage || "RANCH";
    return {
      // Money numbers, straight from the ledger - no projections.
      id: m.herdId,
      herdId: m.herdId,
      paidIn: m.paidIn,
      estimatedExtra: m.estimatedExtra,
      costsTotal: m.costsTotal,
      state: m.state,
      sale: m.sale,
      payout: m.payout,
      tokenAmount: m.tokens,
      totalSupply: m.totalSupply ?? 20,
      sharePct: m.sharePct,
      // Display fields (real, from the herds table - not money math).
      rancherId: r.rancher_id || "",
      listingPrice: parseFloat(r.listing_price) || 0,
      purchaseStatus: r.purchase_status || "available",
      poolId: r.pool_id || "",
      contractAddress: r.contract_address || "",
      name: m.herdName,
      poolType: "herd",
      cohortLabel: r.cohort_label || null,
      geneticsLabel: BREED_LABEL[r.breed_code] ?? r.breed_code ?? "Unknown",
      season: r.season || "Fall",
      backingHerdCount: m.headCount ?? 0,
      stageBreakdown: ALL_STAGES.map((s) => ({ stage: s, pct: s === stage ? 100 : 0 })),
      dominantStage: stage,
      verified: Boolean(r.verified_flag),
      riskScore: r.risk_score != null ? parseInt(r.risk_score, 10) : null,
      lastUpdateIso: r.last_updated ? new Date(r.last_updated).toISOString() : new Date().toISOString(),
    };
  });
}

// ─── GET /api/investors/:slug/portfolio ─────────────────────────────────────
// Returns the Dashboard data scoped to a single investor (by slug, e.g. "investor2")
// Security fix 2026-09-21: this route previously had no requireAuth at all -
// anyone who knew (or guessed) an investor's slug could read that investor's
// full portfolio. Now requires a logged-in investor/admin, and (unless the
// caller is an admin) the token's own slug must match the :slug being read.
// See handoff-next-chat.md / technical reference section 13.3.
//
// Numbers fix 2026-09-21: this route used to show a fabricated "position value"
// (listing price x 1.25) and "expected revenue" (x 1.40), plus a hardcoded
// 30-day change (4.2%) and a randomized fake history chart - none of it came
// from the ledger. It now reports the real money picture (what was actually
// paid in, what's still invested, what's been received or is owed from a
// sale), shared with GET /api/my-money via lib/investorMoney.js. See
// step-dashboard-real-numbers.md.
router.get("/:slug/portfolio", requireAuth, requireRole("investor", "admin"), async (req, res) => {
  try {
    const { slug } = req.params;

    if (req.user.role !== "admin" && req.user.slug !== slug) {
      return res.status(403).json({ error: "Investors may only view their own portfolio." });
    }

    const userRes = await pool.query(
      "SELECT user_id FROM users WHERE slug = $1 AND role = 'investor'",
      [slug]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: `Investor '${slug}' not found` });
    }
    const { user_id } = userRes.rows[0];

    const { totals, herds: moneyHerds } = await getInvestorMoney(user_id);
    const pools = await attachDisplayFields(moneyHerds);

    const avgRisk = pools.length
      ? Math.round(pools.filter(p => p.riskScore != null).reduce((s, p) => s + p.riskScore, 0) / pools.filter(p => p.riskScore != null).length)
      : null;

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

    const topPools = [...pools].sort((a, b) => b.paidIn - a.paidIn).slice(0, 5);

    res.json({
      investorSlug: slug,
      asOfIso: new Date().toISOString(),
      totals,
      poolsHeld: pools.length,
      avgRisk,
      recentEvents,
      topPools,
    });
  } catch (err) {
    console.error("GET /api/investors/:slug/portfolio", err.message);
    res.status(500).json({ error: "Failed to fetch investor portfolio", detail: err.message });
  }
});

// ─── GET /api/investors/:slug/holdings ──────────────────────────────────────
// Returns only this investor's held pools (for the "My Investments" cards).
// Security fix 2026-09-21: same fix as /portfolio above - requireAuth plus a
// same-investor-or-admin check.
// Numbers fix 2026-09-21: same as /portfolio - real paidIn/costsTotal instead
// of a listing-price multiplier. See step-dashboard-real-numbers.md.
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

    const { herds: moneyHerds } = await getInvestorMoney(user_id);
    // Holdings = only herds where this investor currently holds tokens (not
    // every herd they've ever paid into or been paid from).
    const held = moneyHerds.filter((h) => h.tokens > 0);
    const pools = await attachDisplayFields(held);
    res.json(pools);
  } catch (err) {
    console.error("GET /api/investors/:slug/holdings", err.message);
    res.status(500).json({ error: "Failed to fetch holdings", detail: err.message });
  }
});

export default router;