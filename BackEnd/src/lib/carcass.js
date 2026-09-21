import { HttpError } from "./routeHelpers.js";

// Per-animal carcass grade records (plan step 9 remainder). Record-keeping
// only - this does not feed any payout yet. A record ties one real animal
// (by its own animal_id, or its EID/tag via officialId) to one carcass
// result: USDA quality grade, yield grade, hot carcass weight, and a few
// optional grid measurements. CattleCoin does not grade carcasses itself -
// this just records what the packer reported, same spirit as the LRP records
// (a real placeholder, `verified` stays false until an admin confirms it
// against the real packer sheet).
//
// Who may do what (same shape as costs.js/lrp.js):
//   read    admin, the herd's owner, and investors who hold shares in it
//   add     the herd's owner (a rancher or feedlot), or an admin - any time;
//           carcass sheets often arrive after a sale settles, so adding one
//           is never blocked by a pending or approved sale
//   change  the owner, only while no investor has bought in and only for
//           records they typed in themselves; after that, or always for an
//           admin, a reason is required
//   verify  admin only (`verified` flag)
// A record is never deleted. "Void" keeps the row, marked voided with a
// reason. Every change goes to a history table.

export const QUALITY_GRADES = ["Prime", "Choice", "Select", "Standard", "Utility", "Commercial", "Cutter", "Canner"];
const MAX_WEIGHT_LBS = 3000;

const num = (v, label, { min = null, max = null, decimals = 2 } = {}) => {
  if (v === undefined || v === null || v === "") return { present: false, value: null };
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number.`);
  if (min !== null && n < min) throw new HttpError(400, `${label} must be at least ${min}.`);
  if (max !== null && n > max) throw new HttpError(400, `${label} must be at most ${max}.`);
  const scale = 10 ** decimals;
  if (Math.abs(n * scale - Math.round(n * scale)) > 1e-6) {
    throw new HttpError(400, `${label} can have at most ${decimals} decimal place${decimals === 1 ? "" : "s"}.`);
  }
  return { present: true, value: n };
};

const isBlank = (v) => v === null || v === "";
const text = (v, max) => (isBlank(v) ? null : String(v).trim().slice(0, max) || null);

// Turns the request body into column values. Only fields that were sent are
// returned (so PUT can send just the one field being corrected). Sending
// null or "" clears an optional field.
export function parseCarcassFields(body) {
  const out = {};
  if (body.hotCarcassWeightLbs !== undefined) {
    const r = num(body.hotCarcassWeightLbs, "hotCarcassWeightLbs", { min: 1, max: MAX_WEIGHT_LBS, decimals: 2 });
    out.hot_carcass_weight_lbs = r.present ? r.value.toFixed(2) : null;
  }
  if (body.qualityGrade !== undefined) {
    if (isBlank(body.qualityGrade)) out.quality_grade = null;
    else {
      const g = String(body.qualityGrade).trim();
      if (!QUALITY_GRADES.includes(g)) throw new HttpError(400, `qualityGrade must be one of: ${QUALITY_GRADES.join(", ")}.`);
      out.quality_grade = g;
    }
  }
  if (body.yieldGrade !== undefined) {
    const r = num(body.yieldGrade, "yieldGrade", { min: 1.0, max: 5.9, decimals: 1 });
    out.yield_grade = r.present ? r.value.toFixed(1) : null;
  }
  if (body.dressingPct !== undefined) {
    const r = num(body.dressingPct, "dressingPct", { min: 0, max: 100, decimals: 2 });
    out.dressing_pct = r.present ? r.value.toFixed(2) : null;
  }
  if (body.backfatIn !== undefined) {
    const r = num(body.backfatIn, "backfatIn", { min: 0, max: 10, decimals: 2 });
    out.backfat_in = r.present ? r.value.toFixed(2) : null;
  }
  if (body.ribeyeAreaSqin !== undefined) {
    const r = num(body.ribeyeAreaSqin, "ribeyeAreaSqin", { min: 0, max: 50, decimals: 2 });
    out.ribeye_area_sqin = r.present ? r.value.toFixed(2) : null;
  }
  if (body.marblingScore !== undefined) out.marbling_score = text(body.marblingScore, 30);
  if (body.gridPremiumDiscount !== undefined) {
    const r = num(body.gridPremiumDiscount, "gridPremiumDiscount", { min: -999999, max: 999999, decimals: 2 });
    out.grid_premium_discount = r.present ? r.value.toFixed(2) : null;
  }
  return out;
}

export function shapeCarcassRecord(r) {
  return {
    recordId:             r.record_id,
    herdId:                r.herd_id,
    animalId:              r.animal_id,
    officialId:            r.official_id ?? null,
    saleId:                 r.sale_id ?? null,
    hotCarcassWeightLbs: r.hot_carcass_weight_lbs != null ? Number(r.hot_carcass_weight_lbs) : null,
    qualityGrade:         r.quality_grade ?? null,
    yieldGrade:            r.yield_grade != null ? Number(r.yield_grade) : null,
    dressingPct:           r.dressing_pct != null ? Number(r.dressing_pct) : null,
    backfatIn:              r.backfat_in != null ? Number(r.backfat_in) : null,
    ribeyeAreaSqin:       r.ribeye_area_sqin != null ? Number(r.ribeye_area_sqin) : null,
    marblingScore:        r.marbling_score ?? null,
    gridPremiumDiscount: r.grid_premium_discount != null ? Number(r.grid_premium_discount) : null,
    source:                  r.source,
    status:                  r.status,
    verified:                r.verified,
    createdBy:              r.created_by_slug ?? null,
    createdAt:              r.created_at,
    voidedAt:               r.voided_at ?? null,
    voidReason:            r.void_reason ?? null,
  };
}

export const snapshot = (r) => ({
  hotCarcassWeightLbs: r.hot_carcass_weight_lbs != null ? Number(r.hot_carcass_weight_lbs) : null,
  qualityGrade: r.quality_grade ?? null,
  yieldGrade: r.yield_grade != null ? Number(r.yield_grade) : null,
  dressingPct: r.dressing_pct != null ? Number(r.dressing_pct) : null,
  backfatIn: r.backfat_in != null ? Number(r.backfat_in) : null,
  ribeyeAreaSqin: r.ribeye_area_sqin != null ? Number(r.ribeye_area_sqin) : null,
  marblingScore: r.marbling_score ?? null,
  gridPremiumDiscount: r.grid_premium_discount != null ? Number(r.grid_premium_discount) : null,
  status: r.status,
});

// Can this person change (edit or void) this record right now?
// Returns { ok, status, message, reasonRequired }.
export function carcassChangeRule({ isAdmin, isOwner, locked, record }) {
  const no = (status, message) => ({ ok: false, status, message, reasonRequired: false });
  if (record.status !== "active") return no(409, "This record is already voided.");
  if (isAdmin) return { ok: true, reasonRequired: true };
  if (!isOwner) return no(403, "Only the herd's owner or an admin can change this record.");
  if (locked) {
    return no(403, "Investors have bought into this herd, so the owner can no longer change carcass records. Ask an admin for a correction (a reason is required).");
  }
  return { ok: true, reasonRequired: false };
}

export const CARCASS_SELECT = `
  c.record_id, c.herd_id, c.animal_id, c.sale_id, c.hot_carcass_weight_lbs, c.quality_grade,
  c.yield_grade, c.dressing_pct, c.backfat_in, c.ribeye_area_sqin, c.marbling_score,
  c.grid_premium_discount, c.source, c.status, c.verified, c.created_at, c.voided_at, c.void_reason,
  a.official_id, cu.slug AS created_by_slug
`;
export const CARCASS_FROM = `FROM carcass_records c
  LEFT JOIN animals a ON a.animal_id = c.animal_id
  LEFT JOIN users cu ON cu.user_id = c.created_by_user_id`;

export async function writeCarcassHistory(client, { recordId, herdId, action, userId, reason, before, after }) {
  await client.query(
    `INSERT INTO carcass_record_history (record_id, herd_id, action, changed_by_user_id, reason, before_values, after_values)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [recordId, herdId, action, userId ?? null, reason || null,
     before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]
  );
}

// Resolve the animal this record is for, and confirm it currently belongs to
// this herd. Accepts either animalId (animals.animal_id) or officialId (the
// EID/tag/tattoo). Call inside a transaction with the animal row locked.
export async function resolveHerdAnimal(client, herdId, { animalId, officialId }) {
  if (animalId === undefined && officialId === undefined) {
    throw new HttpError(400, "Send animalId or officialId to say which animal this record is for.");
  }
  let r;
  if (animalId !== undefined && animalId !== null && animalId !== "") {
    const id = Number(animalId);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "animalId must be a positive whole number.");
    r = await client.query("SELECT animal_id, herd_id, official_id FROM animals WHERE animal_id = $1 FOR UPDATE", [id]);
  } else {
    const tag = String(officialId).trim();
    if (!tag) throw new HttpError(400, "officialId cannot be blank.");
    r = await client.query("SELECT animal_id, herd_id, official_id FROM animals WHERE herd_id = $1 AND official_id = $2 FOR UPDATE", [herdId, tag]);
  }
  if (r.rowCount === 0) throw new HttpError(404, "Animal not found.");
  const animal = r.rows[0];
  if (animal.herd_id !== herdId) {
    throw new HttpError(400, "That animal is not currently in this herd.");
  }
  return animal;
}