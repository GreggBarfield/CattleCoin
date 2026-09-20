import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./db.js";
import poolsRoutes from "./routes/pools.js";
import cowsRoutes from "./routes/cows.js";
import portfolioRoutes from "./routes/portfolio.js";
import investorsRoutes from "./routes/investors.js";
import investRoutes from "./routes/invest.js";
import feedlotsRoutes from "./routes/feedlots.js";
import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import rancherRoutes from "./routes/rancher.js";
import herdsRoutes from "./routes/herds.js";
import offeringRoutes from "./routes/offering.js";
import cattleRoutes from "./routes/cattle.js";
import blockchainRoutes from "./routes/blockchain.js";
import settlementRoutes from "./routes/settlement.js";
import expensesRoutes from "./routes/expenses.js";
import lrpRoutes from "./routes/lrp.js";
import feesRoutes from "./routes/fees.js";
import fundsRoutes from "./routes/funds.js";

dotenv.config();

const app = express();

app.use(cors());

// Stripe webhooks require the raw body — mount BEFORE express.json()
app.use("/api/invest/webhook", express.raw({ type: "application/json" }));

app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/pools", poolsRoutes);
app.use("/api/cows", cowsRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/investors", investorsRoutes); // per-investor dashboard + holdings
app.use("/api/invest",    investRoutes);    // POST buy-tokens form
app.use("/api/feedlot",  feedlotsRoutes);  // feedlot claim + dashboard
app.use("/api/auth",     authRoutes);      // login
app.use("/api/users",    usersRoutes);     // user list by role
app.use("/api/rancher", rancherRoutes);
app.use("/api/herds", herdsRoutes);
app.use("/api/herds", offeringRoutes);
app.use("/api/cattle", cattleRoutes);
app.use("/api/blockchain", blockchainRoutes);
app.use("/api/settlement", settlementRoutes);
app.use("/api/expenses", expensesRoutes);
app.use("/api/lrp", lrpRoutes);
app.use("/api/fees", feesRoutes);
app.use("/api/funds", fundsRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ status: "ok", dbTime: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});