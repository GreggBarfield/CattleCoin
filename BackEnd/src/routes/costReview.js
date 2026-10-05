import express from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { HttpError, isUuid, dollars, withTransaction, sendError } from "../lib/routeHelpers.js";
import {
  OWNER_ROLES, loadHerd, herdSaleState, getViewerAccess, shapeExpense,
  EXPENSE_SELECT, EXPENSE_FROM, expenseSnapshot, writeExpenseHistory,
} from "../lib/costs.js";
import {
  MAX_DOC_BYTES, DOC_TYPES, sniffDocType, sha256Hex, cleanFilename,
  effectiveStatus, loadEvidence, getCostReview,
} from "../lib/costVerification.js";

const router = express.Router();

// Cost verification (migration 019). Mounted at /api/cost-review.
//
//   POST /expenses/:expenseId/documents   attach an invoice or receipt (owner or admin)
//   GET  /documents/:docId                download one
//   POST /expenses/:expenseId/dispute     an investor in the herd challenges a cost
//   POST /disputes/:disputeId/respond     the herd's owner replies
//   POST /disputes/:disputeId/resolve     admin rules: upheld or dismissed
//   GET  /herds/:herdId/disputes          who can read the herd's costs can read these
//   POST /expenses/:expenseId/verify      admin checked it
//   POST /expenses/:expenseId/flag        admin flags it
//   GET  /herds/:herdId/summary           the review picture for a herd
//   GET  /my-alerts                       an investor's new costs since they last looked
//   POST /herds/:herdId/seen              an investor marks a herd's costs as seen

const noteOf = (v, max = 1000) => (v === undefined || v === null ? "" : String(v).trim().slice(0, max));

async function loadExpenseRow(db, expenseId, lock = false) {
  const r = await db.query(
    `SELECT ${EXPENSE_SELECT} ${EXPENSE_FROM} WHERE e.expense_id = $1${lock ? " FOR UPDATE OF e" : ""}`,
    [expenseId]
  );
  if (r.rowCount === 0) throw new HttpError(404, "Cost not found.");
  return r.rows[0];
}

async function shapeWithEvidence(db, row, rule) {
  const ev = await loadEvidence(db, [row]);
  return shapeExpense(row, rule, ev.get(row.expense_id));
}

// --- POST /expenses/:expenseId/documents ------------------------------------
// The body IS the file (Content-Type application/pdf, image/jpeg or image/png);
// the name goes in the X-Filename header (URL-encoded). 5 MB maximum.
const rawParser = express.raw({ type: DOC_TYPES, limit: MAX_DOC_BYTES });
function fileBody(req, res, next) {
  rawParser(req, res, (err) => {
    if (err) {
      if (err.status === 413 || err.type === "entity.too.large") {
        return res.status(413).json({ error: "That file is too large. The limit is 5 MB." });
      }
      return res.status(400).json({ error: "Could not read the uploaded file." });
    }
    next();
  });
}

router.post("/expenses/:expenseId/documents", requireAuth, fileBody, async (req, res) => {
  const { expenseId } = req.params;
  if (!isUuid(expenseId)) return res.status(400).json({ error: "Invalid expenseId." });
  try {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new HttpError(400, "Send the file as the request body with Content-Type application/pdf, image/jpeg or image/png.");
    }
    const realType = sniffDocType(body);
    if (!realType) throw new HttpError(400, "That file is not a PDF, JPEG or PNG.");
    if (realType !== req.headers["content-type"]?.split(";")[0].trim().toLowerCase()) {
      throw new HttpError(400, "The file's contents do not match its Content-Type.");
    }
    const filename = cleanFilename(req.headers["x-filename"]);
    const hash = sha256Hex(body);

    const out = await withTransaction(async (client) => {
      const peek = await loadExpenseRow(client, expenseId);
      const herdRes = await client.query(
        "SELECT herd_id, rancher_id, herd_name FROM herds WHERE herd_id = $1 FOR UPDATE", [peek.herd_id]
      );
      const herd = herdRes.rows[0];
      const expense = await loadExpenseRow(client, expenseId, true);
      const who = await getViewerAccess(client, req.user, herd);
      if (!who.isAdmin && !who.isOwner) throw new HttpError(403, "Only the herd's owner or an admin can attach an invoice.");
      if (expense.status !== "active") throw new HttpError(409, "This cost is voided.");
      if ((await herdSaleState(client, herd.herd_id)) === "approved") {
        throw new HttpError(409, "This herd's sale has been approved, so its costs are frozen.");
      }

      try {
        await client.query(
          `INSERT INTO herd_expense_documents
             (expense_id, herd_id, filename, content_type, size_bytes, sha256, data, uploaded_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [expenseId, herd.herd_id, filename, realType, body.length, hash, body, req.user.userId]
        );
      } catch (e) {
        if (e.code === "23505") throw new HttpError(409, "That exact file is already attached to this cost.");
        throw e;
      }

      let after = expense;
      if (expense.source === "manual" && expense.verification_status === "unverified") {
        await client.query(
          "UPDATE herd_expenses SET verification_status = 'documented', updated_at = NOW() WHERE expense_id = $1",
          [expenseId]
        );
        after = await loadExpenseRow(client, expenseId);
      }
      await writeExpenseHistory(client, {
        expenseId, herdId: herd.herd_id, action: "update", userId: req.user.userId,
        reason: `Invoice attached: ${filename}`, before: expenseSnapshot(expense), after: expenseSnapshot(after),
      });
      return { row: after, rule: null };
    });
    return res.status(201).json({
      message: "Invoice attached.",
      expense: await shapeWithEvidence(pool, out.row, out.rule),
    });
  } catch (err) {
    return sendError(res, "POST /api/cost-review/expenses/:expenseId/documents", err);
  }
});

// --- GET /documents/:docId ---------------------------------------------------
// Anyone who may read the herd's costs may open the file. Add ?inline=1 to
// show it in the browser instead of downloading it.
router.get("/documents/:docId", requireAuth, async (req, res) => {
  const { docId } = req.params;
  if (!isUuid(docId)) return res.status(400).json({ error: "Invalid docId." });
  try {
    const r = await pool.query(
      "SELECT herd_id, filename, content_type, size_bytes, data FROM herd_expense_documents WHERE doc_id = $1",
      [docId]
    );
    if (r.rowCount === 0) throw new HttpError(404, "Document not found.");
    const doc = r.rows[0];
    const herd = await loadHerd(pool, doc.herd_id);
    const who = await getViewerAccess(pool, req.user, herd);
    if (!who.canView) throw new HttpError(403, "You are not allowed to see this herd's documents.");

    const disposition = req.query.inline === "1" ? "inline" : "attachment";
    res.set({
      "Content-Type": doc.content_type,
      "Content-Length": String(doc.size_bytes),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=0, no-store",
    });
    return res.send(doc.data);
  } catch (err) {
    return sendError(res, "GET /api/cost-review/documents/:docId", err);
  }
});

// --- POST /expenses/:expenseId/dispute ---------------------------------------
// Body: { note }. Only an investor who holds shares in the herd.
router.post("/expenses/:expenseId/dispute", requireAuth, requireRole("investor"), async (req, res) => {
  const { expenseId } = req.params;
  if (!isUuid(expenseId)) return res.status(400).json({ error: "Invalid expenseId." });
  try {
    const note = noteOf(req.body?.note);
    if (note.length < 5) throw new HttpError(400, "Tell us what looks wrong with this cost (at least a few words).");

    const out = await withTransaction(async (client) => {
      const exp = await loadExpenseRow(client, expenseId);
      const herd = await loadHerd(client, exp.herd_id);
      const who = await getViewerAccess(client, req.user, herd);
      if (!who.isInvestor) throw new HttpError(403, "Only an investor in this herd can dispute its costs.");
      if (exp.status !== "active") throw new HttpError(409, "This cost is voided, so there is nothing to dispute.");
      if ((await herdSaleState(client, herd.herd_id)) === "approved") {
        throw new HttpError(409, "This herd's sale has been approved, so its costs are frozen.");
      }
      try {
        const ins = await client.query(
          `INSERT INTO herd_expense_disputes (expense_id, herd_id, raised_by_user_id, note)
           VALUES ($1, $2, $3, $4) RETURNING dispute_id, created_at`,
          [expenseId, herd.herd_id, req.user.userId, note]
        );
        return ins.rows[0];
      } catch (e) {
        if (e.code === "23505") throw new HttpError(409, "You already have an open dispute on this cost.");
        throw e;
      }
    });
    return res.status(201).json({
      message: "Dispute sent. The herd's owner can reply, and an admin will review it. The sale cannot be approved while it is open.",
      disputeId: out.dispute_id, createdAt: out.created_at,
    });
  } catch (err) {
    return sendError(res, "POST /api/cost-review/expenses/:expenseId/dispute", err);
  }
});

async function loadDispute(db, disputeId, lock = false) {
  const r = await db.query(
    `SELECT dispute_id, expense_id, herd_id, raised_by_user_id, note, status,
            owner_response, owner_responded_at, resolution_note, resolved_at, created_at
       FROM herd_expense_disputes WHERE dispute_id = $1${lock ? " FOR UPDATE" : ""}`,
    [disputeId]
  );
  if (r.rowCount === 0) throw new HttpError(404, "Dispute not found.");
  return r.rows[0];
}

// --- POST /disputes/:disputeId/respond ---------------------------------------
// Body: { note }. The herd's owner answers an open dispute.
router.post("/disputes/:disputeId/respond", requireAuth, requireRole(...OWNER_ROLES), async (req, res) => {
  const { disputeId } = req.params;
  if (!isUuid(disputeId)) return res.status(400).json({ error: "Invalid disputeId." });
  try {
    const note = noteOf(req.body?.note);
    if (note.length < 2) throw new HttpError(400, "Write your reply.");
    await withTransaction(async (client) => {
      const d = await loadDispute(client, disputeId, true);
      const herd = await loadHerd(client, d.herd_id);
      if (herd.rancher_id !== req.user.userId) throw new HttpError(403, "Only the herd's owner can reply to this dispute.");
      if (d.status !== "open") throw new HttpError(409, `This dispute is already ${d.status}.`);
      await client.query(
        "UPDATE herd_expense_disputes SET owner_response = $2, owner_responded_at = NOW() WHERE dispute_id = $1",
        [disputeId, note]
      );
    });
    return res.json({ message: "Reply saved." });
  } catch (err) {
    return sendError(res, "POST /api/cost-review/disputes/:disputeId/respond", err);
  }
});

// --- POST /disputes/:disputeId/resolve ---------------------------------------
// Admin. Body: { outcome: "upheld" | "dismissed", note }. Upholding flags the
// cost; the admin then fixes it with the normal cost correction (PATCH or void,
// with a reason) on /api/expenses.
router.post("/disputes/:disputeId/resolve", requireAuth, requireRole("admin"), async (req, res) => {
  const { disputeId } = req.params;
  if (!isUuid(disputeId)) return res.status(400).json({ error: "Invalid disputeId." });
  try {
    const outcome = String(req.body?.outcome ?? "").trim();
    if (!["upheld", "dismissed"].includes(outcome)) throw new HttpError(400, "outcome must be upheld or dismissed.");
    const note = noteOf(req.body?.note);
    if (note.length < 5) throw new HttpError(400, "A note explaining the ruling is required.");

    await withTransaction(async (client) => {
      const d = await loadDispute(client, disputeId, true);
      if (d.status !== "open") throw new HttpError(409, `This dispute is already ${d.status}.`);
      await client.query(
        `UPDATE herd_expense_disputes
            SET status = $2, resolution_note = $3, resolved_by_user_id = $4, resolved_at = NOW()
          WHERE dispute_id = $1`,
        [disputeId, outcome, note, req.user.userId]
      );
      if (outcome === "upheld") {
        const exp = await loadExpenseRow(client, d.expense_id, true);
        if (exp.status === "active" && exp.source === "manual" && exp.verification_status !== "flagged") {
          await client.query(
            `UPDATE herd_expenses
                SET verification_status = 'flagged', verified_by_user_id = $2, verified_at = NOW(),
                    verification_note = $3, updated_at = NOW()
              WHERE expense_id = $1`,
            [d.expense_id, req.user.userId, `Dispute upheld: ${note}`.slice(0, 255)]
          );
          const after = await loadExpenseRow(client, d.expense_id);
          await writeExpenseHistory(client, {
            expenseId: d.expense_id, herdId: d.herd_id, action: "flag", userId: req.user.userId,
            reason: `Dispute upheld: ${note}`.slice(0, 255), before: expenseSnapshot(exp), after: expenseSnapshot(after),
          });
        }
      }
    });
    return res.json({
      message: outcome === "upheld"
        ? "Dispute upheld and the cost is flagged. Correct or void the cost (with a reason) to fix the numbers."
        : "Dispute dismissed.",
    });
  } catch (err) {
    return sendError(res, "POST /api/cost-review/disputes/:disputeId/resolve", err);
  }
});

// --- GET /herds/:herdId/disputes ---------------------------------------------
// Investors see that a dispute exists and its status, not who raised it.
// Admins see who.
router.get("/herds/:herdId/disputes", requireAuth, async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  try {
    const herd = await loadHerd(pool, herdId);
    const who = await getViewerAccess(pool, req.user, herd);
    if (!who.canView) throw new HttpError(403, "You are not allowed to see this herd's costs.");
    const r = await pool.query(
      `SELECT d.dispute_id, d.expense_id, d.raised_by_user_id, d.note, d.status, d.owner_response,
              d.owner_responded_at, d.resolution_note, d.resolved_at, d.created_at,
              e.category, e.amount, e.description, u.slug AS raised_by_slug
         FROM herd_expense_disputes d
         JOIN herd_expenses e ON e.expense_id = d.expense_id
         LEFT JOIN users u ON u.user_id = d.raised_by_user_id
        WHERE d.herd_id = $1 ORDER BY d.created_at, d.dispute_id`,
      [herdId]
    );
    return res.json({
      herdId,
      disputes: r.rows.map((d) => ({
        disputeId: d.dispute_id, expenseId: d.expense_id,
        cost: { category: d.category, amount: Number(d.amount), description: d.description ?? null },
        note: d.note, status: d.status,
        ownerResponse: d.owner_response ?? null, ownerRespondedAt: d.owner_responded_at ?? null,
        resolutionNote: d.resolution_note ?? null, resolvedAt: d.resolved_at ?? null, createdAt: d.created_at,
        raisedByMe: d.raised_by_user_id === req.user.userId,
        raisedBy: who.isAdmin ? d.raised_by_slug ?? null : undefined,
      })),
    });
  } catch (err) {
    return sendError(res, "GET /api/cost-review/herds/:herdId/disputes", err);
  }
});

// --- POST /expenses/:expenseId/verify ----------------------------------------
// Admin. Body: { note? }. Needs an invoice on file, or a note saying how the
// cost was checked (for example: "called the vendor").
router.post("/expenses/:expenseId/verify", requireAuth, requireRole("admin"), async (req, res) => {
  const { expenseId } = req.params;
  if (!isUuid(expenseId)) return res.status(400).json({ error: "Invalid expenseId." });
  try {
    const note = noteOf(req.body?.note, 255);
    const out = await withTransaction(async (client) => {
      const exp = await loadExpenseRow(client, expenseId, true);
      if (exp.status !== "active") throw new HttpError(409, "This cost is voided.");
      if (exp.source !== "manual") throw new HttpError(400, "System-booked costs do not need verification.");
      const herd = await loadHerd(client, exp.herd_id);
      if ((await herdSaleState(client, herd.herd_id)) === "approved") {
        throw new HttpError(409, "This herd's sale has been approved, so its costs are frozen.");
      }
      const docs = await client.query("SELECT 1 FROM herd_expense_documents WHERE expense_id = $1 LIMIT 1", [expenseId]);
      if (docs.rowCount === 0 && !note) {
        throw new HttpError(400, "There is no invoice on file. Add a note saying how you checked this cost (for example: called the vendor).");
      }
      await client.query(
        `UPDATE herd_expenses
            SET verification_status = 'verified', verified_by_user_id = $2, verified_at = NOW(),
                verification_note = $3, updated_at = NOW()
          WHERE expense_id = $1`,
        [expenseId, req.user.userId, note || null]
      );
      const after = await loadExpenseRow(client, expenseId);
      await writeExpenseHistory(client, {
        expenseId, herdId: herd.herd_id, action: "verify", userId: req.user.userId,
        reason: note || "Verified against the invoice on file.", before: expenseSnapshot(exp), after: expenseSnapshot(after),
      });
      return after;
    });
    return res.json({ message: "Cost verified.", expense: await shapeWithEvidence(pool, out, null) });
  } catch (err) {
    return sendError(res, "POST /api/cost-review/expenses/:expenseId/verify", err);
  }
});

// --- POST /expenses/:expenseId/flag ------------------------------------------
// Admin. Body: { reason } (required).
router.post("/expenses/:expenseId/flag", requireAuth, requireRole("admin"), async (req, res) => {
  const { expenseId } = req.params;
  if (!isUuid(expenseId)) return res.status(400).json({ error: "Invalid expenseId." });
  try {
    const reason = noteOf(req.body?.reason, 255);
    if (reason.length < 5) throw new HttpError(400, "A reason is required to flag a cost.");
    const out = await withTransaction(async (client) => {
      const exp = await loadExpenseRow(client, expenseId, true);
      if (exp.status !== "active") throw new HttpError(409, "This cost is voided.");
      if (exp.source !== "manual") throw new HttpError(400, "System-booked costs cannot be flagged here.");
      const herd = await loadHerd(client, exp.herd_id);
      if ((await herdSaleState(client, herd.herd_id)) === "approved") {
        throw new HttpError(409, "This herd's sale has been approved, so its costs are frozen.");
      }
      await client.query(
        `UPDATE herd_expenses
            SET verification_status = 'flagged', verified_by_user_id = $2, verified_at = NOW(),
                verification_note = $3, updated_at = NOW()
          WHERE expense_id = $1`,
        [expenseId, req.user.userId, reason]
      );
      const after = await loadExpenseRow(client, expenseId);
      await writeExpenseHistory(client, {
        expenseId, herdId: herd.herd_id, action: "flag", userId: req.user.userId,
        reason, before: expenseSnapshot(exp), after: expenseSnapshot(after),
      });
      return after;
    });
    return res.json({ message: "Cost flagged.", expense: await shapeWithEvidence(pool, out, null) });
  } catch (err) {
    return sendError(res, "POST /api/cost-review/expenses/:expenseId/flag", err);
  }
});

// --- GET /herds/:herdId/summary ----------------------------------------------
router.get("/herds/:herdId/summary", requireAuth, async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  try {
    const herd = await loadHerd(pool, herdId);
    const who = await getViewerAccess(pool, req.user, herd);
    if (!who.canView) throw new HttpError(403, "You are not allowed to see this herd's costs.");
    return res.json(await getCostReview(pool, herdId));
  } catch (err) {
    return sendError(res, "GET /api/cost-review/herds/:herdId/summary", err);
  }
});

// --- GET /my-alerts ----------------------------------------------------------
// For each herd the investor holds: the owner-typed costs added since they
// last looked (or, the first time, since they bought in).
router.get("/my-alerts", requireAuth, requireRole("investor"), async (req, res) => {
  try {
    const herds = await pool.query(
      `SELECT h.herd_id, h.herd_name, COALESCE(s.seen_at, f.first_at) AS since
         FROM (
           SELECT herd_id, MIN(ts) AS first_at FROM (
             SELECT tp.herd_id, o.acquired_at AS ts
               FROM ownership o JOIN token_pools tp ON tp.pool_id = o.pool_id
              WHERE o.user_id = $1 AND o.token_amount > 0
             UNION ALL
             SELECT herd_id, created_at FROM investor_payments WHERE user_id = $1
           ) x GROUP BY herd_id
         ) f
         JOIN herds h ON h.herd_id = f.herd_id
         LEFT JOIN investor_cost_seen s ON s.user_id = $1 AND s.herd_id = f.herd_id
        ORDER BY h.herd_name`,
      [req.user.userId]
    );
    const alerts = [];
    for (const h of herds.rows) {
      const costs = await pool.query(
        `SELECT ${EXPENSE_SELECT} ${EXPENSE_FROM}
          WHERE e.herd_id = $1 AND e.status = 'active' AND e.source = 'manual'
            AND e.created_at > $2
          ORDER BY e.created_at`,
        [h.herd_id, h.since]
      );
      const dis = await pool.query(
        `SELECT COUNT(*) AS n FROM herd_expense_disputes
          WHERE herd_id = $1 AND raised_by_user_id = $2 AND status <> 'open'
            AND resolved_at > $3`,
        [h.herd_id, req.user.userId, h.since]
      );
      const evidence = await loadEvidence(pool, costs.rows);
      const newCosts = costs.rows.map((r) => shapeExpense(r, null, evidence.get(r.expense_id)));
      const resolved = Number(dis.rows[0].n);
      if (newCosts.length === 0 && resolved === 0) continue;
      alerts.push({
        herdId: h.herd_id, herdName: h.herd_name, since: h.since,
        newCostCount: newCosts.length,
        newCostTotal: dollars(newCosts.reduce((a, c) => a + Math.round(c.amount * 100), 0)),
        newWithoutInvoice: newCosts.filter((c) => c.documents.length === 0).length,
        myDisputesRuledOn: resolved,
        newCosts,
      });
    }
    return res.json({ alerts });
  } catch (err) {
    return sendError(res, "GET /api/cost-review/my-alerts", err);
  }
});

// --- POST /herds/:herdId/seen ------------------------------------------------
router.post("/herds/:herdId/seen", requireAuth, requireRole("investor"), async (req, res) => {
  const { herdId } = req.params;
  if (!isUuid(herdId)) return res.status(400).json({ error: "Invalid herdId." });
  try {
    const herd = await loadHerd(pool, herdId);
    const who = await getViewerAccess(pool, req.user, herd);
    if (!who.isInvestor) throw new HttpError(403, "You do not hold shares in this herd.");
    await pool.query(
      `INSERT INTO investor_cost_seen (user_id, herd_id, seen_at) VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, herd_id) DO UPDATE SET seen_at = NOW()`,
      [req.user.userId, herdId]
    );
    return res.json({ message: "Marked as seen." });
  } catch (err) {
    return sendError(res, "POST /api/cost-review/herds/:herdId/seen", err);
  }
});

export default router;
