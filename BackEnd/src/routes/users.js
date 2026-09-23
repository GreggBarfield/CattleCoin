import express from "express";
import pool from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

// ─── GET /api/users ───────────────────────────────────────────────────────────
// Query params: ?role=investor|rancher|feedlot|admin
// Requires login (E7): this used to be reachable with no token at all and
// returned every account's email address. Any logged-in user can still look
// up slugs by role (ranchers use this to pick a CattleCoin feedlot buyer on
// a sale; admins use it for the investor picker on Fee setup) - only the
// email field is gone, since nothing in the app reads it and it never
// needed to leave the server.
router.get("/", requireAuth, async (req, res) => {
  try {
    const { role } = req.query;
    const validRoles = ["investor", "rancher", "feedlot", "admin"];

    let query = "SELECT user_id, slug, role FROM users";
    const params = [];

    if (role) {
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` });
      }
      query += " WHERE role = $1::user_role";
      params.push(role);
    }

    query += " ORDER BY slug";

    const result = await pool.query(query, params);
    res.json(result.rows.map((r) => ({
      userId: r.user_id,
      slug:   r.slug,
      role:   r.role,
    })));
  } catch (err) {
    console.error("GET /api/users error:", err.message);
    res.status(500).json({ error: "Failed to fetch users", detail: err.message });
  }
});

export default router;
