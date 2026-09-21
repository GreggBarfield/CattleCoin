import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();

function isNumericId(value) {
  return /^\d+$/.test(String(value));
}

router.get("/:cowId/weights", async (req, res) => {
  const { cowId } = req.params;
  if (!isNumericId(cowId)) {
    return res.status(400).json({ error: "Invalid cowId. Expected a numeric id." });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        weight_id,
        animal_id AS cow_id,
        weight_date,
        weight_lbs::float8 AS weight_lbs,
        weight_type,
        location_code,
        created_at
      FROM animal_weights
      WHERE animal_id = $1
      ORDER BY weight_date DESC, created_at DESC
      `,
      [cowId]
    );

    return res.json({
      cowId,
      count: result.rowCount,
      items: result.rows,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch cow weights." });
  }
});

router.get("/:cowId/health", async (req, res) => {
  const { cowId } = req.params;
  if (!isNumericId(cowId)) {
    return res.status(400).json({ error: "Invalid cowId. Expected a numeric id." });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        health_record_id,
        cow_id,
        vaccine_name,
        administration_date,
        health_program_name,
        certification_number,
        verified_flag,
        created_at
      FROM cow_health
      WHERE cow_id = $1
      ORDER BY COALESCE(administration_date, created_at::date) DESC, created_at DESC
      `,
      [cowId]
    );

    return res.json({
      cowId,
      count: result.rowCount,
      items: result.rows,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch cow health records." });
  }
});

router.get("/:cowId", async (req, res) => {
  const { cowId } = req.params;
  if (!isNumericId(cowId)) {
    return res.status(400).json({ error: "Invalid cowId. Expected a numeric id." });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        a.animal_id AS cow_id,
        a.herd_id,
        a.registration_number,
        a.official_id,
        a.animal_name,
        a.breed_code,
        a.sex_code,
        a.birth_date,
        a.sire_registration_number,
        a.dam_registration_number,
        a.is_genomic_enhanced,
        a.created_at,
        a.updated_at,
        h.herd_name,
        h.rancher_id,
        latest_weight.weight_lbs::float8 AS latest_weight_lbs,
        latest_weight.weight_date AS latest_weight_date,
        latest_health.verified_flag AS latest_health_verified,
        latest_health.vaccine_name AS latest_vaccine_name,
        latest_health.health_program_name AS latest_health_program_name,
        latest_health.administration_date AS latest_health_date,
        latest_valuation.listing_value::float8 AS latest_listing_value,
        latest_valuation.fair_value::float8 AS latest_fair_value,
        latest_valuation.valuation_date AS latest_valuation_date
      FROM animals a
      LEFT JOIN herds h ON h.herd_id = a.herd_id
      LEFT JOIN LATERAL (
        SELECT aw.weight_lbs, aw.weight_date, aw.created_at
        FROM animal_weights aw
        WHERE aw.animal_id = a.animal_id
        ORDER BY aw.weight_date DESC, aw.created_at DESC
        LIMIT 1
      ) latest_weight ON TRUE
      LEFT JOIN LATERAL (
        SELECT ch.verified_flag, ch.vaccine_name, ch.health_program_name, ch.administration_date, ch.created_at
        FROM cow_health ch
        WHERE ch.cow_id = a.animal_id
        ORDER BY COALESCE(ch.administration_date, ch.created_at::date) DESC, ch.created_at DESC
        LIMIT 1
      ) latest_health ON TRUE
      LEFT JOIN LATERAL (
        SELECT cv.listing_value, cv.fair_value, cv.valuation_date
        FROM cow_valuation cv
        WHERE cv.cow_id = a.animal_id
        ORDER BY cv.valuation_date DESC, cv.created_at DESC
        LIMIT 1
      ) latest_valuation ON TRUE
      WHERE a.animal_id = $1
      `,
      [cowId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Cow not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch cow details." });
  }
});

// PATCH /api/cattle/:cowId requires a logged-in rancher/feedlot/admin, and
// (unless the caller is an admin) the cow's herd must belong to the caller.
// Security fix 2026-09-21: this route previously had no requireAuth and no
// ownership check at all - anyone who could reach the API and knew a cowId
// could edit any animal's record. See handoff-next-chat.md / technical
// reference section 13.3.
router.patch("/:cowId", requireAuth, requireRole("rancher", "feedlot", "admin"), async (req, res) => {
  const { cowId } = req.params;
  if (!isNumericId(cowId)) {
    return res.status(400).json({ error: "Invalid cowId. Expected a numeric id." });
  }

  try {
    const owner = await pool.query(
      `
      SELECT a.animal_id, h.rancher_id
      FROM animals a
      LEFT JOIN herds h ON h.herd_id = a.herd_id
      WHERE a.animal_id = $1
      `,
      [cowId]
    );

    if (owner.rowCount === 0) {
      return res.status(404).json({ error: "Cow not found." });
    }

    const rancherId = owner.rows[0].rancher_id;
    if (req.user.role !== "admin" && rancherId !== req.user.userId) {
      return res.status(403).json({ error: "Rancher is not allowed to edit this cow." });
    }
  } catch (error) {
    return res.status(500).json({ error: "Failed to verify cow ownership." });
  }

  const fields = [];
  const values = [];
  let next = 1;

  const mapping = [
    ["registrationNumber", "registration_number"],
    ["officialId", "official_id"],
    ["animalName", "animal_name"],
    ["breedCode", "breed_code"],
    ["sexCode", "sex_code"],
    ["birthDate", "birth_date"],
    ["sireRegistrationNumber", "sire_registration_number"],
    ["damRegistrationNumber", "dam_registration_number"],
    ["isGenomicEnhanced", "is_genomic_enhanced"],
  ];

  for (const [inputKey, dbColumn] of mapping) {
    if (Object.prototype.hasOwnProperty.call(req.body, inputKey)) {
      if (inputKey === "sexCode") {
        const sexCode = String(req.body[inputKey]).toUpperCase();
        if (!["B", "C", "H", "S"].includes(sexCode)) {
          return res.status(400).json({
            error: "Invalid sexCode. Expected one of B, C, H, S.",
          });
        }
        fields.push(`${dbColumn} = $${next}`);
        values.push(sexCode);
      } else {
        fields.push(`${dbColumn} = $${next}`);
        values.push(req.body[inputKey]);
      }
      next += 1;
    }
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: "No valid fields provided to update." });
  }

  values.push(cowId);

  try {
    const updated = await pool.query(
      `
      UPDATE animals
      SET
        ${fields.join(", ")},
        updated_at = NOW()
      WHERE animal_id = $${next}
      RETURNING *
      `,
      values
    );

    if (updated.rowCount === 0) {
      return res.status(404).json({ error: "Cow not found." });
    }

    return res.json({
      message: "Cow updated successfully.",
      cow: updated.rows[0],
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to update cow." });
  }
});

export default router;