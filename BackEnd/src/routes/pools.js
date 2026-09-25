// import express from "express";
// import pool from "../db.js";

// const router = express.Router();

// // â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// function normalisePurchaseStatus(raw) {
//   if (raw === "available" || raw === "pending" || raw === "sold") return raw;
//   return "available";
// }

// function buildStageBreakdown(stage) {
//   const all = ["RANCH", "AUCTION", "BACKGROUNDING", "FEEDLOT", "PROCESSING", "DISTRIBUTION"];
//   return all.map((s) => ({ stage: s, pct: s === stage ? 100 : 0 }));
// }

// const BREED_LABEL = {
//   AN: "Angus AI Select",
//   HH: "Hereford Registered",
//   WA: "Wagyu F1 Cross",
//   BR: "Brahman AI Select",
//   BA: "Black Angus Premium AI",
//   CH: "Charolais Fullblood",
//   SM: "Simmental Registered AI",
//   RA: "Red Angus AI Elite",
// };

// // function shapePool(row, tokenAmount = 20) {
// //   const stage = row.dominant_stage || "RANCH";
// //   const lp = parseFloat(row.listing_price) || 0;
// //   const positionValueUsd = parseFloat(row.position_value_usd) || lp * 1.25;
// //   const expectedRevenueUsd = lp * 1.40;

// //   return {
// //     id: row.herd_id,
// //     herdId: row.herd_id,
// //     rancherId: row.rancher_id,
// //     listingPrice: lp,
// //     purchaseStatus: normalisePurchaseStatus(row.purchase_status),
// //     poolId: row.pool_id || "",
// //     totalSupply: parseInt(row.total_supply, 10) || 20,
// //     contractAddress: row.contract_address || "",
// //     tokenAmount,
// //     name: row.herd_name || row.herd_id,
// //     poolType: "herd",
// //     cohortLabel: row.cohort_label || null,
// //     geneticsLabel: BREED_LABEL[row.breed_code] ?? row.breed_code ?? "Unknown",
// //     season: row.season || "Fall",
// //     positionValueUsd,
// //     backingHerdCount: parseInt(row.head_count, 10) || 0,
// //     expectedRevenueUsd,
// //     netExpectedUsd: expectedRevenueUsd - lp,
// //     stageBreakdown: buildStageBreakdown(stage),
// //     dominantStage: stage,
// //     verified: Boolean(row.verified_flag),
// //     lastUpdateIso: row.last_updated
// //       ? new Date(row.last_updated).toISOString()
// //       : new Date().toISOString(),
// //   };
// // }

// // â”€â”€â”€ base SELECT â€” uses LATERAL to avoid the GROUP BY / ORDER BY in aggregate bug
// // const POOL_QUERY = `
// //   SELECT
// //     h.herd_id,
// //     h.rancher_id,
// //     h.herd_name,
// //     h.listing_price,
// //     h.purchase_status,
// //     h.head_count,
// //     h.verified_flag,
// //     h.last_updated,
// //     h.cohort_label,
// //     h.season,
// //     h.breed_code,
// //     h.dominant_stage,
// //     tp.pool_id,
// //     tp.total_supply,
// //     tp.contract_address,
// //     COALESCE(
// //       (
// //         SELECT SUM(latest.fair_value)
// //         FROM animals a
// //         CROSS JOIN LATERAL (
// //           SELECT cv.fair_value
// //           FROM cow_valuation cv
// //           WHERE cv.cow_id = a.animal_id
// //           ORDER BY cv.valuation_date DESC
// //           LIMIT 1
// //         ) latest
// //         WHERE a.herd_id = h.herd_id
// //       ),
// //       h.listing_price * 1.25
// //     ) AS position_value_usd
// //   FROM herds h
// //   LEFT JOIN token_pools tp ON tp.herd_id = h.herd_id
// // `;

// function shapePool(row, tokenAmount = 20) {
//   const stage       = row.dominant_stage || "RANCH";
//   const lp          = parseFloat(row.listing_price) || 0;
//   const positionValueUsd  = parseFloat(row.position_value_usd) || lp * 1.25;
//   const expectedRevenueUsd = lp * 1.40;
//   const totalSupply = parseInt(row.total_supply, 10) || 20;
//   const tokensSold  = parseInt(row.tokens_sold, 10)  || 0;
//   const tokensRemaining = Math.max(0, totalSupply - tokensSold);

//   // Data-driven availability: sold only when all tokens gone
//   let purchaseStatus = normalisePurchaseStatus(row.purchase_status);
//   if (tokensRemaining <= 0) purchaseStatus = "sold";

//   return {
//     id: row.herd_id,
//     herdId: row.herd_id,
//     rancherId: row.rancher_id,
//     listingPrice: lp,
//     purchaseStatus,
//     poolId: row.pool_id || "",
//     totalSupply,
//     tokensSold,
//     tokensRemaining,
//     contractAddress: row.contract_address || "",
//     tokenAmount,
//     name: row.herd_name || row.herd_id,          // â† herd_name, never raw UUID
//     poolType: "herd",
//     cohortLabel: row.cohort_label || null,
//     geneticsLabel: BREED_LABEL[row.breed_code] ?? row.breed_code ?? "Unknown",
//     season: row.season || "Fall",
//     positionValueUsd,
//     backingHerdCount: parseInt(row.head_count, 10) || 0,
//     expectedRevenueUsd,
//     netExpectedUsd: expectedRevenueUsd - lp,
//     stageBreakdown: buildStageBreakdown(stage),
//     dominantStage: stage,
//     verified: Boolean(row.verified_flag),
//     riskScore: row.risk_score != null ? parseInt(row.risk_score, 10) : null,
//     lastUpdateIso: row.last_updated
//       ? new Date(row.last_updated).toISOString()
//       : new Date().toISOString(),
//   };
// }


// const POOL_QUERY = `
// SELECT
//   h.herd_id, h.rancher_id, h.herd_name, h.listing_price, h.purchase_status,
//   h.head_count, h.verified_flag, h.last_updated, h.cohort_label, h.season,
//   h.breed_code, h.dominant_stage, h.risk_score,
//   COALESCE(h.tokens_sold, 0) AS tokens_sold,
//   tp.pool_id, tp.total_supply, tp.contract_address,
//   COALESCE(
//     (SELECT SUM(latest.fair_value)
//      FROM animals a
//      CROSS JOIN LATERAL (
//        SELECT cv.fair_value FROM cow_valuation cv
//        WHERE cv.cow_id = a.animal_id
//        ORDER BY cv.valuation_date DESC LIMIT 1
//      ) latest
//      WHERE a.herd_id = h.herd_id),
//     h.listing_price * 1.25
//   ) AS position_value_usd
// FROM herds h
// LEFT JOIN token_pools tp ON tp.herd_id = h.herd_id
// `;


// // â”€â”€â”€ GET /api/pools â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// router.get("/", async (req, res) => {
//   try {
//     // Check if ownership records exist
//     const ownershipCheck = await pool.query("SELECT COUNT(*) FROM ownership");
//     const hasOwnership = parseInt(ownershipCheck.rows[0].count, 10) > 0;

//     let rows;
//     if (hasOwnership) {
//       // Only return herds that investors hold tokens in
//       const result = await pool.query(`
//         ${POOL_QUERY}
//         WHERE h.herd_id IN (
//           SELECT DISTINCT tp2.herd_id
//           FROM ownership o
//           JOIN token_pools tp2 ON tp2.pool_id = o.pool_id
//           JOIN users u ON u.user_id = o.user_id
//           WHERE u.role = 'investor'
//         )
//         ORDER BY h.last_updated DESC
//       `);
//       rows = result.rows;
//     } else {
//       // Fallback: return all herds if ownership table is empty
//       const result = await pool.query(`${POOL_QUERY} ORDER BY h.last_updated DESC`);
//       rows = result.rows;
//     }

//     // Get investor token amounts per herd
//     let tokenAmounts = {};
//     if (hasOwnership) {
//       const taRes = await pool.query(`
//         SELECT tp.herd_id, SUM(o.token_amount)::int AS total_tokens
//         FROM ownership o
//         JOIN token_pools tp ON tp.pool_id = o.pool_id
//         JOIN users u ON u.user_id = o.user_id
//         WHERE u.role = 'investor'
//         GROUP BY tp.herd_id
//       `);
//       taRes.rows.forEach((r) => {
//         tokenAmounts[r.herd_id] = r.total_tokens;
//       });
//     }

//     res.json(rows.map((r) => shapePool(r, tokenAmounts[r.herd_id] ?? 20)));
//   } catch (err) {
//     console.error("GET /api/pools error:", err.message);
//     res.status(500).json({ error: "Failed to fetch pools", detail: err.message });
//   }
// });

// // â”€â”€â”€ GET /api/pools/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// router.get("/:id", async (req, res) => {
//   try {
//     const { id } = req.params;

//     const herdResult = await pool.query(`${POOL_QUERY} AND h.herd_id = $1`, [id]);

//     if (herdResult.rows.length === 0) {
//       return res.status(404).json({ error: "Pool not found" });
//     }

//     const poolRow = shapePool(herdResult.rows[0]);

//     // â”€â”€ lifecycle events: recent vaccinations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//     const eventsResult = await pool.query(
//       `SELECT
//          'ev-' || av.animal_vacc_id::text      AS id,
//          h.herd_id                              AS pool_id,
//          a.animal_id::text                      AS cow_id,
//          COALESCE(h.dominant_stage, 'RANCH')    AS stage,
//          h.verified_flag                         AS verified,
//          av.administration_date::timestamptz     AS timestamp_iso,
//          v.vaccine_name || ' administered'       AS note
//        FROM animal_vaccinations av
//        JOIN animals a  ON a.animal_id  = av.animal_id
//        JOIN herds   h  ON h.herd_id    = a.herd_id
//        JOIN vaccines v ON v.vaccine_id = av.vaccine_id
//        WHERE a.herd_id = $1
//        ORDER BY av.administration_date DESC
//        LIMIT 15`,
//       [id]
//     );

//     let lifecycle = eventsResult.rows.map((r) => ({
//       id: r.id,
//       poolId: r.pool_id,
//       cowId: r.cow_id,
//       stage: r.stage,
//       verified: Boolean(r.verified),
//       timestampIso: new Date(r.timestamp_iso).toISOString(),
//       note: r.note,
//     }));

//     if (lifecycle.length === 0) {
//       lifecycle = [{
//         id: `ev-herd-${id}`,
//         poolId: id,
//         cowId: null,
//         stage: poolRow.dominantStage,
//         verified: poolRow.verified,
//         timestampIso: poolRow.lastUpdateIso,
//         note: `Herd entered ${poolRow.dominantStage} stage`,
//       }];
//     }

//     // â”€â”€ budget breakdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//     const lp = poolRow.listingPrice;
//     const budgetBreakdown = [
//       { label: "Cattle Acquisition",   amountUsd: Math.round(lp * 0.36), category: "cost" },
//       { label: "Operating Costs",      amountUsd: Math.round(lp * 0.64), category: "cost" },
//       { label: "Expected Revenue",     amountUsd: Math.round(lp * 1.40), category: "revenue" },
//     ];

//     // â”€â”€ 30-day valuation history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//     const valuationHistory30d = Array.from({ length: 31 }, (_, i) => {
//       const d = new Date();
//       d.setDate(d.getDate() - (30 - i));
//       const variance = 0.97 + (i / 30) * 0.06 + Math.sin(i * 0.5) * 0.01;
//       return {
//         dateIso: d.toISOString(),
//         value: Math.round(poolRow.positionValueUsd * variance),
//       };
//     });

//     const documents = [
//       { title: "Certificate of Origin",     type: "certificate", url: "#" },
//       { title: "Health Inspection Report",  type: "inspection",  url: "#" },
//       { title: "Ownership Transfer Record", type: "transfer",    url: "#" },
//     ];

//     res.json({ pool: poolRow, lifecycle, budgetBreakdown, valuationHistory30d, documents });
//   } catch (err) {
//     console.error("GET /api/pools/:id error:", err.message);
//     res.status(500).json({ error: "Failed to fetch pool detail", detail: err.message });
//   }
// });

// // â”€â”€â”€ GET /api/pools/:id/cows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// router.get("/:id/cows", async (req, res) => {
//   try {
//     const { id } = req.params;

//     const herdCheck = await pool.query(
//       "SELECT herd_id, dominant_stage, verified_flag, listing_price, head_count FROM herds WHERE herd_id = $1",
//       [id]
//     );
//     if (herdCheck.rows.length === 0) {
//       return res.status(404).json({ error: "Herd not found" });
//     }

//     const herd = herdCheck.rows[0];
//     const stage = herd.dominant_stage || "RANCH";
//     const baseCost = parseFloat(herd.listing_price) / Math.max(parseInt(herd.head_count, 10), 1);

//     const animalsResult = await pool.query(
//       `SELECT
//          a.animal_id,
//          a.herd_id,
//          a.registration_number,
//          a.official_id,
//          a.animal_name,
//          a.breed_code,
//          a.sex_code,
//          a.birth_date,
//          a.sire_registration_number,
//          a.dam_registration_number,
//          a.is_genomic_enhanced,
//          a.created_at,
//          lw.weight_lbs,
//          lv.fair_value,
//          EXISTS(
//            SELECT 1 FROM animal_health_programs ahp
//            WHERE ahp.animal_id = a.animal_id AND ahp.verified_flag = true
//          ) AS verified
//        FROM animals a
//        LEFT JOIN LATERAL (
//          SELECT weight_lbs FROM animal_weights
//          WHERE animal_id = a.animal_id
//          ORDER BY weight_date DESC LIMIT 1
//        ) lw ON true
//        LEFT JOIN LATERAL (
//          SELECT fair_value FROM cow_valuation
//          WHERE cow_id = a.animal_id
//          ORDER BY valuation_date DESC LIMIT 1
//        ) lv ON true
//        WHERE a.herd_id = $1
//        ORDER BY a.animal_id`,
//       [id]
//     );

//     const cows = animalsResult.rows.map((a) => {
//       const weightLbs = parseFloat(a.weight_lbs) || 700;
//       const totalValue = parseFloat(a.fair_value) || Math.round(baseCost * 1.4);
//       const verified = Boolean(a.verified);

//       return {
//         cowId: a.animal_id.toString(),
//         herdId: a.herd_id,
//         registrationNumber: a.registration_number || "",
//         officialId: a.official_id || "",
//         animalName: a.animal_name || `Animal ${a.animal_id}`,
//         breedCode: a.breed_code || "AN",
//         sexCode: a.sex_code || "S",
//         birthDate: a.birth_date
//           ? new Date(a.birth_date).toISOString().split("T")[0]
//           : "",
//         sireRegistrationNumber: a.sire_registration_number || "",
//         damRegistrationNumber: a.dam_registration_number || "",
//         isGenomicEnhanced: Boolean(a.is_genomic_enhanced),
//         createdAt: new Date(a.created_at).toISOString(),
//         stage,
//         weightLbs,
//         health: verified ? "On Track" : "Watch",
//         daysInStage: 14,
//         costToDateUsd: Math.round(baseCost * 0.85),
//         totalValue,
//         verified,
//       };
//     });

//     res.json(cows);
//   } catch (err) {
//     console.error("GET /api/pools/:id/cows error:", err.message);
//     res.status(500).json({ error: "Failed to fetch cows", detail: err.message });
//   }
// });

// export default router;

import express from "express";
import pool from "../db.js";

const router = express.Router();

// â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function normalisePurchaseStatus(raw) {
  if (raw === "available" || raw === "pending" || raw === "sold") return raw;
  return "available";
}

function buildStageBreakdown(stage) {
  const all = ["RANCH", "AUCTION", "BACKGROUNDING", "FEEDLOT", "PROCESSING", "DISTRIBUTION"];
  return all.map((s) => ({ stage: s, pct: s === stage ? 100 : 0 }));
}

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

// Same labels as FrontEnd/src/lib/money.ts's COST_LABELS - keep in sync.
const COST_LABELS = {
  feed: "Feed",
  yardage: "Yardage",
  vet: "Vet and health",
  death_loss_reserve: "Death-loss reserve",
  lrp_premium: "LRP price-protection premium",
  purchase: "What the cattle cost to buy",
  herd_value: "Starting value of the herd",
  other: "Other",
};

function shapePool(row, tokenAmount = 0) {
  const stage       = row.dominant_stage || "RANCH";
  const lp          = parseFloat(row.listing_price) || 0;
  // Real ledger numbers, not a projection: what investors have actually paid
  // in so far, and what the herd has actually cost so far (see
  // step-dashboard-real-numbers.md - this used to be listing price x 1.25 /
  // x 1.40, which had no connection to the real books).
  const totalRaised = parseFloat(row.total_raised) || 0;
  const costsTotal  = parseFloat(row.total_costs) || 0;
  const totalSupply = parseInt(row.total_supply, 10) || 20;
  const tokensSold  = parseInt(row.tokens_sold, 10)  || 0;
  const investorPct = row.investor_pct != null ? parseFloat(row.investor_pct) : null;

  // Investor allocation = the portion of total supply feedlot made available
  const investorAllocation = investorPct != null
    ? Math.floor(totalSupply * investorPct / 100)
    : totalSupply;

  const tokensRemaining = Math.max(0, investorAllocation - tokensSold);

  // Sold only when all INVESTOR-allocated tokens are gone
  let purchaseStatus = normalisePurchaseStatus(row.purchase_status);
  if (tokensRemaining <= 0) purchaseStatus = "sold";

  return {
    id: row.herd_id,
    herdId: row.herd_id,
    rancherId: row.rancher_id,
    listingPrice: lp,
    purchaseStatus,
    poolId: row.pool_id || "",
    totalSupply,
    tokensSold,
    tokensRemaining,
    investorAllocation,
    investorPct,
    contractAddress: row.contract_address || "",
    tokenAmount,       // how many tokens THIS investor holds (0 = not invested)
    name: row.herd_name || row.herd_id,
    poolType: "herd",
    cohortLabel: row.cohort_label || null,
    geneticsLabel: BREED_LABEL[row.breed_code] ?? row.breed_code ?? "Unknown",
    season: row.season || "Fall",
    totalRaised,
    costsTotal,
    backingHerdCount: parseInt(row.head_count, 10) || 0,
    stageBreakdown: buildStageBreakdown(stage),
    dominantStage: stage,
    verified: Boolean(row.verified_flag),
    riskScore: row.risk_score != null ? parseInt(row.risk_score, 10) : null,
    lastUpdateIso: row.last_updated
      ? new Date(row.last_updated).toISOString()
      : new Date().toISOString(),
  };
}

// Base SELECT used by list + detail routes.
// Only surfaces herds that a feedlot has reviewed and listed for investors
// (feedlot_status = 'listed'). Herds still 'pending' feedlot review are hidden.
const POOL_QUERY = `
SELECT
  h.herd_id, h.rancher_id, h.herd_name, h.listing_price, h.purchase_status,
  h.head_count, h.verified_flag, h.last_updated, h.cohort_label, h.season,
  h.breed_code, h.dominant_stage, h.risk_score,
  h.investor_pct,
  COALESCE(h.tokens_sold, 0) AS tokens_sold,
  tp.pool_id, tp.total_supply, tp.contract_address,
  COALESCE((SELECT SUM(ip.amount) FROM investor_payments ip WHERE ip.herd_id = h.herd_id), 0) AS total_raised,
  COALESCE((SELECT SUM(e.amount) FROM herd_expenses e WHERE e.herd_id = h.herd_id AND e.status = 'active'), 0) AS total_costs
FROM herds h
LEFT JOIN token_pools tp ON tp.herd_id = h.herd_id
WHERE h.feedlot_status = 'listed'
`;

// â”€â”€â”€ GET /api/pools â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns ALL herds so investors can browse the full marketplace.
// tokenAmount is populated for any herd where an investor-role user owns tokens.
router.get("/", async (req, res) => {
  try {
    // Fetch all herds
    const result = await pool.query(`${POOL_QUERY} ORDER BY h.last_updated DESC`);

    // Build investor token amounts per herd (aggregate across all investor users)
    const taRes = await pool.query(`
      SELECT tp.herd_id, SUM(o.token_amount)::int AS total_tokens
      FROM ownership o
      JOIN token_pools tp ON tp.pool_id = o.pool_id
      JOIN users u ON u.user_id = o.user_id
      WHERE u.role = 'investor'
      GROUP BY tp.herd_id
    `);
    const tokenAmounts = {};
    taRes.rows.forEach((r) => {
      tokenAmounts[r.herd_id] = r.total_tokens;
    });

    res.json(result.rows.map((r) => shapePool(r, tokenAmounts[r.herd_id] ?? 0)));
  } catch (err) {
    console.error("GET /api/pools error:", err.message);
    res.status(500).json({ error: "Failed to fetch pools", detail: err.message });
  }
});

// â”€â”€â”€ GET /api/pools/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const herdResult = await pool.query(`${POOL_QUERY} AND h.herd_id = $1`, [id]);

    if (herdResult.rows.length === 0) {
      return res.status(404).json({ error: "Pool not found" });
    }

    // Token amount for this herd (aggregate investor ownership)
    const taRes = await pool.query(`
      SELECT COALESCE(SUM(o.token_amount), 0)::int AS total_tokens
      FROM ownership o
      JOIN token_pools tp ON tp.pool_id = o.pool_id
      JOIN users u ON u.user_id = o.user_id
      WHERE tp.herd_id = $1 AND u.role = 'investor'
    `, [id]);
    const tokenAmount = taRes.rows[0]?.total_tokens ?? 0;

    const poolRow = shapePool(herdResult.rows[0], tokenAmount);

    // â”€â”€ lifecycle events: recent vaccinations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const eventsResult = await pool.query(
      `SELECT
         'ev-' || av.animal_vacc_id::text      AS id,
         h.herd_id                              AS pool_id,
         a.animal_id::text                      AS cow_id,
         COALESCE(h.dominant_stage, 'RANCH')    AS stage,
         h.verified_flag                         AS verified,
         av.administration_date::timestamptz     AS timestamp_iso,
         v.vaccine_name || ' administered'       AS note
       FROM animal_vaccinations av
       JOIN animals a  ON a.animal_id  = av.animal_id
       JOIN herds   h  ON h.herd_id    = a.herd_id
       JOIN vaccines v ON v.vaccine_id = av.vaccine_id
       WHERE a.herd_id = $1
       ORDER BY av.administration_date DESC
       LIMIT 15`,
      [id]
    );

    let lifecycle = eventsResult.rows.map((r) => ({
      id: r.id,
      poolId: r.pool_id,
      cowId: r.cow_id,
      stage: r.stage,
      verified: Boolean(r.verified),
      timestampIso: new Date(r.timestamp_iso).toISOString(),
      note: r.note,
    }));

    if (lifecycle.length === 0) {
      lifecycle = [{
        id: `ev-herd-${id}`,
        poolId: id,
        cowId: null,
        stage: poolRow.dominantStage,
        verified: poolRow.verified,
        timestampIso: poolRow.lastUpdateIso,
        note: `Herd entered ${poolRow.dominantStage} stage`,
      }];
    }

    // â”€â”€ cost breakdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Real logged costs by category, not a fabricated percentage of listing
    // price (see step-dashboard-real-numbers.md). Public/herd-level, same
    // category labels the My Money / Herd operations screens use, so a
    // browsing investor sees the real numbers even before they hold shares
    // (the gated per-viewer cost card on this page, from step 10, only shows
    // once they hold shares or are the owner/admin).
    const costRes = await pool.query(
      `SELECT category, SUM(amount) AS amount
         FROM herd_expenses
        WHERE herd_id = $1 AND status = 'active'
        GROUP BY category
        ORDER BY SUM(amount) DESC`,
      [id]
    );
    const costBreakdown = costRes.rows.map((r) => ({
      label: COST_LABELS[r.category] ?? r.category,
      amountUsd: Math.round(parseFloat(r.amount) || 0),
    }));

    // I5 (2026-09-25): these used to be hardcoded placeholder rows with
    // href="#" - not real documents, just fake links an investor could click
    // and get nowhere. Until real per-herd documents exist, send none; the
    // frontend's `data.documents.length > 0` guard already hides the whole
    // card when this is empty.
    const documents = [];

    res.json({ pool: poolRow, lifecycle, costBreakdown, documents });
  } catch (err) {
    console.error("GET /api/pools/:id error:", err.message);
    res.status(500).json({ error: "Failed to fetch pool detail", detail: err.message });
  }
});

// â”€â”€â”€ GET /api/pools/:id/cows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get("/:id/cows", async (req, res) => {
  try {
    const { id } = req.params;

    const herdCheck = await pool.query(
      "SELECT herd_id, dominant_stage, verified_flag, listing_price, head_count FROM herds WHERE herd_id = $1",
      [id]
    );
    if (herdCheck.rows.length === 0) {
      return res.status(404).json({ error: "Herd not found" });
    }

    const herd = herdCheck.rows[0];
    const stage = herd.dominant_stage || "RANCH";
    const baseCost = parseFloat(herd.listing_price) / Math.max(parseInt(herd.head_count, 10), 1);

    const animalsResult = await pool.query(
      `SELECT
         a.animal_id,
         a.herd_id,
         a.registration_number,
         a.official_id,
         a.animal_name,
         a.breed_code,
         a.sex_code,
         a.birth_date,
         a.sire_registration_number,
         a.dam_registration_number,
         a.is_genomic_enhanced,
         a.created_at,
         lw.weight_lbs,
         lv.fair_value,
         EXISTS(
           SELECT 1 FROM animal_health_programs ahp
           WHERE ahp.animal_id = a.animal_id AND ahp.verified_flag = true
         ) AS verified
       FROM animals a
       LEFT JOIN LATERAL (
         SELECT weight_lbs FROM animal_weights
         WHERE animal_id = a.animal_id
         ORDER BY weight_date DESC LIMIT 1
       ) lw ON true
       LEFT JOIN LATERAL (
         SELECT fair_value FROM cow_valuation
         WHERE cow_id = a.animal_id
         ORDER BY valuation_date DESC LIMIT 1
       ) lv ON true
       WHERE a.herd_id = $1
       ORDER BY a.animal_id`,
      [id]
    );

    const cows = animalsResult.rows.map((a) => {
      const weightLbs = parseFloat(a.weight_lbs) || 700;
      const totalValue = parseFloat(a.fair_value) || Math.round(baseCost * 1.4);
      const verified = Boolean(a.verified);

      return {
        cowId: a.animal_id.toString(),
        herdId: a.herd_id,
        registrationNumber: a.registration_number || "",
        officialId: a.official_id || "",
        animalName: a.animal_name || `Animal ${a.animal_id}`,
        breedCode: a.breed_code || "AN",
        sexCode: a.sex_code || "S",
        birthDate: a.birth_date
          ? new Date(a.birth_date).toISOString().split("T")[0]
          : "",
        sireRegistrationNumber: a.sire_registration_number || "",
        damRegistrationNumber: a.dam_registration_number || "",
        isGenomicEnhanced: Boolean(a.is_genomic_enhanced),
        createdAt: new Date(a.created_at).toISOString(),
        stage,
        weightLbs,
        health: verified ? "On Track" : "Watch",
        daysInStage: 14,
        costToDateUsd: Math.round(baseCost * 0.85),
        totalValue,
        verified,
      };
    });

    res.json(cows);
  } catch (err) {
    console.error("GET /api/pools/:id/cows error:", err.message);
    res.status(500).json({ error: "Failed to fetch cows", detail: err.message });
  }
});

export default router;