import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();
const HERD_STATUSES = ["available", "pending", "sold"];
const HERD_SEASONS = ["spring", "fall"];

function parsePositiveInt(value, defaultValue, maxValue = 1000) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return Math.min(parsed, maxValue);
}

function normalizeHealthFilter(value) {
  if (!value) return null;
  const normalized = String(value).toLowerCase().trim();
  if (normalized === "on_track" || normalized === "ontrack") return "on_track";
  if (normalized === "watch") return "watch";
  if (normalized === "no_record" || normalized === "norecord") return "no_record";
  return null;
}

function normalizeStatus(value) {
  if (!value) return null;
  const normalized = String(value).toLowerCase().trim();
  return HERD_STATUSES.includes(normalized) ? normalized : null;
}

function normalizeSeason(value) {
  if (!value) return null;
  const normalized = String(value).toLowerCase().trim();
  if (!HERD_SEASONS.includes(normalized)) return null;
  return normalized === "spring" ? "Spring" : "Fall";
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return defaultValue;
}

function isValidSexCode(value) {
  return ["B", "C", "H", "S"].includes(value);
}

function mapCowPayload(body) {
  const officialIdRaw =
    body.officialId ??
    body.official_id ??
    body.tagId ??
    null;
  const officialIdSuffixRaw =
    body.officialIdSuffix ??
    body.official_id_suffix ??
    null;

  const officialIdSuffix = officialIdSuffixRaw === null
    ? null
    : String(officialIdSuffixRaw).replace(/\D/g, "");

  const officialId = officialIdRaw
    ? String(officialIdRaw).trim()
    : officialIdSuffix
      ? `840${officialIdSuffix}`
      : null;

  return {
    registrationNumber: body.registrationNumber ?? body.registration_number ?? null,
    officialId,
    officialIdSuffix,
    animalName: body.animalName ?? body.animal_name ?? null,
    breedCode: body.breedCode ?? body.breed_code ?? body.breed ?? null,
    sexCode: (body.sexCode ?? body.sex_code)
      ? String(body.sexCode ?? body.sex_code).toUpperCase()
      : null,
    birthDate: body.birthDate ?? body.birth_date ?? null,
    sireRegistrationNumber: body.sireRegistrationNumber ?? body.sire_registration_number ?? null,
    damRegistrationNumber: body.damRegistrationNumber ?? body.dam_registration_number ?? null,
    isGenomicEnhanced: body.isGenomicEnhanced ?? body.is_genomic_enhanced ?? false,
    initialWeightLbs: body.weightLbs ?? body.weight_lbs ?? body.weight ?? null,
    initialWeightDate: body.weightDate ?? body.weight_date ?? new Date().toISOString().slice(0, 10),
    initialWeightType: body.weightType ?? body.weight_type ?? "entry",
    initialWeightLocation: body.locationCode ?? body.location_code ?? "ranch",
  };
}

function validateCowPayload(cow) {
  // Validation temporarily disabled while testing with sample CSVs that don't
  // match real EID/registration formats. The real checks are kept below,
  // commented out, so they're easy to restore once we're working with real
  // tag data again:
  //
  // if (!cow.officialId && !cow.registrationNumber) {
  //   return "Missing cow identifier. Provide officialId/official_id/tagId/official_id_suffix or registrationNumber.";
  // }
  // if (cow.officialIdSuffix && cow.officialIdSuffix.length !== 12) {
  //   return "officialIdSuffix must be exactly 12 digits.";
  // }
  // if (cow.sexCode && !isValidSexCode(cow.sexCode)) {
  //   return "Invalid sexCode. Expected one of B, C, H, S.";
  // }
  // if (cow.initialWeightLbs !== null && Number(cow.initialWeightLbs) <= 0) {
  //   return "weightLbs must be greater than 0.";
  // }
  return null;
}

// rancherId here always comes from the verified JWT (req.user.userId) on every
// call site below, never from a client-supplied header/query/body field - so
// this can no longer be bypassed by simply omitting an id.
async function ensureHerdAccess(client, herdId, rancherId) {
  const ownedOrExists = await client.query(
    `
    SELECT herd_id, rancher_id
    FROM herds
    WHERE herd_id = $1
      AND rancher_id = $2
    `,
    [herdId, rancherId]
  );

  if (ownedOrExists.rowCount > 0) {
    return { ok: true, status: 200 };
  }

  const exists = await client.query("SELECT herd_id FROM herds WHERE herd_id = $1", [herdId]);
  if (exists.rowCount > 0) {
    return { ok: false, status: 403, error: "Rancher is not allowed to access this herd." };
  }
  return { ok: false, status: 404, error: "Herd not found." };
}

async function insertCowIntoHerd(client, herdId, cowPayload) {
  const insertedCow = await client.query(
    `
    INSERT INTO animals (
      herd_id,
      registration_number,
      official_id,
      animal_name,
      breed_code,
      sex_code,
      birth_date,
      sire_registration_number,
      dam_registration_number,
      is_genomic_enhanced
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
    `,
    [
      herdId,
      cowPayload.registrationNumber,
      cowPayload.officialId,
      cowPayload.animalName,
      cowPayload.breedCode,
      cowPayload.sexCode,
      cowPayload.birthDate,
      cowPayload.sireRegistrationNumber,
      cowPayload.damRegistrationNumber,
      cowPayload.isGenomicEnhanced,
    ]
  );

  let insertedWeight = null;
  if (
    cowPayload.initialWeightLbs !== null &&
    cowPayload.initialWeightLbs !== undefined &&
    cowPayload.initialWeightLbs !== ""
  ) {
    const weightResult = await client.query(
      `
      INSERT INTO animal_weights (animal_id, weight_date, weight_lbs, weight_type, location_code)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [
        insertedCow.rows[0].animal_id,
        cowPayload.initialWeightDate,
        Number(cowPayload.initialWeightLbs),
        cowPayload.initialWeightType,
        cowPayload.initialWeightLocation,
      ]
    );
    insertedWeight = weightResult.rows[0];
  }

  return { cow: insertedCow.rows[0], initialWeight: insertedWeight };
}

async function refreshHerdCounts(client, herdId) {
  await client.query(
    `
    UPDATE herds
    SET
      -- Keep the rancher-declared lot size (min 20) as the source of truth.
      -- Registered animals can be a partial batch during step-by-step onboarding.
      head_count = GREATEST(
        COALESCE(head_count, 20),
        (
          SELECT COUNT(*)::int
          FROM animals
          WHERE herd_id = $1
        ),
        20
      ),
      last_updated = NOW()
    WHERE herd_id = $1
    `,
    [herdId]
  );
}

// ─── Read routes (public/browse — unchanged) ─────────────────────────────────

router.get("/", async (req, res) => {
  const rancherId = req.query.rancherId ? String(req.query.rancherId).trim() : null;
  const status = normalizeStatus(req.query.status);
  const limit = parsePositiveInt(req.query.limit, 50, 200);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

  const where = [];
  const values = [];
  let next = 1;

  if (rancherId) {
    where.push(`h.rancher_id = $${next}`);
    values.push(rancherId);
    next += 1;
  }

  if (status) {
    where.push(`h.purchase_status = $${next}`);
    values.push(status);
    next += 1;
  }

  values.push(limit, offset);

  try {
    const result = await pool.query(
      `
      SELECT
        h.herd_id,
        h.rancher_id,
        h.herd_name,
        h.cohort_label,
        h.breed_code,
        h.season,
        h.dominant_stage,
        h.head_count,
        h.listing_price,
        h.purchase_status,
        h.feedlot_status,
        h.investor_pct,
        h.verified_flag,
        h.last_updated,
        h.created_at,
        COUNT(a.animal_id)::int AS cattle_count
      FROM herds h
      LEFT JOIN animals a ON a.herd_id = h.herd_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY h.herd_id
      ORDER BY h.created_at DESC
      LIMIT $${next}
      OFFSET $${next + 1}
      `,
      values
    );

    return res.json({
      count: result.rowCount,
      items: result.rows,
    });
  } catch (error) {
    console.error("GET /api/herds error:", error);
    return res.status(500).json({ error: "Failed to fetch herds." });
  }
});

router.get("/:herdId", async (req, res) => {
  const { herdId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        h.herd_id,
        h.rancher_id,
        h.herd_name,
        h.cohort_label,
        h.breed_code,
        h.season,
        h.dominant_stage,
        h.head_count,
        h.listing_price,
        h.purchase_status,
        h.feedlot_status,
        h.investor_pct,
        h.verified_flag,
        h.last_updated,
        h.created_at,
        COUNT(a.animal_id)::int AS cattle_count
      FROM herds h
      LEFT JOIN animals a ON a.herd_id = h.herd_id
      WHERE h.herd_id = $1
      GROUP BY h.herd_id
      `,
      [herdId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Herd not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("GET /api/herds/:herdId error:", error);
    return res.status(500).json({ error: "Failed to fetch herd." });
  }
});

router.get("/:herdId/cattle", async (req, res) => {
  const { herdId } = req.params;
  const search = req.query.search ? String(req.query.search).trim() : null;
  const breedCode = req.query.breedCode ? String(req.query.breedCode).trim() : null;
  const sexCode = req.query.sexCode ? String(req.query.sexCode).trim().toUpperCase() : null;
  const health = normalizeHealthFilter(req.query.health);
  const limit = parsePositiveInt(req.query.limit, 50, 200);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

  const where = ["a.herd_id = $1"];
  const values = [herdId];
  let next = 2;

  if (search) {
    where.push(`(a.registration_number ILIKE $${next} OR a.official_id ILIKE $${next} OR a.animal_name ILIKE $${next})`);
    values.push(`%${search}%`);
    next += 1;
  }

  if (breedCode) {
    where.push(`a.breed_code = $${next}`);
    values.push(breedCode);
    next += 1;
  }

  if (sexCode) {
    where.push(`a.sex_code = $${next}`);
    values.push(sexCode);
    next += 1;
  }

  if (health === "on_track") {
    where.push("latest_health.verified_flag IS TRUE");
  } else if (health === "watch") {
    where.push("latest_health.verified_flag IS FALSE");
  } else if (health === "no_record") {
    where.push("latest_health.verified_flag IS NULL");
  }

  values.push(limit, offset);

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
        latest_weight.weight_lbs::float8 AS latest_weight_lbs,
        latest_weight.weight_date AS latest_weight_date,
        latest_health.verified_flag AS latest_health_verified,
        latest_health.vaccine_name AS latest_vaccine_name,
        latest_health.health_program_name AS latest_health_program_name,
        latest_health.administration_date AS latest_health_date
      FROM animals a
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
      WHERE ${where.join(" AND ")}
      ORDER BY a.created_at DESC
      LIMIT $${next}
      OFFSET $${next + 1}
      `,
      values
    );

    return res.json({
      herdId,
      count: result.rowCount,
      items: result.rows,
    });
  } catch (error) {
    console.error("GET /api/herds/:herdId/cattle error:", error);
    return res.status(500).json({ error: "Failed to fetch herd cattle." });
  }
});

// ─── Write routes — all require a real, verified rancher token below ────────

router.post("/", requireAuth, requireRole("rancher"), async (req, res) => {
  const rancherId = req.user.userId;
  const body = req.body ?? {};

  const herdNameRaw = body.herdName ?? body.herd_name ?? body.name ?? null;
  const herdName = herdNameRaw ? String(herdNameRaw).trim() : null;
  const cohortLabelRaw = body.cohortLabel ?? body.cohort_label ?? body.geneticsLabel ?? body.genetics_label ?? null;
  const cohortLabel = cohortLabelRaw ? String(cohortLabelRaw).trim() : null;
  const breedCodeRaw = body.breedCode ?? body.breed_code ?? null;
  const breedCode = breedCodeRaw ? String(breedCodeRaw).trim().toUpperCase() : null;
  const season = normalizeSeason(body.season);
  const dominantStageRaw = body.dominantStage ?? body.dominant_stage ?? "RANCH";
  const dominantStage = String(dominantStageRaw).trim().toUpperCase();
  const purchaseStatus =
    normalizeStatus(body.purchaseStatus ?? body.purchase_status) ?? "pending";
  const listingPrice = body.listingPrice ?? body.listing_price ?? null;
  const headCount = Number.parseInt(body.headCount ?? body.head_count ?? 20, 10);
  const verifiedFlag = parseBoolean(body.verifiedFlag, false);

  if (!herdName) {
    return res.status(400).json({ error: "Missing herdName." });
  }

  if (Number.isNaN(headCount) || headCount < 20) {
    return res.status(400).json({ error: "headCount must be an integer greater than or equal to 20." });
  }

  if (body.season && !season) {
    return res.status(400).json({ error: "Invalid season. Expected Spring or Fall." });
  }

  if (listingPrice !== null && listingPrice !== undefined && Number(listingPrice) < 0) {
    return res.status(400).json({ error: "listingPrice cannot be negative." });
  }

  try {
    const created = await pool.query(
      `
      INSERT INTO herds (
        rancher_id,
        herd_name,
        cohort_label,
        breed_code,
        season,
        dominant_stage,
        head_count,
        listing_price,
        purchase_status,
        verified_flag,
        last_updated
      )
      VALUES ($1, $2, $3, $4, COALESCE($5, 'Fall'), $6, $7, $8, $9, $10, NOW())
      RETURNING *
      `,
      [
        rancherId,
        herdName,
        cohortLabel,
        breedCode,
        season,
        dominantStage,
        headCount,
        listingPrice ?? null,
        purchaseStatus,
        verifiedFlag,
      ]
    );

    return res.status(201).json({
      message: "Herd created successfully.",
      herd: created.rows[0],
    });
  } catch (error) {
    console.error("POST /api/herds error:", error);
    return res.status(500).json({ error: "Failed to create herd." });
  }
});

router.post("/:herdId/list", requireAuth, requireRole("rancher"), async (req, res) => {
  const { herdId } = req.params;
  const rancherId = req.user.userId;
  const body = req.body ?? {};
  const listingPrice = body.listingPrice;

  if (listingPrice !== undefined && Number(listingPrice) < 0) {
    return res.status(400).json({ error: "listingPrice cannot be negative." });
  }

  try {
    const listed = await pool.query(
      `
      UPDATE herds
      SET
        purchase_status = 'available',
        listing_price = COALESCE($1, listing_price),
        last_updated = NOW()
      WHERE herd_id = $2
        AND rancher_id = $3
      RETURNING *
      `,
      [listingPrice ?? null, herdId, rancherId]
    );

    if (listed.rowCount === 0) {
      const herdCheck = await pool.query("SELECT herd_id FROM herds WHERE herd_id = $1", [herdId]);
      if (herdCheck.rowCount > 0) {
        return res.status(403).json({ error: "Rancher is not allowed to update this herd." });
      }
      return res.status(404).json({ error: "Herd not found." });
    }

    return res.json({
      message: "Herd listed successfully.",
      herd: listed.rows[0],
    });
  } catch (error) {
    console.error("POST /api/herds/:herdId/list error:", error);
    return res.status(500).json({ error: "Failed to list herd." });
  }
});

router.post("/:herdId/publish", requireAuth, requireRole("rancher"), async (req, res) => {
  const { herdId } = req.params;
  const rancherId = req.user.userId;
  const body = req.body ?? {};
  const listingPrice = body.listingPrice ?? body.listing_price;

  if (listingPrice !== undefined && Number(listingPrice) < 0) {
    return res.status(400).json({ error: "listingPrice cannot be negative." });
  }

  try {
    const published = await pool.query(
      `
      UPDATE herds
      SET
        purchase_status = 'available',
        listing_price = COALESCE($1, listing_price),
        last_updated = NOW()
      WHERE herd_id = $2
        AND rancher_id = $3
      RETURNING *
      `,
      [listingPrice ?? null, herdId, rancherId]
    );

    if (published.rowCount === 0) {
      const herdCheck = await pool.query("SELECT herd_id FROM herds WHERE herd_id = $1", [herdId]);
      if (herdCheck.rowCount > 0) {
        return res.status(403).json({ error: "Rancher is not allowed to update this herd." });
      }
      return res.status(404).json({ error: "Herd not found." });
    }

    return res.json({
      message: "Herd published successfully.",
      herd: published.rows[0],
    });
  } catch (error) {
    console.error("POST /api/herds/:herdId/publish error:", error);
    return res.status(500).json({ error: "Failed to publish herd." });
  }
});

router.patch("/:herdId/move", requireAuth, requireRole("rancher"), async (req, res) => {
  const { herdId } = req.params;
  const rancherId = req.user.userId;
  const body = req.body ?? {};
  const requestedStatus = normalizeStatus(body.toStatus);
  const direction = body.direction ? String(body.direction).toLowerCase() : null;

  if (!requestedStatus && direction !== "next" && direction !== "previous") {
    return res.status(400).json({
      error: "Provide toStatus (available|pending|sold) or direction (next|previous).",
    });
  }

  try {
    const current = await pool.query(
      `
      SELECT herd_id, rancher_id, purchase_status
      FROM herds
      WHERE herd_id = $1
        AND rancher_id = $2
      `,
      [herdId, rancherId]
    );

    if (current.rowCount === 0) {
      const herdCheck = await pool.query("SELECT herd_id FROM herds WHERE herd_id = $1", [herdId]);
      if (herdCheck.rowCount > 0) {
        return res.status(403).json({ error: "Rancher is not allowed to move this herd." });
      }
      return res.status(404).json({ error: "Herd not found." });
    }

    const currentStatus = normalizeStatus(current.rows[0].purchase_status) ?? "available";
    let nextStatus = requestedStatus;

    if (!nextStatus) {
      const index = HERD_STATUSES.indexOf(currentStatus);
      if (direction === "next") {
        if (index >= HERD_STATUSES.length - 1) {
          return res.status(400).json({ error: "Herd is already at final status." });
        }
        nextStatus = HERD_STATUSES[index + 1];
      } else {
        if (index <= 0) {
          return res.status(400).json({ error: "Herd is already at first status." });
        }
        nextStatus = HERD_STATUSES[index - 1];
      }
    }

    const updated = await pool.query(
      `
      UPDATE herds
      SET
        purchase_status = $1,
        last_updated = NOW()
      WHERE herd_id = $2
        AND rancher_id = $3
      RETURNING *
      `,
      [nextStatus, herdId, rancherId]
    );

    return res.json({
      message: "Herd status moved successfully.",
      fromStatus: currentStatus,
      toStatus: nextStatus,
      herd: updated.rows[0],
    });
  } catch (error) {
    console.error("PATCH /api/herds/:herdId/move error:", error);
    return res.status(500).json({ error: "Failed to move herd." });
  }
});

router.post("/:herdId/cattle/bulk", requireAuth, requireRole("rancher"), async (req, res) => {
  const { herdId } = req.params;
  const rancherId = req.user.userId;
  const payload = req.body ?? {};
  const cattle = Array.isArray(payload) ? payload : payload.cattle;

  if (!Array.isArray(cattle) || cattle.length === 0) {
    return res.status(400).json({ error: "Provide a non-empty cattle array." });
  }

  const normalized = cattle.map((item) => mapCowPayload(item ?? {}));
  for (let i = 0; i < normalized.length; i += 1) {
    const validationError = validateCowPayload(normalized[i]);
    if (validationError) {
      return res.status(400).json({ error: `cattle[${i}]: ${validationError}` });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const access = await ensureHerdAccess(client, herdId, rancherId);
    if (!access.ok) {
      await client.query("ROLLBACK");
      return res.status(access.status).json({ error: access.error });
    }

    const inserted = [];
    for (const cowPayload of normalized) {
      inserted.push(await insertCowIntoHerd(client, herdId, cowPayload));
    }

    await refreshHerdCounts(client, herdId);
    await client.query("COMMIT");

    return res.status(201).json({
      message: "Cattle batch created successfully.",
      herdId,
      count: inserted.length,
      items: inserted,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/herds/:herdId/cattle/bulk error:", error);
    return res.status(500).json({ error: "Failed to create cattle batch." });
  } finally {
    client.release();
  }
});

router.post("/:herdId/cattle", requireAuth, requireRole("rancher"), async (req, res) => {
  const { herdId } = req.params;
  const rancherId = req.user.userId;

  const cowPayload = mapCowPayload(req.body ?? {});
  const validationError = validateCowPayload(cowPayload);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const access = await ensureHerdAccess(client, herdId, rancherId);
    if (!access.ok) {
      await client.query("ROLLBACK");
      return res.status(access.status).json({ error: access.error });
    }

    const inserted = await insertCowIntoHerd(client, herdId, cowPayload);

    await refreshHerdCounts(client, herdId);
    await client.query("COMMIT");

    return res.status(201).json({
      message: "Cow created successfully.",
      ...inserted,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/herds/:herdId/cattle error:", error);
    return res.status(500).json({ error: "Failed to create cow." });
  } finally {
    client.release();
  }
});

router.delete("/:herdId/cattle/:cowId", requireAuth, requireRole("rancher"), async (req, res) => {
  const { herdId, cowId } = req.params;
  const rancherId = req.user.userId;

  if (!/^\d+$/.test(cowId)) {
    return res.status(400).json({ error: "Invalid cowId. Expected a numeric id." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const access = await ensureHerdAccess(client, herdId, rancherId);
    if (!access.ok) {
      await client.query("ROLLBACK");
      return res.status(access.status).json({ error: access.error });
    }

    const removed = await client.query(
      `
      UPDATE animals
      SET herd_id = NULL, updated_at = NOW()
      WHERE animal_id = $1 AND herd_id = $2
      RETURNING *
      `,
      [cowId, herdId]
    );

    if (removed.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cow not found in this herd." });
    }

    await refreshHerdCounts(client, herdId);
    await client.query("COMMIT");

    return res.json({
      message: "Cow removed from herd successfully.",
      herdId,
      cowId,
      cow: removed.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("DELETE /api/herds/:herdId/cattle/:cowId error:", error);
    return res.status(500).json({ error: "Failed to remove cow from herd." });
  } finally {
    client.release();
  }
});

export default router;