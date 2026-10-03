import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { sendError } from "../lib/routeHelpers.js";
import { getWalletView } from "../lib/walletView.js";

const router = express.Router();

// GET /api/my-wallet
// An investor's own wallet: address, network, and per lot how many tokens were
// bought, whether they were delivered, and what the wallet holds on-chain.
// Identity comes only from the login token. Read-only; never returns the key.
router.get("/", requireAuth, requireRole("investor"), async (req, res) => {
  try {
    return res.json(await getWalletView(pool, req.user.userId));
  } catch (err) {
    return sendError(res, "GET /api/my-wallet", err);
  }
});

export default router;
