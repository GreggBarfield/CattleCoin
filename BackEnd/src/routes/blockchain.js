import express from "express";
import { getBlockchainStatus } from "../blockchain/cattleNFT.js";

const router = express.Router();

// GET /api/blockchain/status — confirms the backend can reach the deployed
// CattleNFT contract on Polygon Amoy. Read-only, left public since every
// value returned here is already visible on PolygonScan.
router.get("/status", async (req, res) => {
  try {
    const status = await getBlockchainStatus();
    res.json(status);
  } catch (err) {
    console.error("GET /api/blockchain/status error:", err);
    res.status(500).json({ error: "Failed to reach blockchain contract", detail: err.message });
  }
});

export default router;