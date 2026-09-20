import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { HttpError, isUuid, withTransaction, sendError } from "../lib/routeHelpers.js";
import {
  shapeTerms, loadDefaults, loadHerdTerms, parseTermsInput, writeAudit, getFundsPosition, shapeFunds,
} from "../lib/feeTerms.js";

const router = express.Router();

// Fee setup. Admin sets the platform defaults, then the terms for each herd
// (copied from the defaults, then adjusted deal by deal), and can give an
// individual investor a different exit profit fee.
//
// Every fee starts at 0 (a placeholder). See lib/feeTerms.js for what each fee
// means. Once a herd's first investor buys, or money is released, the herd's
// terms are locked: they can be lowered (a discount) but never raised, and the
// timing/payer cannot change - the terms the investors saw are the terms that
// apply.

const noteOf = (body) => (body?.note ? String(body.note).trim().slice(0, 255) : null);

const termsValues = (row) => ({
  raiseFeePct:      Number(row.raise_fee_pct),
  exitProfitFeePct: Number(row.exit_profit_fee_pct),
  exitFeePayer:     row.exit_fee_payer,
  perHeadFee:       Number(row.per_head_fee),
  perHeadFeeTiming: row.per_head_fee_timing,
});

// --- GET /api/fees/defaults --------------------------------------------------
router.get("/defaults", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const row = await loadDefaults(pool);
    return res.json({ defaults: shapeTerms(row) });
  } catch (err) {
    return sendError(res, "GET /api/fees/defaults", err);
  }
});

// --- PUT /api/fees/defaults --------------------------------------------------
// Body (any of): raiseFeePct, exitProfitFeePct, exitFeePayer, perHeadFee, perHeadFeeTiming
// Changes the starting point for herds set up from now on. Herds that already
// have their own terms are not touched.
router.put("/defaults", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const out = await withTransaction(async (client) => {
      const before = await client.query("SELECT * FROM platform_fee_defaults WHERE id = 1 FOR UPDATE");
      if (before.rowCount === 0) throw new HttpError(500, "Platform fee defaults are missing - run migration 010.");
      const v = parseTermsInput(req.body, before.rows[0]);
      const after = await client.query(
        `UPDATE platform_fee_defaults
            SET raise_fee_pct = $1, exit_profit_fee_pct = $2, exit_fee_payer = $3,
                per_head_fee = $4, per_head_fee_timing = $5,
                updated_by_user_id = $6, updated_at = NOW()
          WHERE id = 1 RETURNING *`,
        [v.raise_fee_pct, v.exit_profit_fee_pct, v.exit_fee_payer, v.per_head_fee, v.per_head_fee_timing, req.user.userId]
      );
      await writeAudit(client, {
        action: "defaults_updated",
        oldValues: termsValues(before.rows[0]),
        newValues: termsValues(after.rows[0]),
        changedBy: req.user.userId,
      });
      return after.rows[0];
    });
    return res.json({ message: "Platform fee defaults updated.", defaults: shapeTerms(out) });
  } catch (err) {
    return sendError(res, "PUT /api/fees/defaults", err);
  }
});

// --- GET /api/fees/herds/:herdId ---------------------------------------------
// Admin, or the herd's owner (the producer sees the fees they will pay).
router.get("/herds/:herdId", requireAuth, async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  try {
    const herd = await pool.query(
      "SELECT herd_id, herd_name, head_count, rancher_id FROM herds WHERE herd_id = $1",
      [herdId]
    );
    if (herd.rowCount === 0) return res.status(404).json({ error: "Herd not found." });
    const h = herd.rows[0];
    const isAdmin = req.user.role === "admin";
    if (!isAdmin && h.rancher_id !== req.user.userId) {
      return res.status(403).json({ error: "You are not allowed to view these fee terms." });
    }

    const terms = await loadHerdTerms(pool, herdId);
    const body = {
      herdId: h.herd_id,
      herdName: h.herd_name,
      headCount: h.head_count != null ? Number(h.head_count) : null,
      termsSet: !!terms,
      locked: !!terms?.locked_at,
    };
    if (terms) {
      body.terms = shapeTerms(terms);
    } else {
      body.terms = null;
      body.defaultsThatWouldApply = shapeTerms(await loadDefaults(pool));
    }

    if (isAdmin) {
      const ov = await pool.query(
        `SELECT o.override_id, u.slug, o.herd_id, o.exit_profit_fee_pct, o.note
           FROM investor_fee_overrides o JOIN users u ON u.user_id = o.investor_user_id
          WHERE o.herd_id = $1 OR o.herd_id IS NULL
          ORDER BY u.slug`,
        [herdId]
      );
      body.investorOverrides = ov.rows.map((o) => ({
        overrideId: o.override_id, investorSlug: o.slug, herdId: o.herd_id,
        appliesTo: o.herd_id ? "this herd" : "all herds",
        exitProfitFeePct: Number(o.exit_profit_fee_pct), note: o.note,
      }));
      body.funds = shapeFunds(await getFundsPosition(pool, herdId));
    }
    return res.json(body);
  } catch (err) {
    return sendError(res, "GET /api/fees/herds/:herdId", err);
  }
});

// --- PUT /api/fees/herds/:herdId ---------------------------------------------
// Admin. Creates the herd's terms from the platform defaults on first use, then
// applies whatever the body changes. Body (any of): raiseFeePct, exitProfitFeePct,
// exitFeePayer, perHeadFee, perHeadFeeTiming, note
router.put("/herds/:herdId", requireAuth, requireRole("admin"), async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  try {
    const out = await withTransaction(async (client) => {
      const herd = await client.query("SELECT herd_id FROM herds WHERE herd_id = $1 FOR UPDATE", [herdId]);
      if (herd.rowCount === 0) throw new HttpError(404, "Herd not found.");

      const existing = await loadHerdTerms(client, herdId, { lock: true });
      const base = existing ?? (await loadDefaults(client));
      const v = parseTermsInput(req.body, base);

      if (existing?.locked_at) {
        const raised =
          v.raise_fee_pct > Number(existing.raise_fee_pct) ||
          v.exit_profit_fee_pct > Number(existing.exit_profit_fee_pct) ||
          v.per_head_fee > Number(existing.per_head_fee);
        const changedKind =
          v.per_head_fee_timing !== existing.per_head_fee_timing ||
          v.exit_fee_payer !== existing.exit_fee_payer;
        if (raised || changedKind) {
          throw new HttpError(
            409,
            "These fee terms are locked (an investor has bought in or money has been released). " +
              "Fees can be lowered, but not raised, and the timing and payer cannot change."
          );
        }
      }

      const note = req.body?.note !== undefined ? noteOf(req.body) : existing?.note ?? null;
      const saved = await client.query(
        `INSERT INTO herd_fee_terms
           (herd_id, raise_fee_pct, exit_profit_fee_pct, exit_fee_payer, per_head_fee, per_head_fee_timing, note, updated_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (herd_id) DO UPDATE
           SET raise_fee_pct = EXCLUDED.raise_fee_pct,
               exit_profit_fee_pct = EXCLUDED.exit_profit_fee_pct,
               exit_fee_payer = EXCLUDED.exit_fee_payer,
               per_head_fee = EXCLUDED.per_head_fee,
               per_head_fee_timing = EXCLUDED.per_head_fee_timing,
               note = EXCLUDED.note,
               updated_by_user_id = EXCLUDED.updated_by_user_id,
               updated_at = NOW()
         RETURNING *`,
        [herdId, v.raise_fee_pct, v.exit_profit_fee_pct, v.exit_fee_payer, v.per_head_fee, v.per_head_fee_timing, note, req.user.userId]
      );
      await writeAudit(client, {
        action: existing ? "herd_terms_changed" : "herd_terms_created",
        herdId,
        oldValues: existing ? termsValues(existing) : null,
        newValues: { ...termsValues(saved.rows[0]), note },
        changedBy: req.user.userId,
      });
      return { row: saved.rows[0], created: !existing };
    });
    return res.status(out.created ? 201 : 200).json({
      message: out.created ? "Fee terms created for this herd." : "Fee terms updated.",
      terms: shapeTerms(out.row),
    });
  } catch (err) {
    return sendError(res, "PUT /api/fees/herds/:herdId", err);
  }
});

// Does this investor hold tokens in a herd whose terms are already locked?
// (Used to stop an investor's fee from being raised after they invested.)
async function hasLockedExposure(db, investorId, herdId) {
  const r = await db.query(
    `SELECT 1
       FROM ownership o
       JOIN token_pools tp ON tp.pool_id = o.pool_id
       JOIN herd_fee_terms t ON t.herd_id = tp.herd_id AND t.locked_at IS NOT NULL
      WHERE o.user_id = $1 AND o.token_amount > 0 AND ($2::uuid IS NULL OR tp.herd_id = $2)
      LIMIT 1`,
    [investorId, herdId]
  );
  return r.rowCount > 0;
}

// --- GET /api/fees/investor-overrides ----------------------------------------
// Admin. Optional ?investorSlug= and ?herdId=
router.get("/investor-overrides", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const params = [];
    const where = [];
    if (req.query.investorSlug) {
      params.push(String(req.query.investorSlug).toLowerCase());
      where.push(`u.slug = $${params.length}`);
    }
    if (req.query.herdId) {
      if (!isUuid(req.query.herdId)) return res.status(400).json({ error: "Invalid herdId." });
      params.push(req.query.herdId);
      where.push(`o.herd_id = $${params.length}`);
    }
    const r = await pool.query(
      `SELECT o.override_id, u.slug, o.herd_id, h.herd_name, o.exit_profit_fee_pct, o.note, o.updated_at
         FROM investor_fee_overrides o
         JOIN users u ON u.user_id = o.investor_user_id
         LEFT JOIN herds h ON h.herd_id = o.herd_id
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY u.slug, o.herd_id NULLS FIRST`,
      params
    );
    return res.json(
      r.rows.map((o) => ({
        overrideId: o.override_id, investorSlug: o.slug,
        herdId: o.herd_id, herdName: o.herd_name ?? null,
        appliesTo: o.herd_id ? "one herd" : "all herds",
        exitProfitFeePct: Number(o.exit_profit_fee_pct), note: o.note, updatedAt: o.updated_at,
      }))
    );
  } catch (err) {
    return sendError(res, "GET /api/fees/investor-overrides", err);
  }
});

// --- PUT /api/fees/investor-overrides ----------------------------------------
// Admin. Body: { investorSlug, herdId? (omit = all herds), exitProfitFeePct, note? }
// A different exit profit fee for one investor (a big investor, an early backer).
// Creates or replaces the matching override.
router.put("/investor-overrides", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body ?? {};
  const slug = body.investorSlug ? String(body.investorSlug).trim().toLowerCase() : "";
  if (!slug) return res.status(400).json({ error: "investorSlug is required." });
  if (body.herdId && !isUuid(body.herdId)) return res.status(400).json({ error: "Invalid herdId." });
  if (body.exitProfitFeePct === undefined) return res.status(400).json({ error: "exitProfitFeePct is required." });
  const herdId = body.herdId || null;

  try {
    const out = await withTransaction(async (client) => {
      const inv = await client.query("SELECT user_id FROM users WHERE slug = $1 AND role = 'investor'", [slug]);
      if (inv.rowCount === 0) throw new HttpError(404, `Investor not found: ${slug}`);
      const investorId = inv.rows[0].user_id;

      // validate with the same rules as herd terms
      const pct = parseTermsInput({ exitProfitFeePct: body.exitProfitFeePct },
        { raise_fee_pct: 0, exit_profit_fee_pct: 0, exit_fee_payer: "investor", per_head_fee: 0, per_head_fee_timing: "raise" }
      ).exit_profit_fee_pct;

      if (herdId) {
        const h = await client.query("SELECT herd_id FROM herds WHERE herd_id = $1", [herdId]);
        if (h.rowCount === 0) throw new HttpError(404, "Herd not found.");
        const terms = await loadHerdTerms(client, herdId);
        if (terms?.locked_at && pct > Number(terms.exit_profit_fee_pct)) {
          throw new HttpError(409, "This herd's terms are locked - an investor's fee cannot be set above the herd's exit profit fee.");
        }
      }

      const existing = await client.query(
        `SELECT * FROM investor_fee_overrides
          WHERE investor_user_id = $1 AND herd_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE`,
        [investorId, herdId]
      );
      const old = existing.rows[0] ?? null;
      if (old && pct > Number(old.exit_profit_fee_pct) && (await hasLockedExposure(client, investorId, herdId))) {
        throw new HttpError(409, "This investor already holds tokens under locked terms - their fee can be lowered, not raised.");
      }

      const note = noteOf(body);
      let saved;
      if (old) {
        saved = await client.query(
          `UPDATE investor_fee_overrides
              SET exit_profit_fee_pct = $2, note = $3, created_by_user_id = $4, updated_at = NOW()
            WHERE override_id = $1 RETURNING *`,
          [old.override_id, pct, note, req.user.userId]
        );
      } else {
        saved = await client.query(
          `INSERT INTO investor_fee_overrides (investor_user_id, herd_id, exit_profit_fee_pct, note, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [investorId, herdId, pct, note, req.user.userId]
        );
      }
      await writeAudit(client, {
        action: old ? "investor_override_changed" : "investor_override_created",
        herdId, investorUserId: investorId,
        oldValues: old ? { exitProfitFeePct: Number(old.exit_profit_fee_pct) } : null,
        newValues: { exitProfitFeePct: pct, note },
        changedBy: req.user.userId,
      });
      return { row: saved.rows[0], created: !old };
    });
    return res.status(out.created ? 201 : 200).json({
      message: out.created ? "Investor fee override created." : "Investor fee override updated.",
      override: {
        overrideId: out.row.override_id, investorSlug: slug, herdId: out.row.herd_id,
        appliesTo: out.row.herd_id ? "one herd" : "all herds",
        exitProfitFeePct: Number(out.row.exit_profit_fee_pct), note: out.row.note,
      },
    });
  } catch (err) {
    return sendError(res, "PUT /api/fees/investor-overrides", err);
  }
});

// --- DELETE /api/fees/investor-overrides/:overrideId -------------------------
router.delete("/investor-overrides/:overrideId", requireAuth, requireRole("admin"), async (req, res) => {
  const { overrideId } = req.params;
  if (!isUuid(overrideId)) return res.status(400).json({ error: "Invalid overrideId." });
  try {
    await withTransaction(async (client) => {
      const r = await client.query("SELECT * FROM investor_fee_overrides WHERE override_id = $1 FOR UPDATE", [overrideId]);
      if (r.rowCount === 0) throw new HttpError(404, "Override not found.");
      const o = r.rows[0];
      if (await hasLockedExposure(client, o.investor_user_id, o.herd_id)) {
        throw new HttpError(409, "This investor already holds tokens under locked terms - their fee cannot go back up. Lower it instead.");
      }
      await client.query("DELETE FROM investor_fee_overrides WHERE override_id = $1", [overrideId]);
      await writeAudit(client, {
        action: "investor_override_removed",
        herdId: o.herd_id, investorUserId: o.investor_user_id,
        oldValues: { exitProfitFeePct: Number(o.exit_profit_fee_pct) },
        changedBy: req.user.userId,
      });
    });
    return res.json({ message: "Investor fee override removed." });
  } catch (err) {
    return sendError(res, "DELETE /api/fees/investor-overrides/:overrideId", err);
  }
});

// --- GET /api/fees/audit -----------------------------------------------------
// Admin. Latest 200 fee changes. Optional ?herdId=
router.get("/audit", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const params = [];
    let where = "";
    if (req.query.herdId) {
      if (!isUuid(req.query.herdId)) return res.status(400).json({ error: "Invalid herdId." });
      params.push(req.query.herdId);
      where = "WHERE a.herd_id = $1";
    }
    const r = await pool.query(
      `SELECT a.audit_id, a.action, a.herd_id, a.investor_user_id, iu.slug AS investor_slug,
              a.old_values, a.new_values, cu.slug AS changed_by, a.changed_at
         FROM fee_audit_log a
         LEFT JOIN users iu ON iu.user_id = a.investor_user_id
         LEFT JOIN users cu ON cu.user_id = a.changed_by_user_id
        ${where}
        ORDER BY a.changed_at DESC LIMIT 200`,
      params
    );
    return res.json(
      r.rows.map((a) => ({
        auditId: a.audit_id, action: a.action, herdId: a.herd_id,
        investorSlug: a.investor_slug ?? null,
        oldValues: a.old_values, newValues: a.new_values,
        changedBy: a.changed_by ?? null, changedAt: a.changed_at,
      }))
    );
  } catch (err) {
    return sendError(res, "GET /api/fees/audit", err);
  }
});

// --- GET /api/fees/revenue ---------------------------------------------------
// Admin. What CattleCoin has earned in fees so far, by herd.
//   raise fees + per-head-at-raise  come from releases
//   exit fees (profit fee and per-head-at-exit) come from approved sales
router.get("/revenue", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const raise = await pool.query(
      `SELECT r.herd_id, h.herd_name,
              COALESCE(SUM(r.raise_fee), 0) AS raise_fees,
              COALESCE(SUM(r.per_head_fee), 0) AS per_head_at_raise
         FROM herd_releases r JOIN herds h ON h.herd_id = r.herd_id
        GROUP BY r.herd_id, h.herd_name`
    );
    const exit = await pool.query(
      `SELECT s.herd_id, h.herd_name, COALESCE(SUM(s.platform_fees_total), 0) AS exit_fees
         FROM herd_sales s JOIN herds h ON h.herd_id = s.herd_id
        WHERE s.status = 'approved'
        GROUP BY s.herd_id, h.herd_name`
    );
    const byHerd = new Map();
    const row = (id, name) => {
      if (!byHerd.has(id)) byHerd.set(id, { herdId: id, herdName: name, raiseFees: 0, perHeadFeesAtRaise: 0, exitFees: 0 });
      return byHerd.get(id);
    };
    for (const r of raise.rows) {
      const x = row(r.herd_id, r.herd_name);
      x.raiseFees = Number(r.raise_fees);
      x.perHeadFeesAtRaise = Number(r.per_head_at_raise);
    }
    for (const r of exit.rows) row(r.herd_id, r.herd_name).exitFees = Number(r.exit_fees);

    const herds = [...byHerd.values()].map((x) => ({
      ...x,
      total: Math.round((x.raiseFees + x.perHeadFeesAtRaise + x.exitFees) * 100) / 100,
    }));
    const sum = (k) => Math.round(herds.reduce((s, x) => s + x[k], 0) * 100) / 100;
    return res.json({
      totals: {
        raiseFees: sum("raiseFees"),
        perHeadFeesAtRaise: sum("perHeadFeesAtRaise"),
        exitFees: sum("exitFees"),
        total: sum("total"),
      },
      herds,
      note: "Fees are recorded when investor money is released and when a sale is approved. No money has moved.",
    });
  } catch (err) {
    return sendError(res, "GET /api/fees/revenue", err);
  }
});

export default router;
