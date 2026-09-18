import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../db.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = "7d";

function signToken(user) {
  return jwt.sign(
    { userId: user.user_id, slug: user.slug, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// ─── POST /api/auth/login ────────────────────────────────────────────────────
// Body: { username: string, password: string }
//   username = user's slug
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  if (!JWT_SECRET) {
    console.error("JWT_SECRET is not set in the environment");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  try {
    const result = await pool.query(
      "SELECT user_id, slug, role, email, password_hash FROM users WHERE slug = $1",
      [username.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];
    const passwordOk = await bcrypt.compare(password, user.password_hash);

    if (!passwordOk) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signToken(user);

    res.json({
      token,
      userId: user.user_id,
      slug:   user.slug,
      role:   user.role,
      email:  user.email,
    });
  } catch (err) {
    console.error("POST /api/auth/login error:", err.message);
    res.status(500).json({ error: "Login failed", detail: err.message });
  }
});

// ─── POST /api/auth/signup ───────────────────────────────────────────────────
// Body: { username, email, password, role }
//   role must be one of: investor | rancher | feedlot  (no admin self-signup)
//   username becomes the slug
router.post("/signup", async (req, res) => {
  const { username, email, password, role } = req.body;

  if (!username || !email || !password || !role) {
    return res.status(400).json({ error: "username, email, password, and role are required" });
  }

  if (!JWT_SECRET) {
    console.error("JWT_SECRET is not set in the environment");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const allowedRoles = ["investor", "rancher", "feedlot"];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({
      error: `Invalid role. Allowed values: ${allowedRoles.join(", ")}`,
    });
  }

  const slug = username.trim().toLowerCase().replace(/\s+/g, "_");

  try {
    const existing = await pool.query(
      "SELECT user_id FROM users WHERE slug = $1 OR email = $2",
      [slug, email.trim()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Username or email already taken" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (role, email, password_hash, slug)
       VALUES ($1::user_role, $2, $3, $4)
       RETURNING user_id, slug, role, email`,
      [role, email.trim(), passwordHash, slug]
    );

    const user = result.rows[0];
    const token = signToken(user);

    res.status(201).json({
      token,
      userId: user.user_id,
      slug:   user.slug,
      role:   user.role,
      email:  user.email,
    });
  } catch (err) {
    console.error("POST /api/auth/signup error:", err.message);
    res.status(500).json({ error: "Sign up failed", detail: err.message });
  }
});

export default router;
