import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { toCents, dollars, sendError } from "../lib/routeHelpers.js";

const router = express.Router();

// GET /api/my-money
// An investor's own money picture, straight from the ledger (not an estimate):
// what they paid in for each herd, where each herd stands (open, sale pending,
// sold), and what they have been paid or are still owed from a sale.
// Identity comes only from the login token. Whole cents throughout.
//
// Tokens that were bought with no payment recorded (older demo data) are NOT
// counted as money paid in. Their value is estimated from the listing price and
// reported separately (estimatedExtra), the same estimate the settlement
// statement uses for profit and loss.
router.get("/", requireAuth, requireRole("investor"), async (req, res) => {
  const userId = req.user.userId;
  try {
    // every herd this investor holds, paid into, or has a payout for
    const herdRes = await pool.query(
      `WITH mine AS (
         SELECT tp.herd_id FROM ownership o JOIN token_pools tp ON tp.pool_id = o.pool_id
          WHERE o.user_id = $1 AND o.token_amount > 0
         UNION SELECT herd_id FROM investor_payments WHERE user_id = $1
         UNION SELECT s.herd_id FROM herd_payouts p JOIN herd_sales s ON s.sale_id = p.sale_id
          WHERE p.user_id = $1 AND p.recipient_type = 'investor'
       )
       SELECT h.herd_id, h.herd_name, h.feedlot_status, h.head_count, h.listing_price,
              ow.role AS owner_role, tp.total_supply,
              COALESCE((SELECT SUM(o.token_amount) FROM ownership o
                         WHERE o.pool_id = tp.pool_id AND o.user_id = $1), 0) AS tokens,
              COALESCE((SELECT SUM(e.amount) FROM herd_expenses e
                         WHERE e.herd_id = h.herd_id AND e.status = 'active'), 0) AS costs_total
         FROM mine m
         JOIN herds h ON h.herd_id = m.herd_id
         JOIN users ow ON ow.user_id = h.rancher_id
         LEFT JOIN token_pools tp ON tp.herd_id = h.herd_id
        ORDER BY h.herd_name`,
      [userId]
    );
    const herdIds = herdRes.rows.map((r) => r.herd_id);

    const payments = herdIds.length
      ? await pool.query(
          `SELECT herd_id, payment_id, tokens, amount, created_at
             FROM investor_payments WHERE user_id = $1 AND herd_id = ANY($2::uuid[])
            ORDER BY created_at`,
          [userId, herdIds]
        )
      : { rows: [] };
    const sales = herdIds.length
      ? await pool.query(
          `SELECT DISTINCT ON (herd_id) herd_id, sale_id, status, sale_date::text AS sale_date
             FROM herd_sales
            WHERE herd_id = ANY($1::uuid[]) AND status IN ('pending_approval', 'approved')
            ORDER BY herd_id, (status = 'approved') DESC, submitted_at DESC`,
          [herdIds]
        )
      : { rows: [] };
    const payouts = await pool.query(
      `SELECT s.herd_id, p.payout_id, p.sale_id, p.tokens_held, p.gross_before_fees, p.fee_amount,
              p.capital_returned, p.amount, p.status, p.paid_at, p.payment_reference
         FROM herd_payouts p JOIN herd_sales s ON s.sale_id = p.sale_id
        WHERE p.user_id = $1 AND p.recipient_type = 'investor' AND s.status = 'approved'
        ORDER BY s.sale_date`,
      [userId]
    );

    const payByHerd = new Map();
    for (const p of payments.rows) {
      if (!payByHerd.has(p.herd_id)) payByHerd.set(p.herd_id, []);
      payByHerd.get(p.herd_id).push(p);
    }
    const saleByHerd = new Map(sales.rows.map((s) => [s.herd_id, s]));
    const payoutByHerd = new Map(payouts.rows.map((p) => [p.herd_id, p]));

    let paidInCents = 0;
    let estimatedCents = 0;
    let stillInvestedCents = 0;
    let receivedCents = 0;
    let owedCents = 0;

    const herds = herdRes.rows.map((h) => {
      const tokens = Number(h.tokens);
      const supply = h.total_supply != null ? BigInt(h.total_supply) : 0n;
      const list = payByHerd.get(h.herd_id) ?? [];
      let cents = 0;
      let recTokens = 0;
      for (const p of list) { cents += toCents(p.amount); recTokens += Number(p.tokens); }
      const unrecorded = Math.max(0, tokens - recTokens);
      let extraCents = 0;
      let basisKnown = true;
      if (unrecorded > 0) {
        const listing = h.listing_price != null ? toCents(h.listing_price) : 0;
        if (listing > 0 && supply > 0n) extraCents = Number((BigInt(unrecorded) * BigInt(listing)) / supply);
        else basisKnown = false;
      }
      const basisCents = cents + extraCents;

      const sale = saleByHerd.get(h.herd_id) ?? null;
      let state;
      if (sale) state = sale.status === "approved" ? "sold" : "sale_pending";
      else state = h.feedlot_status === "listed" ? "open" : "closed";

      let payout = null;
      const po = payoutByHerd.get(h.herd_id);
      if (po) {
        const amountCents = toCents(po.amount);
        const capitalCents = toCents(po.capital_returned);
        const grossCents = po.gross_before_fees != null ? toCents(po.gross_before_fees) : null;
        payout = {
          payoutId: po.payout_id,
          saleId: po.sale_id,
          amount: dollars(amountCents),
          capitalReturned: dollars(capitalCents),
          profitShare: grossCents != null ? dollars(grossCents - capitalCents) : null,
          exitFee: dollars(toCents(po.fee_amount)),
          status: po.status,
          paidAt: po.paid_at,
          paymentReference: po.payment_reference,
          profit: basisKnown ? dollars(amountCents - basisCents) : null,
        };
        if (po.status === "paid") receivedCents += amountCents; else owedCents += amountCents;
      }

      paidInCents += cents;
      estimatedCents += extraCents;
      if (state !== "sold") stillInvestedCents += cents;

      return {
        herdId: h.herd_id,
        herdName: h.herd_name,
        producerType: h.owner_role === "feedlot" ? "feeder" : "cow-calf",
        state,
        headCount: h.head_count != null ? Number(h.head_count) : null,
        tokens,
        totalSupply: h.total_supply != null ? Number(h.total_supply) : null,
        sharePct: supply > 0n ? Math.round((tokens * 10000) / Number(supply)) / 100 : null,
        paidIn: dollars(cents),
        estimatedExtra: unrecorded > 0 && basisKnown ? dollars(extraCents) : null,
        unrecordedTokens: unrecorded,
        payments: list.map((p) => ({
          paymentId: p.payment_id, paidAt: p.created_at, tokens: Number(p.tokens), amount: dollars(toCents(p.amount)),
        })),
        costsTotal: dollars(toCents(h.costs_total)),
        sale: sale ? { saleId: sale.sale_id, status: sale.status, saleDate: sale.sale_date } : null,
        payout,
      };
    });

    return res.json({
      asOfIso: new Date().toISOString(),
      totals: {
        paidIn: dollars(paidInCents),
        estimatedExtra: dollars(estimatedCents),
        stillInvested: dollars(stillInvestedCents),
        receivedFromSales: dollars(receivedCents),
        owedFromSales: dollars(owedCents),
      },
      herds,
    });
  } catch (err) {
    return sendError(res, "GET /api/my-money", err);
  }
});

export default router;
