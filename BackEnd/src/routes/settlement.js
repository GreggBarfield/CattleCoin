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
//   net       = max(0, gross - expenses)
//   investor  = floor(net * investor_tokens / total_supply)
//   provider  = service-billed expenses (a feedyard billing the owner), paid
//               ahead of everyone else, capped at the gross price
//   owner     = whatever is left, so the payouts always add up to exactly the
//               gross price (this is the owner's share of net plus
//               reimbursement of costs the owner paid itself, plus any
//               rounding pennies and the share of unsold tokens)
// A losing sale pays investors zero - there is no clawback.
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
// This records what is owed. It does not move money.

const OWNER_ROLES = ["rancher", "feedlot"];
const SALE_STATUSES = ["pending_approval", "approved", "rejected", "cancelled"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GROSS_DOLLARS = 999999999999;

// Columns returned for a sale. Dates come back as text so a server time zone
// can never shift the day.
const SALE_SELECT = `
  s.sale_id, s.herd_id, s.seller_user_id, s.buyer_user_id, s.buyer_name,
  s.gross_amount, s.sale_date::text AS sale_date, s.status,
  s.expenses_total, s.net_amount, s.platform_fees_total, s.fee_terms_snapshot,
  s.submitted_at, s.decided_at, s.decision_note,
  s.buyer_response, s.buyer_responded_at, s.buyer_response_note, s.new_herd_id,
  h.herd_name, su.slug AS seller_slug, bu.slug AS buyer_slug
`;
const SALE_FROM = `
  FROM herd_sales s
  JOIN herds h  ON h.herd_id = s.herd_id
  JOIN users su ON su.user_id = s.seller_user_id
  LEFT JOIN users bu ON bu.user_id = s.buyer_user_id
`;

function shapeSale(r) {
  return {
    saleId:        r.sale_id,
    herdId:        r.herd_id,
    herdName:      r.herd_name ?? null,
    sellerUserId:  r.seller_user_id,
    sellerSlug:    r.seller_slug ?? null,
    buyerUserId:   r.buyer_user_id ?? null,
    buyerSlug:     r.buyer_slug ?? null,
    buyerName:     r.buyer_name ?? null,
    grossAmount:   Number(r.gross_amount),
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
  };
}

function shapeBreakdown(b) {
  return {
    grossAmount:           dollars(b.grossCents),
    selfBilledExpenses:    dollars(b.selfCents),
    serviceBilledExpenses: dollars(b.serviceCents),
    expensesTotal:         dollars(b.expensesCents),
    netAmount:             dollars(b.netCents),
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

async function computeSettlement(db, { herdId, ownerId, grossCents, platformUserId = null }) {
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
  const netCents = Math.max(0, grossCents - expensesCents);

  const investorPayouts = holders.map((h) => {
    const cents = Number((BigInt(netCents) * BigInt(h.token_amount)) / totalSupply);
    return {
      recipientType: "investor",
      userId: h.user_id,
      tokens: Number(h.token_amount),
      sharePct: Number((BigInt(h.token_amount) * 100000000n) / totalSupply) / 1e6,
      grossBeforeCents: cents,
      feeCents: 0,
      cents,
    };
  });

  const providerPool = Math.min(serviceCents, grossCents);
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
  const warnings = [];
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
    grossCents, selfCents, serviceCents, expensesCents, netCents,
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
// Owner submits a sale. Body: { grossAmount, buyerSlug? | buyerName?, saleDate? }
// buyerSlug = a producer account on the platform; buyerName = an outside buyer
// (packer, etc.). At least one is required.
router.post("/herds/:herdId/sale", requireAuth, requireRole(...OWNER_ROLES), async (req, res) => {
  const { herdId } = req.params;
  const sellerId = req.user.userId;
  const body = req.body ?? {};

  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });

  const grossRaw = body.grossAmount;
  const gross = Number(grossRaw);
  if (grossRaw === undefined || grossRaw === null || grossRaw === "" || !Number.isFinite(gross) || gross < 0) {
    return res.status(400).json({ error: "grossAmount must be a number of 0 or more." });
  }
  if (gross > MAX_GROSS_DOLLARS) return res.status(400).json({ error: "grossAmount is too large." });
  const grossCents = toCents(gross);

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
        "SELECT herd_id, rancher_id, feedlot_status FROM herds WHERE herd_id = $1 FOR UPDATE",
        [herdId]
      );
      if (herdRes.rowCount === 0) throw new HttpError(404, "Herd not found.");
      const herd = herdRes.rows[0];
      if (herd.rancher_id !== sellerId) throw new HttpError(403, "You are not allowed to sell this herd.");
      if (herd.feedlot_status === "sold") {
        throw new HttpError(409, "This herd is already sold or has a sale in progress.");
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
        buyerUserId = b.rows[0].user_id;
      }

      let saleRow;
      try {
        const ins = await client.query(
          `INSERT INTO herd_sales
             (herd_id, seller_user_id, buyer_user_id, buyer_name, gross_amount, sale_date, prior_feedlot_status, buyer_response)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7, $8)
           RETURNING sale_id`,
          [herdId, sellerId, buyerUserId, buyerName, money(grossCents), saleDate, herd.feedlot_status ?? "pending",
           buyerUserId ? "waiting" : "not_required"]
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
      const breakdown = await computeSettlement(client, { herdId, ownerId: sellerId, grossCents, platformUserId });
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
        grossCents: toCents(row.gross_amount),
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
        "SELECT sale_id, herd_id, seller_user_id, buyer_user_id, buyer_response, gross_amount, status FROM herd_sales WHERE sale_id = $1 FOR UPDATE",
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
        grossCents: toCents(sale.gross_amount),
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
              status, paid_at, paid_by_user_id, payment_reference)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            saleId, p.userId, p.recipientType, p.tokens, p.sharePct, money(p.cents),
            p.grossBeforeCents != null ? money(p.grossBeforeCents) : null,
            money(p.feeCents ?? 0),
            p.costBasisCents != null ? money(p.costBasisCents) : null,
            settled ? "paid" : "owed",
            settled ? new Date() : null,
            settled ? adminId : null,
            isPlatform ? "Fee retained by platform" : noneDue ? "No payout due" : null,
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
