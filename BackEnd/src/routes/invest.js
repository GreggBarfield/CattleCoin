import express from "express";
import Stripe from "stripe";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ─── helpers ─────────────────────────────────────────────────────────────────

async function recordInvestment({ herdId, investorSlug, tokensToBuy }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const herdRow = await client.query(`
      SELECT h.herd_id, h.purchase_status, h.tokens_sold, h.investor_pct,
             tp.pool_id, tp.total_supply
      FROM herds h
      JOIN token_pools tp ON tp.herd_id = h.herd_id
      WHERE h.herd_id = $1 AND h.feedlot_status = 'listed'
      FOR UPDATE
    `, [herdId]);

    if (herdRow.rows.length === 0) throw new Error("Herd not found or not available");
    const hr = herdRow.rows[0];

    const totalSupply = parseInt(hr.total_supply, 10);
    const investorAllocation = hr.investor_pct != null
      ? Math.floor(totalSupply * parseFloat(hr.investor_pct) / 100)
      : totalSupply;
    const remaining = investorAllocation - parseInt(hr.tokens_sold, 10);
    if (remaining < tokensToBuy) throw new Error(`Only ${remaining} tokens remaining`);

    const userRes = await client.query(
      "SELECT user_id FROM users WHERE slug = $1 AND role = 'investor'",
      [investorSlug]
    );
    if (userRes.rows.length === 0) throw new Error("Investor not found");
    const userId = userRes.rows[0].user_id;

    await client.query(`
      INSERT INTO ownership (user_id, pool_id, token_amount)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, pool_id)
      DO UPDATE SET token_amount = ownership.token_amount + EXCLUDED.token_amount
    `, [userId, hr.pool_id, tokensToBuy]);

    await client.query(`
      INSERT INTO transactions (user_id, pool_id, type, amount, status)
      VALUES ($1, $2, 'buy'::transaction_type, $3, 'confirmed')
    `, [userId, hr.pool_id, tokensToBuy]);

    const newTokensSold = parseInt(hr.tokens_sold, 10) + tokensToBuy;
    const newStatus = newTokensSold >= investorAllocation ? "sold" : hr.purchase_status;
    await client.query(
      "UPDATE herds SET tokens_sold = $1, purchase_status = $2 WHERE herd_id = $3",
      [newTokensSold, newStatus, herdId]
    );

    await client.query("COMMIT");
    return { tokensRemaining: investorAllocation - newTokensSold, newStatus };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── GET /api/invest/:herdId — fetch herd info for the buy form (public) ──────
router.get("/:herdId", async (req, res) => {
  try {
    const { herdId } = req.params;
    const result = await pool.query(`
      SELECT
        h.herd_id, h.herd_name, h.listing_price, h.purchase_status,
        h.head_count, h.verified_flag, h.dominant_stage, h.breed_code,
        h.risk_score, h.tokens_sold, h.investor_pct, h.feedlot_status,
        tp.total_supply, tp.contract_address
      FROM herds h
      JOIN token_pools tp ON tp.herd_id = h.herd_id
      WHERE h.herd_id = $1 AND h.feedlot_status = 'listed'
    `, [herdId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Herd not found or not yet available to investors" });
    }
    const r = result.rows[0];

    const totalSupply = parseInt(r.total_supply, 10) || 0;
    const investorPct = r.investor_pct != null ? parseFloat(r.investor_pct) : null;
    const investorAllocation = investorPct != null
      ? Math.floor(totalSupply * investorPct / 100)
      : totalSupply;
    const tokensSold      = parseInt(r.tokens_sold, 10) || 0;
    const tokensAvailable = Math.max(0, investorAllocation - tokensSold);
    const pricePerToken   = totalSupply > 0
      ? Math.round((parseFloat(r.listing_price) || 0) / totalSupply * 100) / 100
      : 0;

    res.json({
      herdId:            r.herd_id,
      herdName:          r.herd_name || r.herd_id,
      purchaseStatus:    r.purchase_status,
      listingPrice:      parseFloat(r.listing_price) || 0,
      dominantStage:     r.dominant_stage || "RANCH",
      breedCode:         r.breed_code || "AN",
      riskScore:         r.risk_score != null ? parseInt(r.risk_score, 10) : null,
      totalSupply,
      investorAllocation,
      investorPct,
      tokensSold,
      tokensAvailable,
      pricePerToken,
      contractAddress:   r.contract_address || "",
      isAvailable:       tokensAvailable > 0 && r.purchase_status !== "sold",
    });
  } catch (err) {
    console.error("GET /api/invest/:herdId", err.message);
    res.status(500).json({ error: "Failed to fetch herd for investment", detail: err.message });
  }
});

// ─── POST /api/invest/create-payment-intent ───────────────────────────────────
// Step 1 of the Stripe flow.
// Body: { herdId, tokensToBuy }
// investorSlug is no longer accepted from the body - it is always the
// verified token holder, so the resulting Stripe PaymentIntent's metadata
// (and everything /confirm and /webhook later trust) is tied to a real,
// authenticated investor, not whatever the client claims.
// Returns: { clientSecret, paymentIntentId, amountUsd, totalCents }
router.post("/create-payment-intent", requireAuth, requireRole("investor"), async (req, res) => {
  const { herdId, tokensToBuy } = req.body;
  const investorSlug = req.user.slug;

  if (!herdId || !tokensToBuy || tokensToBuy < 1) {
    return res.status(400).json({ error: "herdId and tokensToBuy are required" });
  }

  try {
    // Validate the herd + available tokens before charging
    const result = await pool.query(`
      SELECT h.herd_id, h.herd_name, h.listing_price, h.tokens_sold, h.investor_pct,
             tp.total_supply
      FROM herds h
      JOIN token_pools tp ON tp.herd_id = h.herd_id
      WHERE h.herd_id = $1 AND h.feedlot_status = 'listed'
    `, [herdId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Herd not available for investment" });
    }
    const r = result.rows[0];

    const totalSupply = parseInt(r.total_supply, 10);
    const investorAllocation = r.investor_pct != null
      ? Math.floor(totalSupply * parseFloat(r.investor_pct) / 100)
      : totalSupply;
    const remaining = investorAllocation - parseInt(r.tokens_sold, 10);

    if (remaining < tokensToBuy) {
      return res.status(409).json({ error: `Only ${remaining} tokens remaining` });
    }

    const pricePerToken = parseFloat(r.listing_price) / totalSupply;
    const amountUsd = pricePerToken * tokensToBuy;
    // Stripe requires amounts in smallest currency unit (cents)
    const totalCents = Math.round(amountUsd * 100);

    if (totalCents < 50) {
      return res.status(400).json({ error: "Minimum payment is $0.50" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   totalCents,
      currency: "usd",
      metadata: {
        herdId,
        herdName:     r.herd_name,
        investorSlug,
        tokensToBuy:  String(tokensToBuy),
      },
      description: `CattleCoin — ${tokensToBuy} token(s) in ${r.herd_name}`,
    });

    res.json({
      clientSecret:    paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amountUsd:       parseFloat(amountUsd.toFixed(2)),
      totalCents,
    });
  } catch (err) {
    console.error("POST /api/invest/create-payment-intent", err.message);
    res.status(500).json({ error: "Failed to create payment intent", detail: err.message });
  }
});

// ─── POST /api/invest/confirm ─────────────────────────────────────────────────
// Step 2 — called by the frontend after Stripe confirms the card payment.
// Body: { paymentIntentId }
// Verifies the PaymentIntent status with Stripe, confirms the intent's
// metadata was actually created for the currently authenticated investor
// (not just anyone with the paymentIntentId), then records the investment.
router.post("/confirm", requireAuth, requireRole("investor"), async (req, res) => {
  const { paymentIntentId } = req.body;

  if (!paymentIntentId) {
    return res.status(400).json({ error: "paymentIntentId is required" });
  }

  try {
    // Verify with Stripe that the payment actually succeeded
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.status !== "succeeded") {
      return res.status(402).json({
        error: `Payment not confirmed (status: ${intent.status})`,
      });
    }

    const { herdId, investorSlug, tokensToBuy } = intent.metadata;

    if (investorSlug !== req.user.slug) {
      return res.status(403).json({ error: "This payment intent does not belong to you." });
    }

    const tokens = parseInt(tokensToBuy, 10);

    // Record the investment in our DB
    const result = await recordInvestment({ herdId, investorSlug, tokensToBuy: tokens });

    res.json({
      success: true,
      message: `Successfully purchased ${tokens} token(s) in ${intent.metadata.herdName}.`,
      tokensRemaining: result.tokensRemaining,
      newStatus:       result.newStatus,
    });
  } catch (err) {
    console.error("POST /api/invest/confirm", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/invest/webhook ─────────────────────────────────────────────────
// Stripe webhook — backup/production path for recording investments.
// Requires raw body (configured in server.js before the json middleware).
// This is a server-to-server call authenticated by Stripe's own signature
// (not a user JWT), so it is intentionally left outside requireAuth.
// Set STRIPE_WEBHOOK_SECRET in .env after running: stripe listen --forward-to localhost:3000/api/invest/webhook
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;
    const { herdId, investorSlug, tokensToBuy } = intent.metadata;

    if (herdId && investorSlug && tokensToBuy) {
      try {
        await recordInvestment({
          herdId,
          investorSlug,
          tokensToBuy: parseInt(tokensToBuy, 10),
        });
        console.log(`Webhook: recorded ${tokensToBuy} tokens for ${investorSlug} in ${herdId}`);
      } catch (err) {
        // Log but don't fail — Stripe will retry if we return non-2xx
        console.error("Webhook recordInvestment failed:", err.message);
      }
    }
  }

  res.json({ received: true });
});

export default router;
