import express from "express";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { sendError } from "../lib/routeHelpers.js";
import { getInvestorMoney } from "../lib/investorMoney.js";

const router = express.Router();

// GET /api/my-money
// An investor's own money picture, straight from the ledger (not an estimate):
// what they paid in for each herd, where each herd stands (open, sale pending,
// sold), and what they have been paid or are still owed from a sale.
// Identity comes only from the login token. Whole cents throughout.
//
// The computation itself lives in lib/investorMoney.js (shared with
// GET /api/investors/:slug/portfolio and /holdings, which used to show
// fabricated numbers - see step-dashboard-real-numbers.md).
router.get("/", requireAuth, requireRole("investor"), async (req, res) => {
  const userId = req.user.userId;
  try {
    const { totals, herds } = await getInvestorMoney(userId);
    return res.json({
      asOfIso: new Date().toISOString(),
      totals,
      herds,
    });
  } catch (err) {
    return sendError(res, "GET /api/my-money", err);
  }
});

export default router;