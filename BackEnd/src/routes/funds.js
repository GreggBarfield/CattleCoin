import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { HttpError, isUuid, toCents, dollars, money, withTransaction, sendError } from "../lib/routeHelpers.js";
import {
  loadHerdTerms, pctToBps, feeOnCents, getFundsPosition, shapeFunds, shapeTerms, writeAudit,
} from "../lib/feeTerms.js";

const router = express.Router();

// Investor money: what a herd has raised, and releasing it to the producer.
//
//   raised     every recorded investor payment for the herd (investor_payments)
//   released   what an admin has already released to the producer
//   available  raised - released
//
// A release takes the herd's raise fee (a % of the released amount) and, if the
// herd's per-head fee is set to "raise", the per-head fee (head count x rate)
// on the FIRST release only. What is left is owed to the producer; an admin
// marks it paid with a reference once the money has actually gone out.
//
// A herd cannot release money until it has its own fee terms (no terms, no
// release), so nothing is ever released on an unconfirmed fee. The first
// release locks the terms.
//
// This records the release. It does not move money.

function shapeRelease(r) {
  return {
    releaseId:        r.release_id,
    herdId:           r.herd_id,
    herdName:         r.herd_name ?? null,
    producerSlug:     r.producer_slug ?? null,
    grossAmount:      Number(r.gross_amount),
    raiseFeePct:      Number(r.raise_fee_pct),
    raiseFee:         Number(r.raise_fee),
    perHeadFee:       Number(r.per_head_fee),
    netToProducer:    Number(r.net_to_producer),
    status:           r.status,
    note:             r.note ?? null,
    releasedAt:       r.released_at,
    paidAt:           r.paid_at ?? null,
    paymentReference: r.payment_reference ?? null,
  };
}

const RELEASE_SELECT = `
  SELECT r.*, h.herd_name, pu.slug AS producer_slug
    FROM herd_releases r
    JOIN herds h  ON h.herd_id = r.herd_id
    JOIN users pu ON pu.user_id = r.producer_user_id
`;

// --- GET /api/funds/herds/:herdId --------------------------------------------
// Admin or the herd's owner.
router.get("/herds/:herdId", requireAuth, async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  try {
    const herd = await pool.query("SELECT herd_id, herd_name, rancher_id FROM herds WHERE herd_id = $1", [herdId]);
    if (herd.rowCount === 0) return res.status(404).json({ error: "Herd not found." });
    const isAdmin = req.user.role === "admin";
    if (!isAdmin && herd.rows[0].rancher_id !== req.user.userId) {
      return res.status(403).json({ error: "You are not allowed to view this herd's funds." });
    }
    const funds = await getFundsPosition(pool, herdId);
    const terms = await loadHerdTerms(pool, herdId);
    const releases = await pool.query(`${RELEASE_SELECT} WHERE r.herd_id = $1 ORDER BY r.released_at`, [herdId]);

    const body = {
      herdId,
      herdName: herd.rows[0].herd_name,
      funds: shapeFunds(funds),
      feeTermsSet: !!terms,
      terms: shapeTerms(terms),
      releases: releases.rows.map(shapeRelease),
    };
    if (isAdmin) {
      const pay = await pool.query(
        `SELECT p.payment_id, u.slug, p.tokens, p.amount, p.stripe_payment_intent_id, p.created_at
           FROM investor_payments p JOIN users u ON u.user_id = p.user_id
          WHERE p.herd_id = $1 ORDER BY p.created_at`,
        [herdId]
      );
      body.payments = pay.rows.map((p) => ({
        paymentId: p.payment_id, investorSlug: p.slug, tokens: Number(p.tokens),
        amount: Number(p.amount), stripePaymentIntentId: p.stripe_payment_intent_id, paidAt: p.created_at,
      }));
    }
    return res.json(body);
  } catch (err) {
    return sendError(res, "GET /api/funds/herds/:herdId", err);
  }
});

// --- POST /api/funds/herds/:herdId/release -----------------------------------
// Admin only. Body: { amount? (dollars, default = everything available), note? }
router.post("/herds/:herdId/release", requireAuth, requireRole("admin"), async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  const body = req.body ?? {};
  const note = body.note ? String(body.note).trim().slice(0, 255) : null;

  let requestedCents = null;
  if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
    const a = Number(body.amount);
    if (!Number.isFinite(a) || a <= 0) return res.status(400).json({ error: "amount must be a number greater than 0." });
    requestedCents = toCents(a);
  }

  try {
    const out = await withTransaction(async (client) => {
      const herdRes = await client.query(
        "SELECT herd_id, rancher_id, head_count, feedlot_status FROM herds WHERE herd_id = $1 FOR UPDATE",
        [herdId]
      );
      if (herdRes.rowCount === 0) throw new HttpError(404, "Herd not found.");
      const herd = herdRes.rows[0];
      if (herd.feedlot_status === "sold") {
        throw new HttpError(409, "This herd is sold or has a sale in progress - money cannot be released now.");
      }

      const terms = await loadHerdTerms(client, herdId, { lock: true });
      if (!terms) {
        throw new HttpError(409, "Set this herd's fee terms first (PUT /api/fees/herds/:herdId). Money cannot be released without them.");
      }

      const funds = await getFundsPosition(client, herdId);
      if (funds.availableCents <= 0) throw new HttpError(409, "There is no investor money available to release for this herd.");
      const grossCents = requestedCents ?? funds.availableCents;
      if (grossCents > funds.availableCents) {
        throw new HttpError(409, `Only $${money(funds.availableCents)} is available to release.`);
      }

      const raiseBps = pctToBps(terms.raise_fee_pct);
      const raiseFeeCents = feeOnCents(grossCents, raiseBps);

      let perHeadCents = 0;
      const perHeadRate = toCents(terms.per_head_fee);
      const warnings = [];
      if (terms.per_head_fee_timing === "raise" && perHeadRate > 0 && funds.releaseCount === 0) {
        const head = herd.head_count != null ? Number(herd.head_count) : 0;
        if (head <= 0) throw new HttpError(409, "This herd has no head count, so the per-head fee cannot be calculated.");
        perHeadCents = head * perHeadRate;
      }

      const feesCents = raiseFeeCents + perHeadCents;
      if (feesCents > grossCents) {
        throw new HttpError(
          409,
          `The fees ($${money(feesCents)}) are more than the amount being released ($${money(grossCents)}). Release more, or lower the fees.`
        );
      }
      const netCents = grossCents - feesCents;
      if (feesCents === 0) {
        warnings.push("No fees were charged on this release - this herd's raise fee and per-head fee are 0.");
      }

      const ins = await client.query(
        `INSERT INTO herd_releases
           (herd_id, producer_user_id, gross_amount, raise_fee_pct, raise_fee, per_head_fee,
            net_to_producer, note, released_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING release_id`,
        [herdId, herd.rancher_id, money(grossCents), terms.raise_fee_pct, money(raiseFeeCents),
         money(perHeadCents), money(netCents), note, req.user.userId]
      );

      await client.query(
        "UPDATE herd_fee_terms SET locked_at = COALESCE(locked_at, NOW()) WHERE herd_id = $1",
        [herdId]
      );
      await writeAudit(client, {
        action: "funds_released", herdId,
        newValues: { gross: dollars(grossCents), raiseFee: dollars(raiseFeeCents), perHeadFee: dollars(perHeadCents), net: dollars(netCents) },
        changedBy: req.user.userId,
      });

      const full = await client.query(`${RELEASE_SELECT} WHERE r.release_id = $1`, [ins.rows[0].release_id]);
      const after = await getFundsPosition(client, herdId);
      return { release: full.rows[0], funds: after, warnings };
    });
    return res.status(201).json({
      message: "Release recorded. The producer is owed the net amount - no money has moved.",
      release: shapeRelease(out.release),
      funds: shapeFunds(out.funds),
      warnings: out.warnings,
    });
  } catch (err) {
    return sendError(res, "POST /api/funds/herds/:herdId/release", err);
  }
});

// --- POST /api/funds/releases/:releaseId/mark-paid ---------------------------
// Admin only. Body: { paymentReference }
router.post("/releases/:releaseId/mark-paid", requireAuth, requireRole("admin"), async (req, res) => {
  const { releaseId } = req.params;
  if (!isUuid(releaseId)) return res.status(400).json({ error: "Invalid releaseId." });
  const reference = req.body?.paymentReference ? String(req.body.paymentReference).trim().slice(0, 120) : "";
  if (!reference) return res.status(400).json({ error: "paymentReference is required." });
  try {
    const upd = await pool.query(
      `UPDATE herd_releases
          SET status = 'paid', paid_at = NOW(), paid_by_user_id = $2, payment_reference = $3
        WHERE release_id = $1 AND status = 'owed' RETURNING release_id`,
      [releaseId, req.user.userId, reference]
    );
    if (upd.rowCount === 0) {
      const ex = await pool.query("SELECT status FROM herd_releases WHERE release_id = $1", [releaseId]);
      if (ex.rowCount === 0) return res.status(404).json({ error: "Release not found." });
      return res.status(409).json({ error: `Release is already ${ex.rows[0].status}.` });
    }
    const full = await pool.query(`${RELEASE_SELECT} WHERE r.release_id = $1`, [releaseId]);
    return res.json({ message: "Release marked paid.", release: shapeRelease(full.rows[0]) });
  } catch (err) {
    return sendError(res, "POST /api/funds/releases/:releaseId/mark-paid", err);
  }
});

// --- GET /api/funds/my-releases ----------------------------------------------
// A producer's own releases (what they were released and what fees came out).
router.get("/my-releases", requireAuth, requireRole("rancher", "feedlot"), async (req, res) => {
  try {
    const r = await pool.query(`${RELEASE_SELECT} WHERE r.producer_user_id = $1 ORDER BY r.released_at DESC`, [req.user.userId]);
    return res.json(r.rows.map(shapeRelease));
  } catch (err) {
    return sendError(res, "GET /api/funds/my-releases", err);
  }
});

export default router;
