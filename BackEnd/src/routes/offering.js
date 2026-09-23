import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { HttpError, isUuid, toCents, dollars, money, withTransaction, sendError } from "../lib/routeHelpers.js";
import { prepareHerdForInvestors } from "../lib/offering.js";
import { voidHerdValueCost } from "../lib/costs.js";
import { STAGES } from "../lib/stages.js";

const router = express.Router();

// Open a herd to investors / close it again. Mounted at /api/herds.
//
//   POST /api/herds/:herdId/open-to-investors   { investorPct, listingPrice? }
//   POST /api/herds/:herdId/close-to-investors
//
// One generic route for any producer that owns the herd. Which roles may use it
// is set by OPEN_ROLES below: feedlots and ranchers (a rancher can raise money
// directly on their own herd).
//
// Opening a herd:
//   - makes sure it has a token pool (off-chain share ledger, supply = head count)
//   - makes sure it has fee terms (copied from the platform defaults if none)
//   - for a rancher-owned herd, books the herd's value (its listing price) as
//     the herd's starting cost, so investors get their money back and share
//     only the gain above that value (a feedlot's purchase price does this job
//     for a feeder herd)
//   - sets investor_pct and the listing price, and lists it (feedlot_status
//     'listed', which is what every investor-facing query looks for)
// It does NOT deploy the on-chain token; the existing publish route does that.
//
// A herd that already has investors cannot be closed here.

const OPEN_ROLES = ["feedlot", "rancher"];
const MAX_PRICE_DOLLARS = 9999999999;

// C3 (punch list): once a herd is past the feedlot stage it's headed to a
// processor, not the investor marketplace - stop it from being opened past
// that point, matching the sale requirement now enforced on stage moves
// (lib/stages.js).
const FEEDLOT_IDX = STAGES.indexOf("FEEDLOT");

function titleCaseStage(stage) {
  if (!stage) return stage;
  return stage.charAt(0) + stage.slice(1).toLowerCase();
}

function parsePct(value) {
  const n = Number(value);
  if (value === undefined || value === null || value === "" || typeof value === "boolean" || !Number.isFinite(n)) {
    throw new HttpError(400, "investorPct is required and must be a number between 0 and 100.");
  }
  if (n <= 0 || n > 100) throw new HttpError(400, "investorPct must be more than 0 and at most 100.");
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-7) {
    throw new HttpError(400, "investorPct can have at most 2 decimal places.");
  }
  return Math.round(n * 100) / 100;
}

// --- POST /api/herds/:herdId/open-to-investors --------------------------------
router.post("/:herdId/open-to-investors", requireAuth, requireRole(...OPEN_ROLES), async (req, res) => {
  const { herdId } = req.params;
  const ownerId = req.user.userId;
  const body = req.body ?? {};
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });

  try {
    const investorPct = parsePct(body.investorPct);

    let priceCents = null;
    if (body.listingPrice !== undefined && body.listingPrice !== null && body.listingPrice !== "") {
      const p = Number(body.listingPrice);
      if (!Number.isFinite(p) || p <= 0 || p > MAX_PRICE_DOLLARS) {
        throw new HttpError(400, "listingPrice must be a number greater than 0.");
      }
      priceCents = toCents(p);
    }

    const out = await withTransaction(async (client) => {
      const herdRes = await client.query(
        `SELECT herd_id, rancher_id, herd_name, head_count, listing_price, feedlot_status, dominant_stage
           FROM herds WHERE herd_id = $1 FOR UPDATE`,
        [herdId]
      );
      if (herdRes.rowCount === 0) throw new HttpError(404, "Herd not found.");
      const herd = herdRes.rows[0];
      if (herd.rancher_id !== ownerId) throw new HttpError(403, "You are not allowed to open this herd to investors.");
      if (herd.feedlot_status === "listed") {
        throw new HttpError(409, "This herd is already open to investors.");
      }
      if (herd.feedlot_status === "sold") {
        throw new HttpError(409, "This herd is sold or has a sale in progress.");
      }
      const stageIdx = STAGES.indexOf(herd.dominant_stage || "RANCH");
      if (stageIdx > FEEDLOT_IDX) {
        throw new HttpError(
          409,
          `This herd is already at the ${titleCaseStage(herd.dominant_stage)} stage, so it can no longer be opened to investors.`
        );
      }

      if (priceCents === null && herd.listing_price != null) priceCents = toCents(herd.listing_price);
      if (!priceCents || priceCents <= 0) {
        throw new HttpError(400, "listingPrice is required - this herd has no price yet.");
      }

      const prep = await prepareHerdForInvestors(client, { herdId, actorUserId: ownerId, listingPriceCents: priceCents });
      const supply = prep.pool.totalSupply;
      if (!(supply > 0)) throw new HttpError(409, "This herd has no head count, so no shares can be offered.");
      const allocation = Math.floor((supply * investorPct) / 100);
      if (allocation < 1) throw new HttpError(400, "That percentage is too small - it would offer less than one share.");

      await client.query(
        `UPDATE herds
            SET investor_pct = $2, listing_price = $3, feedlot_status = 'listed',
                purchase_status = 'available', feedlot_user_id = $4, last_updated = NOW()
          WHERE herd_id = $1`,
        [herdId, investorPct, money(priceCents), req.user.role === "feedlot" ? ownerId : null]
      );

      return { herd, prep, supply, allocation, priceCents };
    });

    const { herd, prep, supply, allocation, priceCents: cents } = out;
    return res.json({
      message: `Herd "${herd.herd_name}" is open to investors: ${investorPct}% offered.`,
      herd: {
        herdId,
        herdName: herd.herd_name,
        headCount: Number(herd.head_count),
        feedlotStatus: "listed",
        investorPct,
        listingPrice: dollars(cents),
      },
      offering: {
        totalSupply: supply,
        investorAllocation: allocation,
        pricePerToken: Math.round((cents / supply)) / 100,
        maxRaise: dollars(Math.floor((cents * allocation) / supply)),
      },
      tokenPool: prep.pool,
      feeTerms: prep.terms,
      feeTermsCreatedFromDefaults: prep.termsCreated,
      startingValue: prep.startingValue,
      warnings: prep.warnings,
    });
  } catch (err) {
    return sendError(res, "POST /api/herds/:herdId/open-to-investors", err);
  }
});

// --- POST /api/herds/:herdId/close-to-investors -------------------------------
// Takes a herd back off the marketplace. Only while nobody has bought in.
router.post("/:herdId/close-to-investors", requireAuth, requireRole(...OPEN_ROLES), async (req, res) => {
  const { herdId } = req.params;
  const ownerId = req.user.userId;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });

  try {
    const herd = await withTransaction(async (client) => {
      const herdRes = await client.query(
        "SELECT herd_id, rancher_id, herd_name, feedlot_status, tokens_sold FROM herds WHERE herd_id = $1 FOR UPDATE",
        [herdId]
      );
      if (herdRes.rowCount === 0) throw new HttpError(404, "Herd not found.");
      const h = herdRes.rows[0];
      if (h.rancher_id !== ownerId) throw new HttpError(403, "You are not allowed to close this herd.");
      if (h.feedlot_status !== "listed") throw new HttpError(409, "This herd is not open to investors.");

      const paid = await client.query("SELECT 1 FROM investor_payments WHERE herd_id = $1 LIMIT 1", [herdId]);
      const held = await client.query(
        `SELECT 1 FROM ownership o JOIN token_pools tp ON tp.pool_id = o.pool_id
          WHERE tp.herd_id = $1 AND o.token_amount > 0 LIMIT 1`,
        [herdId]
      );
      if (Number(h.tokens_sold) > 0 || paid.rowCount > 0 || held.rowCount > 0) {
        throw new HttpError(409, "Investors have already bought into this herd, so it cannot be closed.");
      }

      await client.query(
        "UPDATE herds SET feedlot_status = 'pending', purchase_status = 'pending', last_updated = NOW() WHERE herd_id = $1",
        [herdId]
      );
      await voidHerdValueCost(client, herdId);
      return h;
    });
    return res.json({
      message: `Herd "${herd.herd_name}" is closed to investors.`,
      herdId,
      feedlotStatus: "pending",
    });
  } catch (err) {
    return sendError(res, "POST /api/herds/:herdId/close-to-investors", err);
  }
});

export default router;
