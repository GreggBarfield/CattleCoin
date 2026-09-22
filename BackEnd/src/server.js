import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./db.js";
import poolsRoutes from "./routes/pools.js";
import cowsRoutes from "./routes/cows.js";
import investorsRoutes from "./routes/investors.js";
import investRoutes from "./routes/invest.js";
import feedlotsRoutes from "./routes/feedlots.js";
import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import rancherRoutes from "./routes/rancher.js";
import herdsRoutes from "./routes/herds.js";
import offeringRoutes from "./routes/offering.js";
import stagesRoutes from "./routes/stages.js";
import carcassRoutes from "./routes/carcass.js";
import cattleRoutes from "./routes/cattle.js";
import blockchainRoutes from "./routes/blockchain.js";
import settlementRoutes from "./routes/settlement.js";
import expensesRoutes from "./routes/expenses.js";
import lrpRoutes from "./routes/lrp.js";
import myMoneyRoutes from "./routes/myMoney.js";
import marketplaceRoutes from "./routes/marketplace.js";
import feesRoutes from "./routes/fees.js";
import fundsRoutes from "./routes/funds.js";

dotenv.config();

const app = express();

app.use(cors());

// Stripe webhooks require the raw body â€” mount BEFORE express.json()
app.use("/api/invest/webhook", express.raw({ type: "application/json" }));

app.use(express.json());

// â”€â”€ Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use("/api/pools", poolsRoutes);
app.use("/api/cows", cowsRoutes);
// Note: the old unauthenticated GET /api/portfolio (no :slug) was removed
// 2026-09-21 - it was dead (no page called it), fabricated its numbers the
// same way /api/investors/:slug/portfolio used to, and unlike that route had
// no login check at all, so it leaked every investor's herd data to anyone.
// See step-dashboard-real-numbers.md.
app.use("/api/investors", investorsRoutes); // per-investor dashboard + holdings
app.use("/api/invest",    investRoutes);    // POST buy-tokens form
app.use("/api/feedlot",  feedlotsRoutes);  // feedlot claim + dashboard
app.use("/api/auth",     authRoutes);      // login
app.use("/api/users",    usersRoutes);     // user list by role
app.use("/api/rancher", rancherRoutes);
app.use("/api/herds", herdsRoutes);
app.use("/api/herds", offeringRoutes);
app.use("/api/herds", stagesRoutes);
app.use("/api/cattle", cattleRoutes);
app.use("/api/carcass", carcassRoutes); // per-animal carcass grade records (record-only, no payout yet)
app.use("/api/blockchain", blockchainRoutes);
app.use("/api/settlement", settlementRoutes);
app.use("/api/expenses", expensesRoutes);
app.use("/api/lrp", lrpRoutes);
app.use("/api/my-money", myMoneyRoutes); // investor: what I paid in, what I am owed
app.use("/api/marketplace", marketplaceRoutes); // investor: lots open to investors, real numbers
app.use("/api/fees", feesRoutes);
app.use("/api/funds", fundsRoutes);

// â”€â”€ Health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get("/api/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ status: "ok", dbTime: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// â”€â”€ 404 fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});