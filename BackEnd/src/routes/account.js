import express from "express";
import bcrypt from "bcryptjs";
import pool from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

// Punch list fix #10 (D8): the logged-in user's own account page.
// Every route works on req.user.userId from the login token only - there is
// no way to read or change another account through here. Any role can use it.
//
//   GET  /api/account/me        name, email, role, member since, contact info
//   PUT  /api/account/me        change contact info (email stays view-only)
//   POST /api/account/password  change password (current password required)

const router = express.Router();
router.use(requireAuth);

// Contact fields a user may edit, with the longest value each column holds
// (matches 017_AccountProfile.sql). Keys are what the page sends.
const CONTACT_FIELDS = {
  fullName:     { column: "full_name",     max: 120, label: "Full name" },
  businessName: { column: "business_name", max: 160, label: "Business or ranch name" },
  phone:        { column: "phone",         max: 40,  label: "Phone" },
  addressLine1: { column: "address_line1", max: 160, label: "Address line 1" },
  addressLine2: { column: "address_line2", max: 160, label: "Address line 2" },
  city:         { column: "city",          max: 80,  label: "City" },
  state:        { column: "state",         max: 40,  label: "State" },
  postalCode:   { column: "postal_code",   max: 20,  label: "ZIP / postal code" },
};

// Digits, spaces and the usual phone punctuation, plus "x"/"ext" for an
// extension. Deliberately loose - it only stops obvious junk.
const PHONE_PATTERN = /^[0-9+().\-\s]*(?:(?:x|ext\.?)\s*[0-9]+)?$/i;

export const PASSWORD_MIN = 8;
// bcrypt only looks at the first 72 bytes of a password; refuse anything
// longer rather than silently ignoring the tail.
export const PASSWORD_MAX_BYTES = 72;

const SELECT_ACCOUNT = `
  SELECT user_id, slug, role, email, created_at,
         full_name, business_name, phone,
         address_line1, address_line2, city, state, postal_code,
         profile_updated_at
  FROM users
  WHERE user_id = $1`;

function toAccount(row) {
  return {
    userId:           row.user_id,
    username:         row.slug,
    role:             row.role,
    email:            row.email,
    memberSince:      row.created_at,
    profileUpdatedAt: row.profile_updated_at,
    fullName:         row.full_name,
    businessName:     row.business_name,
    phone:            row.phone,
    addressLine1:     row.address_line1,
    addressLine2:     row.address_line2,
    city:             row.city,
    state:            row.state,
    postalCode:       row.postal_code,
  };
}

// ---- GET /api/account/me ----------------------------------------------------
router.get("/me", async (req, res) => {
  try {
    const result = await pool.query(SELECT_ACCOUNT, [req.user.userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Account not found." });
    }
    res.json(toAccount(result.rows[0]));
  } catch (err) {
    console.error("GET /api/account/me error:", err);
    res.status(500).json({ error: "Could not load your account. Please try again." });
  }
});

// ---- PUT /api/account/me ----------------------------------------------------
// Body: any of the CONTACT_FIELDS keys. A key that is left out is left alone;
// a key sent as "" or null clears that field. Unknown keys (including email,
// role, username) are ignored - those can't be changed here.
router.put("/me", async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};

  const sets = [];
  const values = [];
  const problems = [];

  for (const [key, field] of Object.entries(CONTACT_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const raw = body[key];

    let value;
    if (raw === null || raw === undefined) {
      value = null;
    } else if (typeof raw === "string") {
      value = raw.trim();
      if (value === "") value = null;
    } else {
      problems.push(`${field.label} must be text.`);
      continue;
    }

    if (value !== null && value.length > field.max) {
      problems.push(`${field.label} can be at most ${field.max} characters.`);
      continue;
    }
    if (key === "phone" && value !== null && !PHONE_PATTERN.test(value)) {
      problems.push("Phone can only have digits, spaces and + ( ) - . characters.");
      continue;
    }

    values.push(value);
    sets.push(`${field.column} = $${values.length}`);
  }

  if (problems.length > 0) {
    return res.status(400).json({ error: problems.join(" ") });
  }
  if (sets.length === 0) {
    return res.status(400).json({ error: "Nothing to save." });
  }

  values.push(req.user.userId);
  try {
    const updated = await pool.query(
      `UPDATE users
          SET ${sets.join(", ")}, profile_updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $${values.length}
        RETURNING user_id`,
      values
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ error: "Account not found." });
    }
    const result = await pool.query(SELECT_ACCOUNT, [req.user.userId]);
    res.json(toAccount(result.rows[0]));
  } catch (err) {
    console.error("PUT /api/account/me error:", err);
    res.status(500).json({ error: "Could not save your changes. Please try again." });
  }
});

// ---- POST /api/account/password ---------------------------------------------
// Body: { currentPassword, newPassword }
// A wrong current password is a 400 (not 401) - the user is still logged in,
// they just typed the old password wrong.
router.post("/password", async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (typeof currentPassword !== "string" || currentPassword === "") {
    return res.status(400).json({ error: "Enter your current password." });
  }
  if (typeof newPassword !== "string" || newPassword.length < PASSWORD_MIN) {
    return res.status(400).json({ error: `New password must be at least ${PASSWORD_MIN} characters.` });
  }
  if (Buffer.byteLength(newPassword, "utf8") > PASSWORD_MAX_BYTES) {
    return res.status(400).json({ error: `New password can be at most ${PASSWORD_MAX_BYTES} characters.` });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: "New password must be different from your current password." });
  }

  try {
    const result = await pool.query(
      "SELECT password_hash FROM users WHERE user_id = $1",
      [req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Account not found." });
    }

    let matches = false;
    try {
      matches = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    } catch {
      matches = false; // a malformed stored hash just means "doesn't match"
    }
    if (!matches) {
      return res.status(400).json({ error: "Your current password is not correct." });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE user_id = $2",
      [newHash, req.user.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/account/password error:", err);
    res.status(500).json({ error: "Could not change your password. Please try again." });
  }
});

export default router;
