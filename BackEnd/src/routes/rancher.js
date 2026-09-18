import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();
const HERD_STATUSES = ["available", "pending", "sold"];

router.use(requireAuth, requireRole("rancher"));

function normalizeStatus(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return HERD_STATUSES.includes(normalized) ? normalized : null;
}

router.get("/me/herds", async (req, res) => {
  const rancherId = req.user.userId;

  const statusFilter = normalizeStatus(req.query.status);
  if (req.query.status && !statusFilter) {
    return res.status(400).json({
      error: "Invalid status filter. Expected one of available, pending, sold.",
    });
  }

  const values = [rancherId];
  const where = ["h.rancher_id = $1"];
  if (statusFilter) {
    values.push(statusFilter);
    where.push(`h.purchase_status = $${values.length}`);
  }

  try {
    const result = await pool.query(
      `
      SELECT
        h.herd_id,
        h.rancher_id,
        h.herd_name,
        h.cohort_label,
        h.breed_code,
        h.season,
        h.dominant_stage,
        h.head_count,
        h.listing_price,
        h.purchase_status,
        h.feedlot_status,
        h.investor_pct,
        h.verified_flag,
        h.last_updated,
        h.created_at,
        COUNT(a.animal_id)::int AS cattle_count
      FROM herds h
      LEFT JOIN animals a ON a.herd_id = h.herd_id
      WHERE ${where.join(" AND ")}
      GROUP BY h.herd_id
      ORDER BY h.created_at DESC
      `,
      values
    );

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch rancher herds." });
  }
});

router.get("/me/summary", async (req, res) => {
  const rancherId = req.user.userId;

  try {
    const [herdStats, cattleHealthStats] = await Promise.all([
      pool.query(
        `
        SELECT
          COUNT(*)::int AS herd_count,
          COALESCE(SUM(listing_price), 0)::float8 AS total_listing_price
        FROM herds
        WHERE rancher_id = $1
        `,
        [rancherId]
      ),
      pool.query(
        `
        SELECT
          COUNT(a.animal_id)::int AS cattle_count,
          COUNT(*) FILTER (WHERE latest_health.verified_flag IS TRUE)::int AS on_track_count,
          COUNT(*) FILTER (WHERE latest_health.verified_flag IS FALSE)::int AS watch_count,
          COUNT(*) FILTER (WHERE latest_health.verified_flag IS NULL)::int AS no_record_count
        FROM herds h
        JOIN animals a ON a.herd_id = h.herd_id
        LEFT JOIN LATERAL (
          SELECT ch.verified_flag
          FROM cow_health ch
          WHERE ch.cow_id = a.animal_id
          ORDER BY COALESCE(ch.administration_date, ch.created_at::date) DESC, ch.created_at DESC
          LIMIT 1
        ) latest_health ON TRUE
        WHERE h.rancher_id = $1
        `,
        [rancherId]
      ),
    ]);

    return res.json({
      rancherId,
      herds: herdStats.rows[0]?.herd_count ?? 0,
      totalListingPrice: herdStats.rows[0]?.total_listing_price ?? 0,
      cattle: cattleHealthStats.rows[0]?.cattle_count ?? 0,
      health: {
        onTrack: cattleHealthStats.rows[0]?.on_track_count ?? 0,
        watch: cattleHealthStats.rows[0]?.watch_count ?? 0,
        noRecord: cattleHealthStats.rows[0]?.no_record_count ?? 0,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch rancher summary." });
  }
});

router.get("/me/status-board", async (req, res) => {
  const rancherId = req.user.userId;

  try {
    const result = await pool.query(
      `
      SELECT
        purchase_status,
        COUNT(*)::int AS herd_count,
        COALESCE(SUM(head_count), 0)::int AS head_count,
        COALESCE(SUM(listing_price), 0)::float8 AS total_listing_price
      FROM herds
      WHERE rancher_id = $1
      GROUP BY purchase_status
      `,
      [rancherId]
    );

    const byStatus = HERD_STATUSES.map((status) => {
      const matched = result.rows.find((row) => row.purchase_status === status);
      return {
        status,
        herds: matched?.herd_count ?? 0,
        headCount: matched?.head_count ?? 0,
        totalListingPrice: matched?.total_listing_price ?? 0,
      };
    });

    const totals = byStatus.reduce(
      (acc, entry) => ({
        herds: acc.herds + entry.herds,
        headCount: acc.headCount + entry.headCount,
        totalListingPrice: acc.totalListingPrice + Number(entry.totalListingPrice ?? 0),
      }),
      { herds: 0, headCount: 0, totalListingPrice: 0 }
    );

    return res.json({ rancherId, totals, byStatus });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch rancher status board." });
  }
});

router.get("/me/investments", async (req, res) => {
  const rancherId = req.user.userId;

  try {
    const result = await pool.query(
      `
      SELECT
        h.herd_id,
        h.herd_name,
        h.purchase_status,
        h.listing_price,
        h.head_count,
        h.last_updated,
        h.created_at,
        tp.pool_id,
        tp.total_supply,
        COALESCE(SUM(o.token_amount), 0)::float8 AS tokens_sold,
        COUNT(DISTINCT o.user_id)::int AS investor_count
      FROM herds h
      LEFT JOIN token_pools tp ON tp.herd_id = h.herd_id
      LEFT JOIN ownership o ON o.pool_id = tp.pool_id
      WHERE h.rancher_id = $1
      GROUP BY h.herd_id, tp.pool_id, tp.total_supply
      ORDER BY h.created_at DESC
      `,
      [rancherId]
    );

    const items = result.rows.map((row) => {
      const listingPrice = row.listing_price === null ? 0 : Number(row.listing_price);
      const totalSupply = row.total_supply === null ? null : Number(row.total_supply);
      const tokensSold = Number(row.tokens_sold ?? 0);
      const investorCount = Number(row.investor_count ?? 0);
      const fundedPercent =
        totalSupply && totalSupply > 0 ? Number(((tokensSold / totalSupply) * 100).toFixed(2)) : 0;
      const unallocatedTokens =
        totalSupply && totalSupply > 0 ? Math.max(totalSupply - tokensSold, 0) : null;
      const estimatedCapitalRaised =
        totalSupply && totalSupply > 0 ? Number(((tokensSold / totalSupply) * listingPrice).toFixed(2)) : 0;

      return {
        herdId: row.herd_id,
        herdName: row.herd_name,
        herdStatus: row.purchase_status,
        listingPrice,
        headCount: row.head_count,
        poolId: row.pool_id,
        totalSupply,
        tokensSold,
        unallocatedTokens,
        investorCount,
        fundedPercent,
        estimatedCapitalRaised,
        lastUpdated: row.last_updated,
        createdAt: row.created_at,
      };
    });

    const totals = items.reduce(
      (acc, item) => ({
        herds: acc.herds + 1,
        pools: acc.pools + (item.poolId ? 1 : 0),
        totalListingPrice: acc.totalListingPrice + item.listingPrice,
        totalSupply: acc.totalSupply + (item.totalSupply ?? 0),
        tokensSold: acc.tokensSold + item.tokensSold,
        investors: acc.investors + item.investorCount,
        estimatedCapitalRaised: acc.estimatedCapitalRaised + item.estimatedCapitalRaised,
      }),
      {
        herds: 0,
        pools: 0,
        totalListingPrice: 0,
        totalSupply: 0,
        tokensSold: 0,
        investors: 0,
        estimatedCapitalRaised: 0,
      }
    );

    totals.fundedPercent =
      totals.totalSupply > 0 ? Number(((totals.tokensSold / totals.totalSupply) * 100).toFixed(2)) : 0;

    return res.json({
      rancherId,
      totals,
      items,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch rancher investments." });
  }
});

export default router;
