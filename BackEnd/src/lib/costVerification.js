import crypto from "crypto";
import { HttpError, dollars } from "./routeHelpers.js";

// Cost verification: invoices on file, warning signals on a cost, and the
// review summary an admin sees before approving a sale.
//
// Why this exists: the sale split is investor payout = paid in + (profit x
// share), and profit is sale proceeds minus the herd's costs. Every dollar of
// cost the owner adds lowers the investors' profit and raises the owner's
// remainder, so costs are the one number the owner controls that moves money
// between the two sides. Investors can see the costs; this makes them provable
// and challengeable.

export const MAX_DOC_BYTES = 5 * 1024 * 1024;
export const DOC_TYPES = ["application/pdf", "image/jpeg", "image/png"];

// Approving a sale is blocked while any dispute is open. Costs an admin has
// flagged, or whose invoice looks reused, need the admin to acknowledge them.
// Costs with no invoice at all show as a warning only. Set this to true when
// you want "no invoice" to need an acknowledgement as well.
export const REQUIRE_ACK_FOR_UNVERIFIED = false;

// What a file really is, from its first bytes (the claimed type is not trusted).
export function sniffDocType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  if (buf.slice(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

export const sha256Hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// A safe display name: no folders, no control characters, bounded length.
export function cleanFilename(raw) {
  let name = "invoice";
  try {
    name = decodeURIComponent(String(raw ?? "")) || "invoice";
  } catch {
    name = String(raw ?? "") || "invoice";
  }
  name = name.replace(/[\\/]+/g, "_").replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 200);
  return name || "invoice";
}

// 'system' for costs the platform booked itself (purchase price, LRP premium,
// starting value); otherwise the stored status.
export const effectiveStatus = (row) => (row.source !== "manual" ? "system" : row.verification_status);

export const SIGNAL_LABELS = {
  no_invoice:               "No invoice or receipt on file",
  duplicate_invoice_file:   "The same invoice file is attached to another cost",
  duplicate_invoice_number: "The same vendor and invoice number appear on another cost",
  flagged:                  "Flagged by an admin",
  open_dispute:             "An investor has disputed this cost",
};

// Evidence for a set of cost rows: files, disputes, and the warning signals.
// One round of queries for the whole list. Returns Map(expenseId -> evidence).
export async function loadEvidence(db, rows) {
  const ids = rows.map((r) => r.expense_id);
  const out = new Map();
  for (const r of rows) {
    out.set(r.expense_id, { documents: [], openDisputes: 0, totalDisputes: 0, signals: [] });
  }
  if (ids.length === 0) return out;

  // One at a time: db may be a transaction client, which runs one query at once.
  const docs = await db.query(
    `SELECT doc_id, expense_id, filename, content_type, size_bytes, uploaded_at
       FROM herd_expense_documents WHERE expense_id = ANY($1::uuid[]) ORDER BY uploaded_at, doc_id`,
    [ids]
  );
  const disputes = await db.query(
    `SELECT expense_id,
            COUNT(*) FILTER (WHERE status = 'open') AS open_count,
            COUNT(*) AS total_count
       FROM herd_expense_disputes WHERE expense_id = ANY($1::uuid[]) GROUP BY expense_id`,
    [ids]
  );
  const dupFile = await db.query(
    `SELECT d.expense_id, COUNT(DISTINCT o.expense_id) AS others
       FROM herd_expense_documents d
       JOIN herd_expense_documents o ON o.sha256 = d.sha256 AND o.expense_id <> d.expense_id
       JOIN herd_expenses oe ON oe.expense_id = o.expense_id AND oe.status = 'active'
      WHERE d.expense_id = ANY($1::uuid[])
      GROUP BY d.expense_id`,
    [ids]
  );
  const dupNumber = await db.query(
    `SELECT e.expense_id, COUNT(*) AS others
       FROM herd_expenses e
       JOIN herd_expenses o
         ON o.expense_id <> e.expense_id AND o.status = 'active'
        AND LOWER(BTRIM(o.vendor_name)) = LOWER(BTRIM(e.vendor_name))
        AND LOWER(BTRIM(o.invoice_number)) = LOWER(BTRIM(e.invoice_number))
      WHERE e.expense_id = ANY($1::uuid[])
        AND e.vendor_name IS NOT NULL AND e.invoice_number IS NOT NULL
        AND BTRIM(e.vendor_name) <> '' AND BTRIM(e.invoice_number) <> ''
      GROUP BY e.expense_id`,
    [ids]
  );

  for (const d of docs.rows) {
    out.get(d.expense_id).documents.push({
      docId: d.doc_id, filename: d.filename, contentType: d.content_type,
      sizeBytes: d.size_bytes, uploadedAt: d.uploaded_at,
    });
  }
  for (const d of disputes.rows) {
    const ev = out.get(d.expense_id);
    ev.openDisputes = Number(d.open_count);
    ev.totalDisputes = Number(d.total_count);
  }
  const fileDups = new Set(dupFile.rows.map((r) => r.expense_id));
  const numDups = new Set(dupNumber.rows.map((r) => r.expense_id));

  for (const r of rows) {
    const ev = out.get(r.expense_id);
    if (r.status !== "active") continue; // voided costs carry no warnings
    const sig = (code, extra) => ev.signals.push({ code, label: SIGNAL_LABELS[code], ...extra });
    if (r.source === "manual") {
      if (r.verification_status === "flagged") sig("flagged", { note: r.verification_note ?? null });
      if (ev.documents.length === 0 && r.verification_status !== "verified") sig("no_invoice");
      if (fileDups.has(r.expense_id)) sig("duplicate_invoice_file");
      if (numDups.has(r.expense_id)) sig("duplicate_invoice_number");
    }
    if (ev.openDisputes > 0) sig("open_dispute", { count: ev.openDisputes });
  }
  return out;
}

// The picture of a herd's costs for the admin (and anyone who may read them).
export async function getCostReview(db, herdId) {
  const r = await db.query(
    `SELECT expense_id, source, status, verification_status, verification_note, amount,
            vendor_name, invoice_number
       FROM herd_expenses WHERE herd_id = $1 AND status = 'active'`,
    [herdId]
  );
  const evidence = await loadEvidence(db, r.rows);

  const byStatus = { unverified: 0, documented: 0, verified: 0, flagged: 0, system: 0 };
  let unverifiedCents = 0;
  let duplicates = 0;
  let flagged = 0;
  for (const row of r.rows) {
    const st = effectiveStatus(row);
    byStatus[st] += 1;
    const ev = evidence.get(row.expense_id);
    if (st === "unverified") unverifiedCents += Math.round(Number(row.amount) * 100);
    if (st === "flagged") flagged += 1;
    if (ev.signals.some((s) => s.code === "duplicate_invoice_file" || s.code === "duplicate_invoice_number")) {
      duplicates += 1;
    }
  }
  const dr = await db.query(
    "SELECT COUNT(*) AS n FROM herd_expense_disputes WHERE herd_id = $1 AND status = 'open'",
    [herdId]
  );
  const openDisputes = Number(dr.rows[0].n);

  const warnings = [];
  if (byStatus.unverified > 0) {
    warnings.push(`${byStatus.unverified} cost(s) totalling $${dollars(unverifiedCents).toFixed(2)} have no invoice on file.`);
  }
  if (flagged > 0) warnings.push(`${flagged} cost(s) are flagged.`);
  if (duplicates > 0) warnings.push(`${duplicates} cost(s) reuse an invoice file or invoice number that is on another cost.`);

  const needsAcknowledgement = flagged > 0 || duplicates > 0 || (REQUIRE_ACK_FOR_UNVERIFIED && byStatus.unverified > 0);

  return {
    herdId,
    activeCosts: r.rows.length,
    byStatus,
    unverifiedAmount: dollars(unverifiedCents),
    flaggedCosts: flagged,
    duplicateInvoiceCosts: duplicates,
    openDisputes,
    blocked: openDisputes > 0,
    needsAcknowledgement,
    warnings,
  };
}

// Used when an admin approves a sale. Throws a 409 that says what to do.
// Returns true when there were warnings the admin acknowledged.
export function assertCostReviewAllows(review, acknowledged) {
  if (review.blocked) {
    throw new HttpError(
      409,
      `This herd has ${review.openDisputes} open cost dispute(s). Resolve them before approving the sale ` +
        "(GET /api/cost-review/herds/:herdId/disputes lists them)."
    );
  }
  if (review.needsAcknowledgement && !acknowledged) {
    throw new HttpError(
      409,
      "Some costs on this herd need a second look: " + review.warnings.join(" ") +
        " Verify or correct them, or approve again with acknowledgeCostWarnings: true."
    );
  }
  return review.needsAcknowledgement || review.warnings.length > 0;
}
