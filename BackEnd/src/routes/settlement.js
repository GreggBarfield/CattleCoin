import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { HttpError, isUuid, toCents, dollars, money, withTransaction, sendError } from "../lib/routeHelpers.js";
import { loadHerdTerms, pctToBps, feeOnCents, getFundsPosition } from "../lib/feeTerms.js";
import { transferHerdToBuyer } from "../lib/transfer.js";

const router = express.Router();

// Sale / settlement engine.
//
// Flow:
//   1. The herd's owner (rancher or feedlot) submits a sale: price + buyer.
//      The herd is closed to new investors immediately.
//   2. An admin reviews the computed split and approves (or rejects).
//      If the buyer is a platform producer, that buyer must ACCEPT the sale
//      first (or decline it, which closes the sale). An admin cannot approve
//      a platform-buyer sale until the buyer has accepted.
//   3. Approval freezes the numbers and creates a payout row for everyone
//      owed money. Admin marks each payout paid, with a reference.
//   4. When the buyer is a platform producer, approval also hands the herd
//      over: a new herd is created in the buyer's account, the animal records
//      move to it, and the price paid becomes its first cost (see
//      lib/transfer.js). A whole herd moves, never part of one.
//
// Split rules (all math in whole cents, no floating point):
//   expenses  = every ACTIVE herd_expenses row for the herd (self-billed + service-billed;
//               voided costs are kept on record but do not count)
//   profit    = gross - expenses            (negative = a losing sale)
//   investor  = the money the investor actually paid in (investor_payments),
//               returned first, PLUS their token share of the profit:
//                 profit >= 0:  capital + floor(profit * tokens / total_supply)
//                 profit <  0:  capital - ceil(loss * tokens / total_supply), never below 0
//               Holdings with no recorded payment (demo data) get no capital
//               back, exactly as before this rule existed.
//   provider  = service-billed expenses (a feedyard billing the owner), paid
//               ahead of everyone else, capped at the gross price
//   owner     = whatever is left, so the payouts always add up to exactly the
//               gross price (the owner's share of the profit, plus
//               reimbursement of the costs the owner funded, plus any
//               rounding pennies and the share of unsold tokens)
//   If the investors' capital could not all be covered by the sale, their
//   payouts are reduced in proportion (never below what is left after the
//   provider is paid).
//
// Platform fees (only when the herd has fee terms - see routes/fees.js):
//   exit profit fee  floor(profit x pct) per investor, where profit is that
//                    investor's payout minus what they paid for the tokens.
//                    Charged to the investor (default) or, if the herd's
//                    exit_fee_payer is 'producer', taken out of the owner's share.
//   per-head fee     head count x rate, taken from the owner's share when the
//                    herd's per-head fee timing is 'exit'.
//   The fees go to a 'platform' payout row, so all rows still add up to the
//   gross price. A herd with no fee terms settles exactly as before.
// A sale cannot be submitted or approved while investor money raised for the
// herd has not been released (see routes/funds.js).
//
// Exit sale (plan step 7): the seller reports the actual load - head sold,
// head lost, total live weight and price per cwt (hundredweight = 100 lb) -
// and the site works the price out: weight x price / 100, in whole cents.
// A plain grossAmount (a single total) is still accepted, but then no load
// numbers are on file and the sale carries a warning. If the herd had an LRP
// policy that paid out, the seller records the payout (lrpIndemnity); it is
// added to the sale price and split like any other proceeds (the buyer's own
// purchase cost stays the sale price). An admin can correct the LRP payout
// and head lost on a pending sale, with a reason (kept in herd_sale_history).
// GET /sales/:saleId/statement is the itemized settlement statement.
//
// This records what is owed. It does not move money.

const OWNER_ROLES = ["rancher", "feedlot"];
const SALE_STATUSES = ["pending_approval", "approved", "rejected", "cancelled"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GROSS_DOLLARS = 999999999999;
const MAX_LRP_DOLLARS = 100000000;
const MAX_WEIGHT_LBS = 100000000;
const MAX_PRICE_CWT = 100000;
const MAX_HEAD = 1000000;

// Reads an optional number from a request body. Returns null when it was not
// given; throws a 400 when it was given but is not acceptable.
function optNumber(v, label, { integer = false, min = 0, minExclusive = false, max, decimals = 2 } = {}) {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number.`);
  if (integer && !Number.isInteger(n)) throw new HttpError(400, `${label} must be a whole number.`);
  if (!integer) {
    const scaled = n * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-4) {
      throw new HttpError(400, `${label} can have at most ${decimals} decimal places.`);
    }
  }
  if (minExclusive ? n <= min : n < min) {
    throw new HttpError(400, `${label} must be ${minExclusive ? "more than" : "at least"} ${min}.`);
  }
  if (max !== undefined && n > max) throw new HttpError(400, `${label} is too large.`);
  return n;
}

// The load a packer settled: head sold/lost, live weight (lb) and price per cwt.
// The price in cents = weight (lb) x price ($/cwt) / 100, rounded to the cent.
function parseLoad(body) {
  const headSold = optNumber(body.headSold, "headSold", { integer: true, min: 0, minExclusive: true, max: MAX_HEAD });
  const headLost = optNumber(body.headLost, "headLost", { integer: true, min: 0, max: MAX_HEAD });
  const weight = optNumber(body.liveWeightLbs, "liveWeightLbs", { min: 0, minExclusive: true, max: MAX_WEIGHT_LBS });
  const price = optNumber(body.pricePerCwt, "pricePerCwt", { min: 0, max: MAX_PRICE_CWT });
  if ((weight === null) !== (price === null)) {
    throw new HttpError(400, "Give liveWeightLbs and pricePerCwt together.");
  }
  if (weight !== null && headSold === null) {
    throw new HttpError(400, "headSold is required when you give the load weight and price.");
  }
  let loadCents = null;
  if (weight !== null) {
    loadCents = Number((BigInt(Math.round(weight * 100)) * BigInt(Math.round(price * 100)) + 5000n) / 10000n);
  }
  return { headSold, headLost, weight, price, loadCents };
}

function checkHeadCounts(headSold, headLost, herdHeadCount) {
  const total = (headSold ?? 0) + (headLost ?? 0);
  if (total > Number(herdHeadCount)) {
    throw new HttpError(400, `headSold + headLost (${total}) is more than the herd's head count (${herdHeadCount}).`);
  }
}

// The total split among everyone: the price the buyer pays plus any LRP payout.
const proceedsCents = (row) => toCents(row.gross_amount) + toCents(row.lrp_indemnity ?? 0);

// Columns returned for a sale. Dates come back as text so a server time zone
// can never shift the day.
const SALE_SELECT = `
  s.sale_id, s.herd_id, s.seller_user_id, s.buyer_user_id, s.buyer_name,
  s.gross_amount, s.sale_date::text AS sale_date, s.status,
  s.expenses_total, s.net_amount, s.platform_fees_total, s.fee_terms_snapshot,
  s.submitted_at, s.decided_at, s.decision_note,
  s.buyer_response, s.buyer_responded_at, s.buyer_response_note, s.new_herd_id,
  s.head_sold, s.head_lost, s.live_weight_lbs, s.price_per_cwt, s.lrp_indemnity, s.lrp_note,
  h.herd_name, h.head_count AS herd_head_count, su.slug AS seller_slug, bu.slug AS buyer_slug
`;
const SALE_FROM = `
  FROM herd_sales s
  JOIN herds h  ON h.herd_id = s.herd_id
  JOIN users su ON su.user_id = s.seller_user_id
  LEFT JOIN users bu ON bu.user_id = s.buyer_user_id
`;

function saleWarnings(r) {
  const w = [];
  if (r.live_weight_lbs == null) {
    w.push("The price was entered as a single total - no head, weight or price per cwt is on file for this sale.");
  }
  if (r.head_sold != null) {
    const counted = Number(r.head_sold) + Number(r.head_lost ?? 0);
    if (r.herd_head_count != null && counted !== Number(r.herd_head_count)) {
      w.push(`Head sold (${r.head_sold}) plus head lost (${r.head_lost ?? 0}) is ${counted}, but the herd's head count is ${r.herd_head_count}.`);
    }
  }
  return w;
}

function shapeSale(r) {
  const salePrice = Number(r.gross_amount);
  const lrp = Number(r.lrp_indemnity ?? 0);
  return {
    saleId:        r.sale_id,
    herdId:        r.herd_id,
    herdName:      r.herd_name ?? null,
    sellerUserId:  r.seller_user_id,
    sellerSlug:    r.seller_slug ?? null,
    buyerUserId:   r.buyer_user_id ?? null,
    buyerSlug:     r.buyer_slug ?? null,
    buyerName:     r.buyer_name ?? null,
    grossAmount:   salePrice,
    lrpIndemnity:  lrp,
    lrpNote:       r.lrp_note ?? null,
    proceedsTotal: dollars(toCents(salePrice) + toCents(lrp)),
    headSold:      r.head_sold != null ? Number(r.head_sold) : null,
    headLost:      r.head_lost != null ? Number(r.head_lost) : null,
    liveWeightLbs: r.live_weight_lbs != null ? Number(r.live_weight_lbs) : null,
    pricePerCwt:   r.price_per_cwt != null ? Number(r.price_per_cwt) : null,
    saleDate:      r.sale_date,
    status:        r.status,
    expensesTotal: r.expenses_total != null ? Number(r.expenses_total) : null,
    netAmount:     r.net_amount != null ? Number(r.net_amount) : null,
    platformFeesTotal: r.platform_fees_total != null ? Number(r.platform_fees_total) : null,
    feeTerms:      r.fee_terms_snapshot ?? null,
    submittedAt:   r.submitted_at,
    decidedAt:     r.decided_at ?? null,
    decisionNote:  r.decision_note ?? null,
    buyerResponse: r.buyer_response ?? "not_required",
    buyerRespondedAt: r.buyer_responded_at ?? null,
    buyerResponseNote: r.buyer_response_note ?? null,
    newHerdId:     r.new_herd_id ?? null,
    warnings:      saleWarnings(r),
  };
}

function shapeBreakdown(b) {
  return {
    grossAmount:           dollars(b.grossCents),
    salePrice:             dollars(b.grossCents - (b.lrpCents ?? 0)),
    lrpIndemnity:          dollars(b.lrpCents ?? 0),
    selfBilledExpenses:    dollars(b.selfCents),
    serviceBilledExpenses: dollars(b.serviceCents),
    expensesTotal:         dollars(b.expensesCents),
    netAmount:             dollars(b.netCents),
    profit:                dollars(b.profitCents),
    investorCapitalReturned: dollars(b.payouts.filter((p) => p.recipientType === "investor").reduce((s2, p) => s2 + (p.capitalCents ?? 0), 0)),
    totalSupply:           b.totalSupply,
    investorTokens:        b.investorTokens,
    feeTermsApplied:       b.feeTermsApplied,
    platformFeesTotal:     dollars(b.platformCents),
    warnings:              b.warnings,
    payouts: b.payouts.map((p) => ({
      recipientType:     p.recipientType,
      userId:            p.userId,
      slug:              p.slug ?? null,
      tokens:            p.tokens,
      sharePct:          p.sharePct,
      grossBeforeFees:   p.grossBeforeCents != null ? dollars(p.grossBeforeCents) : null,
      capitalReturned:   p.capitalCents != null ? dollars(p.capitalCents) : null,
      profitShare:       p.shareCents != null ? dollars(p.shareCents) : null,
      feeAmount:         dollars(p.feeCents ?? 0),
      costBasis:         p.costBasisCents != null ? dollars(p.costBasisCents) : null,
      costBasisEstimated: !!p.costEstimated,
      exitFeePct:        p.exitFeePct ?? null,
      amount:            dollars(p.cents),
    })),
  };
}

// --- the split ---------------------------------------------------------------
// Read-only. Works on any db handle (pool or a transaction client).

// The platform's own payout row goes to this account (slug from the
// PLATFORM_USER_SLUG env var, default 'admin'). Falls back to the given user.
async function resolvePlatformUserId(db, fallbackUserId) {
  const slug = String(process.env.PLATFORM_USER_SLUG || "admin").toLowerCase();
  const r = await db.query("SELECT user_id FROM users WHERE slug = $1", [slug]);
  return r.rows[0]?.user_id ?? fallbackUserId ?? null;
}

async function computeSettlement(db, { herdId, ownerId, grossCents, lrpCents = 0, platformUserId = null }) {
  const poolRes = await db.query(
    "SELECT pool_id, total_supply FROM token_pools WHERE herd_id = $1",
    [herdId]
  );
  const tokenPool = poolRes.rows[0] ?? null;
  const totalSupply = tokenPool ? BigInt(tokenPool.total_supply) : 0n;

  const holders = tokenPool
    ? (
        await db.query(
          `SELECT o.user_id, o.token_amount
             FROM ownership o
             JOIN users u ON u.user_id = o.user_id
            WHERE o.pool_id = $1 AND u.role = 'investor' AND o.token_amount > 0
            ORDER BY o.user_id`,
          [tokenPool.pool_id]
        )
      ).rows
    : [];

  const investorTokens = holders.reduce((sum, h) => sum + BigInt(h.token_amount), 0n);
  if (investorTokens > totalSupply) {
    throw new HttpError(409, "Investor token holdings exceed the pool's total supply - cannot settle.");
  }

  const expRes = await db.query(
    `SELECT billing_direction, billed_by_user_id, COALESCE(SUM(amount), 0) AS total
       FROM herd_expenses
      WHERE herd_id = $1 AND status = 'active'
      GROUP BY billing_direction, billed_by_user_id`,
    [herdId]
  );
  let selfCents = 0;
  const providers = [];
  for (const row of expRes.rows) {
    const cents = toCents(row.total);
    if (row.billing_direction === "service") {
      providers.push({ userId: row.billed_by_user_id, cents });
    } else {
      selfCents += cents;
    }
  }
  const serviceCents = providers.reduce((sum, p) => sum + p.cents, 0);
  const expensesCents = selfCents + serviceCents;
  const profitCents = grossCents - expensesCents;
  const netCents = Math.max(0, profitCents);
  const warnings = [];

  // what each investor actually paid in (returned to them first)
  const capRes = tokenPool
    ? await db.query(
        `SELECT user_id, COALESCE(SUM(amount), 0) AS paid FROM investor_payments WHERE herd_id = $1 GROUP BY user_id`,
        [herdId]
      )
    : { rows: [] };
  const capitalByUser = new Map(capRes.rows.map((r) => [r.user_id, toCents(r.paid)]));

  const providerPool = Math.min(serviceCents, grossCents);

  const investorPayouts = holders.map((h) => {
    const tokens = BigInt(h.token_amount);
    const capital = capitalByUser.get(h.user_id) ?? 0;
    const share = profitCents >= 0
      ? Number((BigInt(profitCents) * tokens) / totalSupply)
      : -Number((BigInt(-profitCents) * tokens + totalSupply - 1n) / totalSupply);
    const cents = Math.max(0, capital + share);
    return {
      recipientType: "investor",
      userId: h.user_id,
      tokens: Number(h.token_amount),
      sharePct: Number((tokens * 100000000n) / totalSupply) / 1e6,
      capitalCents: capital,
      shareCents: cents - capital,
      grossBeforeCents: cents,
      feeCents: 0,
      cents,
    };
  });

  // Investors are paid after the provider; if their claims are more than the
  // sale can cover, reduce them in proportion.
  const investorTotal = investorPayouts.reduce((sum, p) => sum + p.cents, 0);
  const room = grossCents - providerPool;
  if (investorTotal > room) {
    for (const p of investorPayouts) {
      p.cents = Number((BigInt(p.cents) * BigInt(room)) / BigInt(investorTotal));
      p.grossBeforeCents = p.cents;
      p.shareCents = p.cents - p.capitalCents;
    }
    warnings.push("The sale could not cover everything owed to investors (their money back plus profit share), so their payouts were reduced in proportion.");
  }

  const providerPayouts = providers.map((p) => ({
    recipientType: "provider",
    userId: p.userId,
    tokens: 0,
    sharePct: null,
    cents: serviceCents > 0
      ? Number((BigInt(providerPool) * BigInt(p.cents)) / BigInt(serviceCents))
      : 0,
  }));

  const paidOutCents = [...investorPayouts, ...providerPayouts].reduce((sum, p) => sum + p.cents, 0);
  const ownerCents = grossCents - paidOutCents;
  if (ownerCents < 0) {
    throw new HttpError(500, "Settlement arithmetic error - payouts exceed the sale price.");
  }
  const ownerTokens = totalSupply - investorTokens;
  const ownerPayout = {
    recipientType: "owner",
    userId: ownerId,
    tokens: Number(ownerTokens),
    sharePct: totalSupply > 0n ? Number((ownerTokens * 100000000n) / totalSupply) / 1e6 : null,
    grossBeforeCents: ownerCents,
    feeCents: 0,
    cents: ownerCents,
  };

  // --- platform fees (only when the herd has fee terms) ----------------------
  let platformCents = 0;
  let feeSnapshot = null;
  const terms = await loadHerdTerms(db, herdId);

  if (terms) {
    const herdInfo = await db.query("SELECT head_count, listing_price FROM herds WHERE herd_id = $1", [herdId]);
    const headCount = Number(herdInfo.rows[0]?.head_count ?? 0);
    const listingCents = herdInfo.rows[0]?.listing_price != null ? toCents(herdInfo.rows[0].listing_price) : 0;
    const termsBps = pctToBps(terms.exit_profit_fee_pct);
    const payer = terms.exit_fee_payer;
    const locked = !!terms.locked_at;

    // what each investor actually paid
    const paidRes = await db.query(
      `SELECT user_id, COALESCE(SUM(amount), 0) AS paid, COALESCE(SUM(tokens), 0) AS tokens
         FROM investor_payments WHERE herd_id = $1 GROUP BY user_id`,
      [herdId]
    );
    const paidByUser = new Map(paidRes.rows.map((r) => [r.user_id, r]));

    // per-investor fee overrides (a herd-specific one beats an all-herds one)
    const ovRes = investorPayouts.length
      ? await db.query(
          `SELECT investor_user_id, herd_id, exit_profit_fee_pct
             FROM investor_fee_overrides
            WHERE investor_user_id = ANY($1::uuid[]) AND (herd_id = $2 OR herd_id IS NULL)`,
          [investorPayouts.map((p) => p.userId), herdId]
        )
      : { rows: [] };
    const overrideFor = new Map();
    for (const o of ovRes.rows) {
      const cur = overrideFor.get(o.investor_user_id);
      if (!cur || (o.herd_id && !cur.herd_id)) overrideFor.set(o.investor_user_id, o);
    }

    const appliedPcts = [];
    let investorFeeTotal = 0;
    let producerExitFee = 0;

    for (const p of investorPayouts) {
      const rec = paidByUser.get(p.userId);
      const recordedCents = rec ? toCents(rec.paid) : 0;
      const recordedTokens = rec ? Number(rec.tokens) : 0;
      const unrecorded = Math.max(0, p.tokens - recordedTokens);
      let costCents = recordedCents;
      let costEstimated = false;
      if (unrecorded > 0) {
        costEstimated = true;
        if (listingCents > 0 && totalSupply > 0n) {
          costCents += Number((BigInt(unrecorded) * BigInt(listingCents)) / totalSupply);
        } else {
          // no price to estimate from: treat as no profit, so no fee
          costCents = p.grossBeforeCents;
        }
      }

      let pct = Number(terms.exit_profit_fee_pct);
      let source = "terms";
      const ov = overrideFor.get(p.userId);
      if (ov) {
        pct = Number(ov.exit_profit_fee_pct);
        source = ov.herd_id ? "override (this herd)" : "override (all herds)";
      }
      // once terms are locked, an override can never charge more than the terms
      if (locked && pct > Number(terms.exit_profit_fee_pct)) {
        pct = Number(terms.exit_profit_fee_pct);
        source = "terms (override capped)";
      }

      const profitCents = Math.max(0, p.grossBeforeCents - costCents);
      const feeCents = feeOnCents(profitCents, pctToBps(pct));
      p.costBasisCents = costCents;
      p.costEstimated = costEstimated;
      p.exitFeePct = pct;
      appliedPcts.push({ userId: p.userId, pct, source, profitCents, feeCents });
      if (payer === "investor") {
        p.feeCents = feeCents;
        p.cents = p.grossBeforeCents - feeCents;
        investorFeeTotal += feeCents;
      } else {
        producerExitFee += feeCents;
      }
      if (costEstimated) {
        warnings.push("An investor's cost basis is estimated from the listing price because their payment was not recorded.");
      }
    }

    // per-head fee taken out of the sale proceeds
    let perHeadExit = 0;
    const perHeadRate = toCents(terms.per_head_fee);
    if (terms.per_head_fee_timing === "exit" && perHeadRate > 0) {
      if (headCount > 0) {
        perHeadExit = headCount * perHeadRate;
      } else {
        warnings.push("The herd has no head count, so the per-head exit fee could not be calculated.");
      }
    }

    const ownerFeeWanted = producerExitFee + perHeadExit;
    const ownerFeeTaken = Math.min(ownerFeeWanted, ownerPayout.cents);
    if (ownerFeeTaken < ownerFeeWanted) {
      warnings.push("The producer's fees were more than the producer is owed from this sale, so they were capped.");
    }
    ownerPayout.feeCents = ownerFeeTaken;
    ownerPayout.cents = ownerPayout.grossBeforeCents - ownerFeeTaken;

    platformCents = investorFeeTotal + ownerFeeTaken;
    feeSnapshot = {
      raiseFeePct: Number(terms.raise_fee_pct),
      exitProfitFeePct: Number(terms.exit_profit_fee_pct),
      exitFeePayer: payer,
      perHeadFee: Number(terms.per_head_fee),
      perHeadFeeTiming: terms.per_head_fee_timing,
      headCount,
      termsLocked: locked,
      perHeadExitFee: dollars(perHeadExit),
      investorFees: appliedPcts.map((a) => ({
        userId: a.userId, exitFeePct: a.pct, source: a.source,
        profit: dollars(a.profitCents), fee: dollars(a.feeCents),
      })),
    };
  }

  const payouts = [ownerPayout, ...investorPayouts, ...providerPayouts];
  if (platformCents > 0) {
    payouts.push({
      recipientType: "platform",
      userId: platformUserId,
      tokens: 0,
      sharePct: null,
      cents: platformCents,
    });
  }

  const ids = [...new Set(payouts.map((p) => p.userId).filter(Boolean))];
  const slugRes = await db.query("SELECT user_id, slug FROM users WHERE user_id = ANY($1::uuid[])", [ids]);
  const slugById = new Map(slugRes.rows.map((r) => [r.user_id, r.slug]));
  for (const p of payouts) p.slug = slugById.get(p.userId) ?? null;
  if (feeSnapshot) {
    for (const f of feeSnapshot.investorFees) f.slug = slugById.get(f.userId) ?? null;
  }

  return {
    grossCents, lrpCents, selfCents, serviceCents, expensesCents, netCents, profitCents,
    totalSupply: Number(totalSupply),
    investorTokens: Number(investorTokens),
    feeTermsApplied: !!terms,
    platformCents,
    warnings: [...new Set(warnings)],
    feeSnapshot,
    payouts,
  };
}

// --- POST /api/settlement/herds/:herdId/sale ---------------------------------
// Owner submits a sale. Body:
//   the price, either the load  { headSold, headLost?, liveWeightLbs, pricePerCwt }
//                    or a total { grossAmount }   (if both are given they must agree)
//   optional                    { lrpIndemnity?, lrpNote?, saleDate? }
//   the buyer                   { buyerSlug? | buyerName? } - at least one
// buyerSlug = a producer account on the platform; buyerName = an outside buyer
// (packer, etc.).
router.post("/herds/:herdId/sale", requireAuth, requireRole(...OWNER_ROLES), async (req, res) => {
  const { herdId } = req.params;
  const sellerId = req.user.userId;
  const body = req.body ?? {};

  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });

  let load;
  let lrpDollars;
  try {
    load = parseLoad(body);
    lrpDollars = optNumber(body.lrpIndemnity, "lrpIndemnity", { min: 0, max: MAX_LRP_DOLLARS }) ?? 0;
  } catch (err) {
    return sendError(res, "POST /api/settlement/herds/:herdId/sale", err);
  }
  const lrpCents = toCents(lrpDollars);
  const lrpNote = body.lrpNote ? String(body.lrpNote).trim().slice(0, 255) : null;

  const grossRaw = body.grossAmount;
  const hasGross = !(grossRaw === undefined || grossRaw === null || grossRaw === "");
  const gross = Number(grossRaw);
  if (hasGross && (!Number.isFinite(gross) || gross < 0)) {
    return res.status(400).json({ error: "grossAmount must be a number of 0 or more." });
  }
  if (hasGross && gross > MAX_GROSS_DOLLARS) return res.status(400).json({ error: "grossAmount is too large." });
  let grossCents;
  if (load.loadCents !== null) {
    if (hasGross && Math.abs(toCents(gross) - load.loadCents) > 1) {
      return res.status(400).json({
        error: `grossAmount ($${money(toCents(gross))}) does not match the load: weight x price = $${money(load.loadCents)}. ` +
          "Send only the load numbers, or correct one of them.",
      });
    }
    grossCents = load.loadCents;
  } else if (hasGross) {
    grossCents = toCents(gross);
  } else {
    return res.status(400).json({
      error: "Give the load (headSold, liveWeightLbs, pricePerCwt) or a grossAmount.",
    });
  }
  if (grossCents / 100 > MAX_GROSS_DOLLARS) return res.status(400).json({ error: "The sale price is too large." });

  let saleDate = null;
  if (body.saleDate !== undefined && body.saleDate !== null && body.saleDate !== "") {
    const s = String(body.saleDate);
    if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) {
      return res.status(400).json({ error: "saleDate must look like 2026-10-15." });
    }
    saleDate = s;
  }

  const buyerSlug = body.buyerSlug ? String(body.buyerSlug).trim().toLowerCase() : null;
  const buyerName = body.buyerName ? String(body.buyerName).trim().slice(0, 160) : null;
  if (!buyerSlug && !buyerName) {
    return res.status(400).json({ error: "Provide buyerSlug (a platform producer) or buyerName (an outside buyer)." });
  }

  try {
    const out = await withTransaction(async (client) => {
      const herdRes = await client.query(
        "SELECT herd_id, rancher_id, feedlot_status, head_count FROM herds WHERE herd_id = $1 FOR UPDATE",
        [herdId]
      );
      if (herdRes.rowCount === 0) throw new HttpError(404, "Herd not found.");
      const herd = herdRes.rows[0];
      if (herd.rancher_id !== sellerId) throw new HttpError(403, "You are not allowed to sell this herd.");
      if (herd.feedlot_status === "sold") {
        throw new HttpError(409, "This herd is already sold or has a sale in progress.");
      }
      checkHeadCounts(load.headSold, load.headLost, herd.head_count);
      if (lrpCents > 0) {
        const pol = await client.query("SELECT 1 FROM herd_lrp_policies WHERE herd_id = $1 LIMIT 1", [herdId]);
        if (pol.rowCount === 0) {
          throw new HttpError(400, "An LRP payout can only be recorded on a herd that has an LRP policy on file (POST /api/lrp/herds/:herdId).");
        }
      }
      const funds = await getFundsPosition(client, herdId);
      if (funds.availableCents > 0) {
        throw new HttpError(
          409,
          `Investor money raised for this herd ($${money(funds.availableCents)}) has not been released yet. ` +
            "Ask CattleCoin to release it before submitting a sale."
        );
      }

      let buyerUserId = null;
      if (buyerSlug) {
        const b = await client.query("SELECT user_id, role FROM users WHERE slug = $1", [buyerSlug]);
        if (b.rowCount === 0) throw new HttpError(400, `Buyer not found: ${buyerSlug}`);
        if (!OWNER_ROLES.includes(b.rows[0].role)) {
          throw new HttpError(400, "Buyer must be a producer account (rancher or feedlot).");
        }
        if (b.rows[0].user_id === sellerId) throw new HttpError(400, "Buyer cannot be the seller.");
        if (load.headSold !== null && load.headSold < 20) {
          throw new HttpError(400, "A herd handed to a platform buyer needs at least 20 head sold.");
        }
        buyerUserId = b.rows[0].user_id;
      }

      let saleRow;
      try {
        const ins = await client.query(
          `INSERT INTO herd_sales
             (herd_id, seller_user_id, buyer_user_id, buyer_name, gross_amount, sale_date, prior_feedlot_status, buyer_response,
              head_sold, head_lost, live_weight_lbs, price_per_cwt, lrp_indemnity, lrp_note)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING sale_id`,
          [herdId, sellerId, buyerUserId, buyerName, money(grossCents), saleDate, herd.feedlot_status ?? "pending",
           buyerUserId ? "waiting" : "not_required",
           load.headSold, load.headLost, load.weight, load.price, money(lrpCents), lrpNote]
        );
        saleRow = ins.rows[0];
      } catch (err) {
        if (err.code === "23505") {
          throw new HttpError(409, "This herd is already sold or has a sale in progress.");
        }
        throw err;
      }

      // Close the herd to new investors right away, so the holdings the split
      // is computed from cannot change while the sale is being reviewed.
      await client.query(
        "UPDATE herds SET feedlot_status = 'sold', last_updated = NOW() WHERE herd_id = $1",
        [herdId]
      );

      const platformUserId = await resolvePlatformUserId(client, null);
      const breakdown = await computeSettlement(client, {
        herdId, ownerId: sellerId, grossCents: grossCents + lrpCents, lrpCents, platformUserId,
      });
      const saleFull = await client.query(`SELECT ${SALE_SELECT} ${SALE_FROM} WHERE s.sale_id = $1`, [saleRow.sale_id]);
      return { sale: saleFull.rows[0], breakdown };
    });

    return res.status(201).json({
      message: buyerSlug
        ? "Sale submitted. The buyer must accept it, then an admin approves it. The herd is now closed to new investors."
        : "Sale submitted for admin approval. The herd is now closed to new investors.",
      sale: shapeSale(out.sale),
      preview: shapeBreakdown(out.breakdown),
    });
  } catch (err) {
    return sendError(res, "POST /api/settlement/herds/:herdId/sale", err);
  }
});

// --- GET /api/settlement/sales -----------------------------------------------
// Admin: every sale (optional ?status=). Anyone else: sales they sold or bought.
router.get("/sales", requireAuth, async (req, res) => {
  try {
    const params = [];
    const where = [];

    if (req.user.role === "admin") {
      if (req.query.status) {
        if (!SALE_STATUSES.includes(req.query.status)) {
          return res.status(400).json({ error: `status must be one of: ${SALE_STATUSES.join(", ")}` });
        }
        params.push(req.query.status);
        where.push(`s.status = $${params.length}`);
      }
    } else {
      params.push(req.user.userId);
      where.push(`(s.seller_user_id = $${params.length} OR s.buyer_user_id = $${params.length})`);
    }

    const result = await pool.query(
      `SELECT ${SALE_SELECT} ${SALE_FROM}
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY s.submitted_at DESC`,
      params
    );
    return res.json(result.rows.map(shapeSale));
  } catch (err) {
    return sendError(res, "GET /api/settlement/sales", err);
  }
});

// --- GET /api/settlement/sales/:saleId ---------------------------------------
// Admin, the seller, or the platform buyer. Pending sales include a live
// preview of the split; approved sales include the frozen payout rows.
router.get("/sales/:saleId", requireAuth, async (req, res) => {
  const { saleId } = req.params;
  if (!isUuid(saleId)) return res.status(400).json({ error: "Invalid saleId." });

  try {
    const result = await pool.query(`SELECT ${SALE_SELECT} ${SALE_FROM} WHERE s.sale_id = $1`, [saleId]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Sale not found." });
    const row = result.rows[0];

    const allowed =
      req.user.role === "admin" ||
      row.seller_user_id === req.user.userId ||
      row.buyer_user_id === req.user.userId;
    if (!allowed) return res.status(403).json({ error: "You are not allowed to view this sale." });

    const out = { sale: shapeSale(row) };

    if (row.status === "pending_approval") {
      const breakdown = await computeSettlement(pool, {
        herdId: row.herd_id,
        ownerId: row.seller_user_id,
        grossCents: proceedsCents(row),
        lrpCents: toCents(row.lrp_indemnity),
        platformUserId: await resolvePlatformUserId(pool, null),
      });
      out.preview = shapeBreakdown(breakdown);
    } else if (row.status === "approved") {
      const payouts = await pool.query(
        `SELECT p.payout_id, p.user_id, u.slug, p.recipient_type, p.tokens_held, p.share_pct,
                p.gross_before_fees, p.fee_amount, p.cost_basis,
                p.amount, p.status, p.paid_at, p.payment_reference
           FROM herd_payouts p
           JOIN users u ON u.user_id = p.user_id
          WHERE p.sale_id = $1
          ORDER BY p.recipient_type, u.slug`,
        [saleId]
      );
      out.payouts = payouts.rows.map((p) => ({
        payoutId:         p.payout_id,
        userId:           p.user_id,
        slug:             p.slug,
        recipientType:    p.recipient_type,
        tokens:           Number(p.tokens_held),
        sharePct:         p.share_pct != null ? Number(p.share_pct) : null,
        grossBeforeFees:  p.gross_before_fees != null ? Number(p.gross_before_fees) : null,
        feeAmount:        Number(p.fee_amount),
        costBasis:        p.cost_basis != null ? Number(p.cost_basis) : null,
        amount:           Number(p.amount),
        status:           p.status,
        paidAt:           p.paid_at,
        paymentReference: p.payment_reference,
      }));
    }

    if (req.user.role === "admin" || row.seller_user_id === req.user.userId) {
      const hist = await pool.query(
        `SELECT h.action, h.reason, h.before_data, h.after_data, h.created_at, u.slug AS changed_by
           FROM herd_sale_history h LEFT JOIN users u ON u.user_id = h.changed_by
          WHERE h.sale_id = $1 ORDER BY h.created_at, h.history_id`,
        [saleId]
      );
      out.corrections = hist.rows.map((h) => ({
        action: h.action, reason: h.reason, before: h.before_data, after: h.after_data,
        changedBy: h.changed_by, at: h.created_at,
      }));
    }

    return res.json(out);
  } catch (err) {
    return sendError(res, "GET /api/settlement/sales/:saleId", err);
  }
});

// --- POST /api/settlement/sales/:saleId/approve ------------------------------
// Admin only. Recomputes the split, freezes it, creates the payout rows.
// Body: { note? }
router.post("/sales/:saleId/approve", requireAuth, requireRole("admin"), async (req, res) => {
  const { saleId } = req.params;
  const adminId = req.user.userId;
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 255) : null;
  if (!isUuid(saleId)) return res.status(400).json({ error: "Invalid saleId." });

  try {
    const out = await withTransaction(async (client) => {
      const saleRes = await client.query(
        "SELECT sale_id, herd_id, seller_user_id, buyer_user_id, buyer_response, gross_amount, lrp_indemnity, status FROM herd_sales WHERE sale_id = $1 FOR UPDATE",
        [saleId]
      );
      if (saleRes.rowCount === 0) throw new HttpError(404, "Sale not found.");
      const sale = saleRes.rows[0];
      if (sale.status !== "pending_approval") throw new HttpError(409, `Sale is already ${sale.status}.`);
      if (sale.buyer_user_id && sale.buyer_response !== "accepted") {
        throw new HttpError(409, "The buyer has not accepted this sale yet. It cannot be approved until they do.");
      }

      const herdRes = await client.query(
        "SELECT herd_id, rancher_id FROM herds WHERE herd_id = $1 FOR UPDATE",
        [sale.herd_id]
      );
      if (herdRes.rowCount === 0 || herdRes.rows[0].rancher_id !== sale.seller_user_id) {
        throw new HttpError(409, "Herd ownership changed since the sale was submitted.");
      }

      const funds = await getFundsPosition(client, sale.herd_id);
      if (funds.availableCents > 0) {
        throw new HttpError(
          409,
          `Investor money raised for this herd ($${money(funds.availableCents)}) has not been released. ` +
            "Reject this sale, release the money, and have the seller resubmit."
        );
      }

      const breakdown = await computeSettlement(client, {
        herdId: sale.herd_id,
        ownerId: sale.seller_user_id,
        grossCents: proceedsCents(sale),
        lrpCents: toCents(sale.lrp_indemnity),
        platformUserId: await resolvePlatformUserId(client, adminId),
      });

      for (const p of breakdown.payouts) {
        const isPlatform = p.recipientType === "platform";
        const noneDue = p.cents === 0;
        const settled = isPlatform || noneDue; // the platform's fee is retained, nothing to pay out
        await client.query(
          `INSERT INTO herd_payouts
             (sale_id, user_id, recipient_type, tokens_held, share_pct, amount,
              gross_before_fees, fee_amount, cost_basis,
              status, paid_at, paid_by_user_id, payment_reference, capital_returned)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            saleId, p.userId, p.recipientType, p.tokens, p.sharePct, money(p.cents),
            p.grossBeforeCents != null ? money(p.grossBeforeCents) : null,
            money(p.feeCents ?? 0),
            p.costBasisCents != null ? money(p.costBasisCents) : null,
            settled ? "paid" : "owed",
            settled ? new Date() : null,
            settled ? adminId : null,
            isPlatform ? "Fee retained by platform" : noneDue ? "No payout due" : null,
            money(p.capitalCents ?? 0),
          ]
        );
      }

      await client.query(
        `UPDATE herd_sales
            SET status = 'approved', expenses_total = $2, net_amount = $3,
                decided_by_user_id = $4, decided_at = NOW(), decision_note = $5,
                platform_fees_total = $6, fee_terms_snapshot = $7
          WHERE sale_id = $1`,
        [
          saleId, money(breakdown.expensesCents), money(breakdown.netCents), adminId, note,
          breakdown.feeTermsApplied ? money(breakdown.platformCents) : null,
          breakdown.feeSnapshot ? JSON.stringify(breakdown.feeSnapshot) : null,
        ]
      );

      // Platform buyer: hand the herd over (new herd, animals, purchase cost).
      const transfer = await transferHerdToBuyer(client, saleId);

      const saleFull = await client.query(`SELECT ${SALE_SELECT} ${SALE_FROM} WHERE s.sale_id = $1`, [saleId]);
      return { sale: saleFull.rows[0], breakdown, transfer };
    });

    return res.json({
      message: out.transfer
        ? "Sale approved and the herd has been handed over to the buyer. Payouts are recorded as owed - no money has moved."
        : "Sale approved. Payouts are recorded as owed - no money has moved.",
      sale: shapeSale(out.sale),
      settlement: shapeBreakdown(out.breakdown),
      transfer: out.transfer,
    });
  } catch (err) {
    return sendError(res, "POST /api/settlement/sales/:saleId/approve", err);
  }
});

// Shared by reject (admin) and cancel (seller): close a PENDING sale and put
// the herd back to the status it had before the sale was submitted.
async function closePendingSale({ saleId, newStatus, actorId, note, onlySeller, onlyBuyer = false }) {
  return withTransaction(async (client) => {
    const saleRes = await client.query(
      "SELECT sale_id, herd_id, seller_user_id, buyer_user_id, status, prior_feedlot_status FROM herd_sales WHERE sale_id = $1 FOR UPDATE",
      [saleId]
    );
    if (saleRes.rowCount === 0) throw new HttpError(404, "Sale not found.");
    const sale = saleRes.rows[0];
    if (onlySeller && sale.seller_user_id !== actorId) {
      throw new HttpError(403, "Only the seller can cancel this sale.");
    }
    if (onlyBuyer && sale.buyer_user_id !== actorId) {
      throw new HttpError(403, "Only the buyer named on this sale can decline it.");
    }
    if (sale.status !== "pending_approval") throw new HttpError(409, `Sale is already ${sale.status}.`);

    await client.query("SELECT herd_id FROM herds WHERE herd_id = $1 FOR UPDATE", [sale.herd_id]);
    await client.query(
      "UPDATE herds SET feedlot_status = $2, last_updated = NOW() WHERE herd_id = $1 AND feedlot_status = 'sold'",
      [sale.herd_id, sale.prior_feedlot_status]
    );
    await client.query(
      `UPDATE herd_sales
          SET status = $2, decided_by_user_id = $3, decided_at = NOW(), decision_note = $4
        WHERE sale_id = $1`,
      [saleId, newStatus, actorId, note]
    );
    if (onlyBuyer) {
      await client.query(
        "UPDATE herd_sales SET buyer_response = 'declined', buyer_responded_at = NOW(), buyer_response_note = $2 WHERE sale_id = $1",
        [saleId, note]
      );
    }

    const saleFull = await client.query(`SELECT ${SALE_SELECT} ${SALE_FROM} WHERE s.sale_id = $1`, [saleId]);
    return saleFull.rows[0];
  });
}

// --- POST /api/settlement/sales/:saleId/reject -------------------------------
router.post("/sales/:saleId/reject", requireAuth, requireRole("admin"), async (req, res) => {
  const { saleId } = req.params;
  if (!isUuid(saleId)) return res.status(400).json({ error: "Invalid saleId." });
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 255) : null;
  try {
    const row = await closePendingSale({ saleId, newStatus: "rejected", actorId: req.user.userId, note, onlySeller: false });
    return res.json({ message: "Sale rejected. The herd is back to its previous status.", sale: shapeSale(row) });
  } catch (err) {
    return sendError(res, "POST /api/settlement/sales/:saleId/reject", err);
  }
});

// --- POST /api/settlement/sales/:saleId/cancel -------------------------------
router.post("/sales/:saleId/cancel", requireAuth, requireRole(...OWNER_ROLES), async (req, res) => {
  const { saleId } = req.params;
  if (!isUuid(saleId)) return res.status(400).json({ error: "Invalid saleId." });
  try {
    const row = await closePendingSale({ saleId, newStatus: "cancelled", actorId: req.user.userId, note: null, onlySeller: true });
    return res.json({ message: "Sale cancelled. The herd is back to its previous status.", sale: shapeSale(row) });
  } catch (err) {
    return sendError(res, "POST /api/settlement/sales/:saleId/cancel", err);
  }
});

// --- POST /api/settlement/sales/:saleId/accept ------------------------------
// The platform buyer named on the sale says yes. Body: { note? }
router.post("/sales/:saleId/accept", requireAuth, requireRole(...OWNER_ROLES), async (req, res) => {
  const { saleId } = req.params;
  if (!isUuid(saleId)) return res.status(400).json({ error: "Invalid saleId." });
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 255) : null;
  try {
    const row = await withTransaction(async (client) => {
      const saleRes = await client.query(
        "SELECT sale_id, buyer_user_id, buyer_response, status FROM herd_sales WHERE sale_id = $1 FOR UPDATE",
        [saleId]
      );
      if (saleRes.rowCount === 0) throw new HttpError(404, "Sale not found.");
      const sale = saleRes.rows[0];
      if (sale.buyer_user_id !== req.user.userId) {
        throw new HttpError(403, "Only the buyer named on this sale can accept it.");
      }
      if (sale.status !== "pending_approval") throw new HttpError(409, `Sale is already ${sale.status}.`);
      if (sale.buyer_response === "accepted") throw new HttpError(409, "You have already accepted this sale.");
      await client.query(
        "UPDATE herd_sales SET buyer_response = 'accepted', buyer_responded_at = NOW(), buyer_response_note = $2 WHERE sale_id = $1",
        [saleId, note]
      );
      const full = await client.query(`SELECT ${SALE_SELECT} ${SALE_FROM} WHERE s.sale_id = $1`, [saleId]);
      return full.rows[0];
    });
    return res.json({
      message: "You accepted this sale. It now waits for admin approval; the herd moves to your account when it is approved.",
      sale: shapeSale(row),
    });
  } catch (err) {
    return sendError(res, "POST /api/settlement/sales/:saleId/accept", err);
  }
});

// --- POST /api/settlement/sales/:saleId/decline ------------------------------
// The platform buyer says no. This closes the sale and the herd goes back to
// the status it had before. Body: { note? }
router.post("/sales/:saleId/decline", requireAuth, requireRole(...OWNER_ROLES), async (req, res) => {
  const { saleId } = req.params;
  if (!isUuid(saleId)) return res.status(400).json({ error: "Invalid saleId." });
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 255) : null;
  try {
    const row = await closePendingSale({
      saleId, newStatus: "rejected", actorId: req.user.userId,
      note: note ?? "Declined by the buyer.", onlySeller: false, onlyBuyer: true,
    });
    return res.json({ message: "You declined this sale. The herd is back to its previous status.", sale: shapeSale(row) });
  } catch (err) {
    return sendError(res, "POST /api/settlement/sales/:saleId/decline", err);
  }
});

// --- POST /api/settlement/sales/:saleId/correct ------------------------------
// Admin only, PENDING sales only. Fixes the things that do not change what the
// buyer pays: the LRP payout, its note, and head lost. (To change the price
// or the load, the seller cancels and submits again.) A reason is required and
// every correction is kept in herd_sale_history.
// Body: { reason, lrpIndemnity?, lrpNote?, headLost? }
router.post("/sales/:saleId/correct", requireAuth, requireRole("admin"), async (req, res) => {
  const { saleId } = req.params;
  const adminId = req.user.userId;
  const body = req.body ?? {};
  if (!isUuid(saleId)) return res.status(400).json({ error: "Invalid saleId." });
  const reason = body.reason ? String(body.reason).trim().slice(0, 255) : "";
  if (!reason) return res.status(400).json({ error: "reason is required for a correction." });

  let lrpDollars;
  let headLost;
  try {
    lrpDollars = optNumber(body.lrpIndemnity, "lrpIndemnity", { min: 0, max: MAX_LRP_DOLLARS });
    headLost = optNumber(body.headLost, "headLost", { integer: true, min: 0, max: MAX_HEAD });
  } catch (err) {
    return sendError(res, "POST /api/settlement/sales/:saleId/correct", err);
  }
  const noteGiven = body.lrpNote !== undefined;
  if (lrpDollars === null && headLost === null && !noteGiven) {
    return res.status(400).json({ error: "Give at least one of lrpIndemnity, lrpNote or headLost to correct." });
  }

  try {
    const out = await withTransaction(async (client) => {
      const saleRes = await client.query(
        `SELECT sale_id, herd_id, seller_user_id, status, gross_amount, head_sold, head_lost, lrp_indemnity, lrp_note
           FROM herd_sales WHERE sale_id = $1 FOR UPDATE`,
        [saleId]
      );
      if (saleRes.rowCount === 0) throw new HttpError(404, "Sale not found.");
      const sale = saleRes.rows[0];
      if (sale.status !== "pending_approval") {
        throw new HttpError(409, `Sale is already ${sale.status}. Only a pending sale can be corrected.`);
      }
      const herdRes = await client.query("SELECT head_count FROM herds WHERE herd_id = $1 FOR UPDATE", [sale.herd_id]);

      const newLrpCents = lrpDollars !== null ? toCents(lrpDollars) : toCents(sale.lrp_indemnity);
      const newHeadLost = headLost !== null ? headLost : sale.head_lost;
      const newNote = noteGiven ? (body.lrpNote ? String(body.lrpNote).trim().slice(0, 255) : null) : sale.lrp_note;
      checkHeadCounts(sale.head_sold, newHeadLost, herdRes.rows[0].head_count);
      if (newLrpCents > 0) {
        const pol = await client.query("SELECT 1 FROM herd_lrp_policies WHERE herd_id = $1 LIMIT 1", [sale.herd_id]);
        if (pol.rowCount === 0) {
          throw new HttpError(400, "An LRP payout can only be recorded on a herd that has an LRP policy on file.");
        }
      }

      const before = {
        lrpIndemnity: Number(sale.lrp_indemnity), lrpNote: sale.lrp_note ?? null,
        headLost: sale.head_lost != null ? Number(sale.head_lost) : null,
      };
      const after = { lrpIndemnity: dollars(newLrpCents), lrpNote: newNote ?? null, headLost: newHeadLost ?? null };
      if (JSON.stringify(before) === JSON.stringify(after)) {
        throw new HttpError(400, "That is what the sale already says - nothing to change.");
      }

      await client.query(
        "UPDATE herd_sales SET lrp_indemnity = $2, lrp_note = $3, head_lost = $4 WHERE sale_id = $1",
        [saleId, money(newLrpCents), newNote, newHeadLost]
      );
      await client.query(
        `INSERT INTO herd_sale_history (sale_id, action, changed_by, reason, before_data, after_data)
         VALUES ($1, 'correct', $2, $3, $4::jsonb, $5::jsonb)`,
        [saleId, adminId, reason, JSON.stringify(before), JSON.stringify(after)]
      );

      const breakdown = await computeSettlement(client, {
        herdId: sale.herd_id,
        ownerId: sale.seller_user_id,
        grossCents: toCents(sale.gross_amount) + newLrpCents,
        lrpCents: newLrpCents,
        platformUserId: await resolvePlatformUserId(client, adminId),
      });
      const saleFull = await client.query(`SELECT ${SALE_SELECT} ${SALE_FROM} WHERE s.sale_id = $1`, [saleId]);
      return { sale: saleFull.rows[0], breakdown };
    });
    return res.json({
      message: "Sale corrected. The correction and your reason are on record.",
      sale: shapeSale(out.sale),
      preview: shapeBreakdown(out.breakdown),
    });
  } catch (err) {
    return sendError(res, "POST /api/settlement/sales/:saleId/correct", err);
  }
});

// --- settlement statement ----------------------------------------------------
// What one investor paid for their tokens: recorded payments, plus an estimate
// (tokens x listing price / supply) for any tokens with no recorded payment.
async function investorCostBasis(db, { herdId, userId, tokens, totalSupply, listingCents }) {
  const rec = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid, COALESCE(SUM(tokens), 0) AS tokens
       FROM investor_payments WHERE herd_id = $1 AND user_id = $2`,
    [herdId, userId]
  );
  let cents = toCents(rec.rows[0].paid);
  const unrecorded = Math.max(0, Number(tokens) - Number(rec.rows[0].tokens));
  if (unrecorded === 0) return { cents, estimated: false };
  if (listingCents > 0 && totalSupply > 0n) {
    cents += Number((BigInt(unrecorded) * BigInt(listingCents)) / totalSupply);
    return { cents, estimated: true };
  }
  return { cents: null, estimated: true };
}

async function investorHasStake(db, herdId, userId, saleId) {
  const r = await db.query(
    `SELECT 1 FROM ownership o JOIN token_pools tp ON tp.pool_id = o.pool_id
      WHERE tp.herd_id = $1 AND o.user_id = $2 AND o.token_amount > 0
     UNION ALL SELECT 1 FROM investor_payments WHERE herd_id = $1 AND user_id = $2
     UNION ALL SELECT 1 FROM herd_payouts WHERE sale_id = $3 AND user_id = $2 AND recipient_type = 'investor'`,
    [herdId, userId, saleId]
  );
  return r.rowCount > 0;
}

// --- GET /api/settlement/sales/:saleId/statement -----------------------------
// The itemized settlement statement for a sale: proceeds (price + LRP payout),
// the load, every cost by category, fees, and the split. Admin and the seller
// see everyone's line; an investor in the herd sees the sale, the costs and
// ONLY their own line, with profit or loss against what they paid.
// A pending sale gives a preview (status "preview"); an approved one the final
// numbers. Rejected and cancelled sales have no statement.
router.get("/sales/:saleId/statement", requireAuth, async (req, res) => {
  const { saleId } = req.params;
  if (!isUuid(saleId)) return res.status(400).json({ error: "Invalid saleId." });

  try {
    const result = await pool.query(`SELECT ${SALE_SELECT} ${SALE_FROM} WHERE s.sale_id = $1`, [saleId]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Sale not found." });
    const row = result.rows[0];
    const userId = req.user.userId;

    let view = null;
    if (req.user.role === "admin" || row.seller_user_id === userId) view = "full";
    else if (req.user.role === "investor" && (await investorHasStake(pool, row.herd_id, userId, saleId))) view = "investor";
    if (!view) return res.status(403).json({ error: "You are not allowed to view this statement." });

    if (row.status !== "pending_approval" && row.status !== "approved") {
      return res.status(409).json({ error: `There is no statement for a sale that was ${row.status}.` });
    }
    const final = row.status === "approved";
    const proceeds = proceedsCents(row);

    const poolRes = await pool.query("SELECT total_supply FROM token_pools WHERE herd_id = $1", [row.herd_id]);
    const totalSupply = poolRes.rows[0] ? BigInt(poolRes.rows[0].total_supply) : 0n;
    const herdRes = await pool.query("SELECT listing_price FROM herds WHERE herd_id = $1", [row.herd_id]);
    const listingCents = herdRes.rows[0]?.listing_price != null ? toCents(herdRes.rows[0].listing_price) : 0;

    // costs (frozen once the sale is approved)
    const costRes = await pool.query(
      `SELECT category, billing_direction, COALESCE(SUM(amount), 0) AS total
         FROM herd_expenses WHERE herd_id = $1 AND status = 'active'
        GROUP BY category, billing_direction ORDER BY category`,
      [row.herd_id]
    );
    const byCat = new Map();
    let selfCents = 0;
    let serviceCents = 0;
    for (const c of costRes.rows) {
      const cents = toCents(c.total);
      byCat.set(c.category, (byCat.get(c.category) ?? 0) + cents);
      if (c.billing_direction === "service") serviceCents += cents; else selfCents += cents;
    }

    // the split
    let lines;
    let netCents;
    let feesTotalCents;
    let feeTerms;
    let warnings = [];
    if (final) {
      const pr = await pool.query(
        `SELECT p.user_id, u.slug, p.recipient_type, p.tokens_held, p.share_pct, p.gross_before_fees, p.fee_amount,
                p.capital_returned, p.amount, p.status, p.paid_at, p.payment_reference
           FROM herd_payouts p JOIN users u ON u.user_id = p.user_id
          WHERE p.sale_id = $1 ORDER BY p.recipient_type, u.slug`,
        [saleId]
      );
      lines = pr.rows.map((p) => ({
        recipientType: p.recipient_type, userId: p.user_id, slug: p.slug,
        tokens: Number(p.tokens_held), sharePct: p.share_pct != null ? Number(p.share_pct) : null,
        grossBeforeFees: p.gross_before_fees != null ? Number(p.gross_before_fees) : null,
        capitalReturned: p.recipient_type === "investor" ? Number(p.capital_returned) : null,
        profitShare: p.recipient_type === "investor" && p.gross_before_fees != null
          ? dollars(toCents(p.gross_before_fees) - toCents(p.capital_returned)) : null,
        feeAmount: Number(p.fee_amount), amountCents: toCents(p.amount),
        status: p.status, paidAt: p.paid_at, paymentReference: p.payment_reference,
      }));
      netCents = toCents(row.net_amount);
      feesTotalCents = row.platform_fees_total != null ? toCents(row.platform_fees_total) : 0;
      feeTerms = row.fee_terms_snapshot ?? null;
    } else {
      const b = await computeSettlement(pool, {
        herdId: row.herd_id, ownerId: row.seller_user_id, grossCents: proceeds,
        lrpCents: toCents(row.lrp_indemnity), platformUserId: await resolvePlatformUserId(pool, null),
      });
      lines = b.payouts.map((p) => ({
        recipientType: p.recipientType, userId: p.userId, slug: p.slug ?? null,
        tokens: p.tokens, sharePct: p.sharePct,
        grossBeforeFees: p.grossBeforeCents != null ? dollars(p.grossBeforeCents) : null,
        capitalReturned: p.capitalCents != null ? dollars(p.capitalCents) : null,
        profitShare: p.shareCents != null ? dollars(p.shareCents) : null,
        feeAmount: dollars(p.feeCents ?? 0), amountCents: p.cents,
        status: "not yet approved", paidAt: null, paymentReference: null,
      }));
      netCents = b.netCents;
      feesTotalCents = b.feeTermsApplied ? b.platformCents : 0;
      feeTerms = b.feeSnapshot ?? null;
      warnings = b.warnings;
    }

    // profit or loss for each investor line
    for (const l of lines) {
      if (l.recipientType !== "investor") continue;
      const basis = await investorCostBasis(pool, {
        herdId: row.herd_id, userId: l.userId, tokens: l.tokens, totalSupply, listingCents,
      });
      l.costBasis = basis.cents != null ? dollars(basis.cents) : null;
      l.costBasisEstimated = basis.estimated;
      l.profit = basis.cents != null ? dollars(l.amountCents - basis.cents) : null;
      l.returnPct = basis.cents > 0 ? Math.round(((l.amountCents - basis.cents) * 10000) / basis.cents) / 100 : null;
    }
    const shapeLine = (l) => {
      const { amountCents, ...rest } = l;
      return { ...rest, amount: dollars(amountCents) };
    };

    const sale = shapeSale(row);
    const out = {
      view,
      statementStatus: final ? "final" : "preview",
      sale,
      proceeds: {
        salePrice: dollars(toCents(row.gross_amount)),
        lrpIndemnity: dollars(toCents(row.lrp_indemnity)),
        total: dollars(proceeds),
      },
      load: {
        headSold: sale.headSold, headLost: sale.headLost,
        liveWeightLbs: sale.liveWeightLbs, pricePerCwt: sale.pricePerCwt,
        avgWeightPerHead: sale.liveWeightLbs != null && sale.headSold ? Math.round((sale.liveWeightLbs / sale.headSold) * 10) / 10 : null,
        pricePerHead: sale.headSold ? Math.round((toCents(row.gross_amount) / sale.headSold)) / 100 : null,
      },
      costs: {
        total: dollars(selfCents + serviceCents),
        selfBilled: dollars(selfCents),
        serviceBilled: dollars(serviceCents),
        byCategory: [...byCat.entries()].map(([category, cents]) => ({ category, amount: dollars(cents) })),
      },
      netAmount: dollars(netCents),
      profit: dollars(proceeds - selfCents - serviceCents),
      platformFeesTotal: dollars(feesTotalCents),
      warnings: [...new Set([...sale.warnings, ...warnings])],
    };

    if (view === "full") {
      out.payouts = lines.map(shapeLine);
      out.payoutsTotal = dollars(lines.reduce((sum, l) => sum + l.amountCents, 0));
      out.feeTerms = feeTerms;
    } else {
      const mine = lines.find((l) => l.recipientType === "investor" && l.userId === userId);
      out.you = mine ? shapeLine(mine) : null;
      // an investor sees only their own fee line, not the other investors'
      out.sale.feeTerms = null;
      out.feeTerms = feeTerms
        ? { ...feeTerms, investorFees: (feeTerms.investorFees ?? []).filter((f) => f.userId === userId) }
        : null;
    }

    return res.json(out);
  } catch (err) {
    return sendError(res, "GET /api/settlement/sales/:saleId/statement", err);
  }
});

// --- POST /api/settlement/payouts/:payoutId/mark-paid ------------------------
// Admin only. Body: { paymentReference } (check number, ACH id, etc.)
router.post("/payouts/:payoutId/mark-paid", requireAuth, requireRole("admin"), async (req, res) => {
  const { payoutId } = req.params;
  if (!isUuid(payoutId)) return res.status(400).json({ error: "Invalid payoutId." });
  const reference = req.body?.paymentReference ? String(req.body.paymentReference).trim().slice(0, 120) : "";
  if (!reference) return res.status(400).json({ error: "paymentReference is required." });

  try {
    const updated = await pool.query(
      `UPDATE herd_payouts
          SET status = 'paid', paid_at = NOW(), paid_by_user_id = $2, payment_reference = $3
        WHERE payout_id = $1 AND status = 'owed'
        RETURNING payout_id, sale_id, user_id, recipient_type, amount, status, paid_at, payment_reference`,
      [payoutId, req.user.userId, reference]
    );
    if (updated.rowCount === 0) {
      const exists = await pool.query("SELECT status FROM herd_payouts WHERE payout_id = $1", [payoutId]);
      if (exists.rowCount === 0) return res.status(404).json({ error: "Payout not found." });
      return res.status(409).json({ error: `Payout is already ${exists.rows[0].status}.` });
    }
    const p = updated.rows[0];
    return res.json({
      message: "Payout marked paid.",
      payout: {
        payoutId: p.payout_id, saleId: p.sale_id, userId: p.user_id,
        recipientType: p.recipient_type, amount: Number(p.amount),
        status: p.status, paidAt: p.paid_at, paymentReference: p.payment_reference,
      },
    });
  } catch (err) {
    return sendError(res, "POST /api/settlement/payouts/:payoutId/mark-paid", err);
  }
});

// --- GET /api/settlement/my-payouts ------------------------------------------
// Any signed-in user: what they are owed or have been paid from settled sales.
router.get("/my-payouts", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.payout_id, p.sale_id, h.herd_id, h.herd_name, s.sale_date::text AS sale_date,
              p.recipient_type, p.tokens_held, p.share_pct,
              p.gross_before_fees, p.fee_amount, p.cost_basis,
              p.amount, p.status, p.paid_at, p.payment_reference
         FROM herd_payouts p
         JOIN herd_sales s ON s.sale_id = p.sale_id
         JOIN herds h      ON h.herd_id = s.herd_id
        WHERE p.user_id = $1
        ORDER BY s.sale_date DESC, p.created_at DESC`,
      [req.user.userId]
    );
    return res.json(
      result.rows.map((p) => ({
        payoutId:         p.payout_id,
        saleId:           p.sale_id,
        herdId:           p.herd_id,
        herdName:         p.herd_name,
        saleDate:         p.sale_date,
        recipientType:    p.recipient_type,
        tokens:           Number(p.tokens_held),
        sharePct:         p.share_pct != null ? Number(p.share_pct) : null,
        grossBeforeFees:  p.gross_before_fees != null ? Number(p.gross_before_fees) : null,
        feeAmount:        Number(p.fee_amount),
        costBasis:        p.cost_basis != null ? Number(p.cost_basis) : null,
        amount:           Number(p.amount),
        status:           p.status,
        paidAt:           p.paid_at,
        paymentReference: p.payment_reference,
      }))
    );
  } catch (err) {
    return sendError(res, "GET /api/settlement/my-payouts", err);
  }
});

export default router;
