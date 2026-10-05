// Story test for cost verification (migration 019).
//
//   node scripts/test_cost_verification.mjs
//
// Run from the BackEnd folder with the backend running. It makes its own test
// data (names start with TEST19), makes real HTTP calls with real logins, and
// deletes its data when it finishes.
//
//   BASE_URL    where the backend is   (default http://localhost:3000)
//   ADMIN_USER  an admin's username    (default admin)
//   ADMIN_PASS  that admin's password  (default CattleDemo-2026)
//
// Never run this against the live server: it signs up test users and writes
// test herds. Local database only.

import pool from "../src/db.js";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "CattleDemo-2026";
const PASS = "Test19-pass-2026!";
const STAMP = Date.now().toString(36);

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail ? "  -> " + detail : ""}`); }
}
const section = (t) => console.log(`\n${t}`);

async function api(method, path, { token, json, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (raw !== undefined) body = raw;
  const res = await fetch(BASE + path, { method, headers: h, body });
  const buf = Buffer.from(await res.arrayBuffer());
  let data = null;
  try { data = JSON.parse(buf.toString("utf8")); } catch { /* not JSON (a file) */ }
  return { status: res.status, data, buf, headers: res.headers };
}

async function signupAndLogin(name, role) {
  const username = `test19_${name}_${STAMP}`;
  const s = await api("POST", "/api/auth/signup", { json: { username, email: `${username}@example.test`, password: PASS, role } });
  if (s.status !== 201 && s.status !== 200) throw new Error(`signup ${name} failed: ${s.status} ${JSON.stringify(s.data)}`);
  const l = await api("POST", "/api/auth/login", { json: { username, password: PASS } });
  if (!l.data?.token) throw new Error(`login ${name} failed`);
  return { token: l.data.token, userId: l.data.userId, slug: l.data.slug };
}

// A tiny but real file of each type (just the signature bytes plus padding).
const pdfBytes = (tag) => Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
const pngBytes = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

const upload = (token, expenseId, bytes, type, name = "bill.pdf") =>
  api("POST", `/api/cost-review/expenses/${expenseId}/documents`, {
    token, raw: bytes, headers: { "Content-Type": type, "X-Filename": encodeURIComponent(name) },
  });

async function cleanup() {
  await pool.query("DELETE FROM herds WHERE herd_name LIKE 'TEST19%'");
  await pool.query("DELETE FROM users WHERE slug LIKE 'test19\\_%'");
}

async function main() {
  console.log(`Cost verification story test against ${BASE}`);
  await cleanup();

  const admin = await api("POST", "/api/auth/login", { json: { username: ADMIN_USER, password: ADMIN_PASS } });
  if (!admin.data?.token) throw new Error("Admin login failed. Set ADMIN_USER and ADMIN_PASS.");
  const A = admin.data.token;
  const owner = await signupAndLogin("owner", "feedlot");
  const other = await signupAndLogin("otherowner", "rancher");
  const inv1 = await signupAndLogin("inv1", "investor");
  const inv2 = await signupAndLogin("inv2", "investor");
  const outsider = await signupAndLogin("outsider", "investor");

  // --- Fixture: a 40-head feedlot herd, investors hold 12 + 8 tokens, money released.
  const h = await pool.query(
    `INSERT INTO herds (rancher_id, herd_name, head_count, listing_price, purchase_status, feedlot_status, dominant_stage)
     VALUES ($1, $2, 40, 120000, 'available', 'listed', 'FEEDLOT') RETURNING herd_id`,
    [owner.userId, `TEST19 Finishing ${STAMP}`]
  );
  const herdId = h.rows[0].herd_id;
  const tp = await pool.query("INSERT INTO token_pools (herd_id, total_supply) VALUES ($1, 40) RETURNING pool_id", [herdId]);
  const poolId = tp.rows[0].pool_id;
  for (const [inv, tokens, amt, pi] of [[inv1, 12, 36000, "a"], [inv2, 8, 24000, "b"]]) {
    await pool.query("INSERT INTO ownership (user_id, pool_id, token_amount) VALUES ($1, $2, $3)", [inv.userId, poolId, tokens]);
    await pool.query(
      "INSERT INTO investor_payments (herd_id, user_id, tokens, amount, stripe_payment_intent_id) VALUES ($1, $2, $3, $4, $5)",
      [herdId, inv.userId, tokens, amt, `pi_test19_${STAMP}_${pi}`]
    );
  }
  await pool.query("UPDATE herds SET tokens_sold = 20 WHERE herd_id = $1", [herdId]);
  await pool.query(
    `INSERT INTO herd_releases (herd_id, producer_user_id, gross_amount, raise_fee_pct, raise_fee, per_head_fee, net_to_producer, status)
     VALUES ($1, $2, 60000, 0, 0, 0, 60000, 'paid')`,
    [herdId, owner.userId]
  );

  // ---------------------------------------------------------------------------
  section("1. The owner logs costs with a vendor and invoice number");
  const c1 = await api("POST", `/api/expenses/herds/${herdId}`, {
    token: owner.token, json: { category: "feed", amount: 12000, description: "Ration", vendorName: "Plains Feed Co", invoiceNumber: "INV-1001" },
  });
  check("cost logged (201)", c1.status === 201, JSON.stringify(c1.data));
  const e1 = c1.data?.expense;
  check("vendor and invoice number saved", e1?.vendorName === "Plains Feed Co" && e1?.invoiceNumber === "INV-1001");
  check("starts unverified", e1?.verificationStatus === "unverified");
  check("shows the 'no invoice' warning", e1?.signals?.some((s) => s.code === "no_invoice"));
  check("no documents yet", Array.isArray(e1?.documents) && e1.documents.length === 0);
  const c2 = await api("POST", `/api/expenses/herds/${herdId}`, { token: owner.token, json: { category: "yardage", amount: 4000 } });
  const e2 = c2.data?.expense;
  check("a cost with no vendor still works (201)", c2.status === 201);

  section("2. An investor sees the costs and their warnings");
  const list1 = await api("GET", `/api/expenses/herds/${herdId}`, { token: inv1.token });
  check("investor can read the list", list1.status === 200 && list1.data.expenses.length === 2);
  check("list carries verification status and signals", list1.data.expenses.every((x) => x.verificationStatus && Array.isArray(x.signals)));
  check("an outsider cannot read it (403)", (await api("GET", `/api/expenses/herds/${herdId}`, { token: outsider.token })).status === 403);

  section("3. Attaching an invoice");
  const pdf1 = pdfBytes("feed bill one");
  const up1 = await upload(owner.token, e1.expenseId, pdf1, "application/pdf", "feed bill #1.pdf");
  check("owner attaches a PDF (201)", up1.status === 201, JSON.stringify(up1.data));
  check("cost becomes documented", up1.data?.expense?.verificationStatus === "documented");
  check("the 'no invoice' warning is gone", !up1.data?.expense?.signals?.some((s) => s.code === "no_invoice"));
  check("file is listed with its name and size", up1.data?.expense?.documents?.[0]?.filename === "feed bill #1.pdf" && up1.data.expense.documents[0].sizeBytes === pdf1.length);
  check("the same file again is refused (409)", (await upload(owner.token, e1.expenseId, pdf1, "application/pdf")).status === 409);
  check("a PNG sent as a PDF is refused (400)", (await upload(owner.token, e2.expenseId, pngBytes(), "application/pdf")).status === 400);
  check("a text file sent as a PDF is refused (400)", (await upload(owner.token, e2.expenseId, Buffer.from("just some words in a file"), "application/pdf")).status === 400);
  check("a type that is not allowed is refused", [400, 415].includes((await upload(owner.token, e2.expenseId, pdf1, "text/html")).status));
  const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5 * 1024 * 1024 + 10, 65)]);
  check("a file over 5 MB is refused (413)", (await upload(owner.token, e2.expenseId, big, "application/pdf")).status === 413);
  check("an investor cannot attach one (403)", (await upload(inv1.token, e2.expenseId, pdfBytes("x"), "application/pdf")).status === 403);
  check("another producer cannot attach one (403)", (await upload(other.token, e2.expenseId, pdfBytes("y"), "application/pdf")).status === 403);
  check("no login is refused (401)", (await upload(null, e2.expenseId, pdfBytes("z"), "application/pdf")).status === 401);

  section("4. Downloading it");
  const docId = up1.data.expense.documents[0].docId;
  const dl = await api("GET", `/api/cost-review/documents/${docId}`, { token: inv1.token });
  check("an investor in the herd can download (200)", dl.status === 200);
  check("the file comes back byte for byte", dl.buf.equals(pdf1));
  check("served as a PDF attachment, not sniffable", dl.headers.get("content-type") === "application/pdf" && /attachment/.test(dl.headers.get("content-disposition") ?? "") && dl.headers.get("x-content-type-options") === "nosniff");
  const dlInline = await api("GET", `/api/cost-review/documents/${docId}?inline=1`, { token: inv1.token });
  check("?inline=1 shows it in the browser", /inline/.test(dlInline.headers.get("content-disposition") ?? ""));
  check("an outsider cannot download (403)", (await api("GET", `/api/cost-review/documents/${docId}`, { token: outsider.token })).status === 403);
  check("no login is refused (401)", (await api("GET", `/api/cost-review/documents/${docId}`)).status === 401);

  section("5. Reused invoices are noticed");
  const c3 = await api("POST", `/api/expenses/herds/${herdId}`, { token: owner.token, json: { category: "feed", amount: 9000, vendorName: "plains feed co ", invoiceNumber: "inv-1001" } });
  const e3 = c3.data.expense;
  await upload(owner.token, e3.expenseId, pdf1, "application/pdf", "same file again.pdf");
  const list2 = await api("GET", `/api/expenses/herds/${herdId}`, { token: inv1.token });
  const byId = Object.fromEntries(list2.data.expenses.map((x) => [x.expenseId, x]));
  const codes = (id) => byId[id].signals.map((s) => s.code);
  check("same file on two costs is flagged on both", codes(e1.expenseId).includes("duplicate_invoice_file") && codes(e3.expenseId).includes("duplicate_invoice_file"));
  check("same vendor and invoice number (any case) is flagged on both", codes(e1.expenseId).includes("duplicate_invoice_number") && codes(e3.expenseId).includes("duplicate_invoice_number"));
  check("an unrelated cost is not flagged for reuse", !codes(e2.expenseId).some((c) => c.startsWith("duplicate")));

  section("6. An investor disputes a cost");
  check("an outsider cannot dispute (403)", (await api("POST", `/api/cost-review/expenses/${e3.expenseId}/dispute`, { token: outsider.token, json: { note: "this looks padded to me" } })).status === 403);
  check("the owner cannot dispute their own cost (403)", (await api("POST", `/api/cost-review/expenses/${e3.expenseId}/dispute`, { token: owner.token, json: { note: "testing" } })).status === 403);
  check("a one-word dispute is refused (400)", (await api("POST", `/api/cost-review/expenses/${e3.expenseId}/dispute`, { token: inv1.token, json: { note: "no" } })).status === 400);
  const d1 = await api("POST", `/api/cost-review/expenses/${e3.expenseId}/dispute`, { token: inv1.token, json: { note: "Same invoice number as the first feed bill - looks counted twice." } });
  check("an investor in the herd can dispute (201)", d1.status === 201, JSON.stringify(d1.data));
  check("a second open dispute on the same cost is refused (409)", (await api("POST", `/api/cost-review/expenses/${e3.expenseId}/dispute`, { token: inv1.token, json: { note: "still wrong, please look" } })).status === 409);
  const d2 = await api("POST", `/api/cost-review/expenses/${e3.expenseId}/dispute`, { token: inv2.token, json: { note: "I agree, this is a repeat bill." } });
  check("a different investor can add their own (201)", d2.status === 201);
  const sum1 = await api("GET", `/api/cost-review/herds/${herdId}/summary`, { token: inv1.token });
  check("summary shows 2 open disputes and blocked", sum1.data?.openDisputes === 2 && sum1.data?.blocked === true);
  check("summary counts costs by status", sum1.data?.byStatus?.documented === 2 && sum1.data?.byStatus?.unverified === 1);
  const dl1 = await api("GET", `/api/cost-review/herds/${herdId}/disputes`, { token: inv2.token });
  check("an investor sees the disputes", dl1.data?.disputes?.length === 2);
  check("an investor does not see who raised them", dl1.data.disputes.every((d) => d.raisedBy === undefined));
  check("an investor can tell which one is theirs", dl1.data.disputes.filter((d) => d.raisedByMe).length === 1);
  const dlA = await api("GET", `/api/cost-review/herds/${herdId}/disputes`, { token: A });
  check("an admin sees who raised them", dlA.data.disputes.every((d) => typeof d.raisedBy === "string"));
  const dispId1 = d1.data.disputeId;
  check("another producer cannot reply (403)", (await api("POST", `/api/cost-review/disputes/${dispId1}/respond`, { token: other.token, json: { note: "not mine to answer" } })).status === 403);
  check("the owner can reply (200)", (await api("POST", `/api/cost-review/disputes/${dispId1}/respond`, { token: owner.token, json: { note: "Second delivery, same vendor; I will ask for the second bill." } })).status === 200);
  const dl2 = await api("GET", `/api/cost-review/herds/${herdId}/disputes`, { token: inv1.token });
  check("the reply shows on the dispute", dl2.data.disputes.find((d) => d.disputeId === dispId1)?.ownerResponse?.startsWith("Second delivery"));
  check("an investor cannot rule on a dispute (403)", (await api("POST", `/api/cost-review/disputes/${dispId1}/resolve`, { token: inv1.token, json: { outcome: "upheld", note: "I say so" } })).status === 403);

  section("7. Alerts for the investor");
  const al = await api("GET", "/api/cost-review/my-alerts", { token: inv1.token });
  check("investor has an alert for this herd", al.status === 200 && al.data.alerts.length === 1);
  check("alert counts the 3 new costs and their total", al.data.alerts[0]?.newCostCount === 3 && al.data.alerts[0]?.newCostTotal === 25000);
  check("alert counts the cost with no invoice", al.data.alerts[0]?.newWithoutInvoice === 1);
  check("an outsider has no alerts", (await api("GET", "/api/cost-review/my-alerts", { token: outsider.token })).data.alerts.length === 0);
  check("a producer cannot use alerts (403)", (await api("GET", "/api/cost-review/my-alerts", { token: owner.token })).status === 403);
  check("marking seen works (200)", (await api("POST", `/api/cost-review/herds/${herdId}/seen`, { token: inv1.token })).status === 200);
  check("after seen, no alert", (await api("GET", "/api/cost-review/my-alerts", { token: inv1.token })).data.alerts.length === 0);
  check("the other investor still has theirs", (await api("GET", "/api/cost-review/my-alerts", { token: inv2.token })).data.alerts.length === 1);
  check("an outsider cannot mark seen (403)", (await api("POST", `/api/cost-review/herds/${herdId}/seen`, { token: outsider.token })).status === 403);

  section("8. A sale cannot be approved over an open dispute");
  const sale = await api("POST", `/api/settlement/herds/${herdId}/sale`, { token: owner.token, json: { headSold: 39, headLost: 1, liveWeightLbs: 55000, pricePerCwt: 245, buyerName: "TEST19 Packer" } });
  check("owner submits the sale (201)", sale.status === 201, JSON.stringify(sale.data));
  const saleId = sale.data?.sale?.saleId ?? sale.data?.saleId;
  const ap1 = await api("POST", `/api/settlement/sales/${saleId}/approve`, { token: A, json: {} });
  check("approval is refused while disputes are open (409)", ap1.status === 409 && /open cost dispute/.test(ap1.data?.error ?? ""), JSON.stringify(ap1.data));
  const ap1b = await api("POST", `/api/settlement/sales/${saleId}/approve`, { token: A, json: { acknowledgeCostWarnings: true } });
  check("acknowledging warnings does not override a dispute (409)", ap1b.status === 409);

  section("9. The admin rules on the disputes");
  check("a ruling needs a note (400)", (await api("POST", `/api/cost-review/disputes/${dispId1}/resolve`, { token: A, json: { outcome: "upheld" } })).status === 400);
  check("a ruling needs a valid outcome (400)", (await api("POST", `/api/cost-review/disputes/${dispId1}/resolve`, { token: A, json: { outcome: "maybe", note: "unsure about it" } })).status === 400);
  const r1 = await api("POST", `/api/cost-review/disputes/${dispId1}/resolve`, { token: A, json: { outcome: "upheld", note: "Duplicate of INV-1001; the second bill was never produced." } });
  check("admin upholds the first dispute (200)", r1.status === 200, JSON.stringify(r1.data));
  check("ruling the same dispute twice is refused (409)", (await api("POST", `/api/cost-review/disputes/${dispId1}/resolve`, { token: A, json: { outcome: "dismissed", note: "changed my mind" } })).status === 409);
  const r2 = await api("POST", `/api/cost-review/disputes/${d2.data.disputeId}/resolve`, { token: A, json: { outcome: "dismissed", note: "Covered by the first ruling." } });
  check("admin dismisses the second (200)", r2.status === 200);
  const list3 = await api("GET", `/api/expenses/herds/${herdId}`, { token: inv1.token });
  const x3 = list3.data.expenses.find((x) => x.expenseId === e3.expenseId);
  check("the upheld cost is now flagged", x3.verificationStatus === "flagged" && x3.signals.some((s) => s.code === "flagged"));
  check("the flag carries the reason", /Duplicate of INV-1001/.test(x3.verificationNote ?? ""));
  check("no open disputes remain", (await api("GET", `/api/cost-review/herds/${herdId}/summary`, { token: inv1.token })).data.openDisputes === 0);
  check("investor 1 is told their dispute was ruled on", (await api("GET", "/api/cost-review/my-alerts", { token: inv1.token })).data.alerts[0]?.myDisputesRuledOn === 1);

  section("10. Flagged costs need acknowledging");
  const ap2 = await api("POST", `/api/settlement/sales/${saleId}/approve`, { token: A, json: {} });
  check("approval is refused until the admin acknowledges (409)", ap2.status === 409 && /acknowledgeCostWarnings/.test(ap2.data?.error ?? ""), JSON.stringify(ap2.data));

  section("11. Admin verify and flag");
  check("verify needs an invoice or a note (400)", (await api("POST", `/api/cost-review/expenses/${e2.expenseId}/verify`, { token: A, json: {} })).status === 400);
  const v2 = await api("POST", `/api/cost-review/expenses/${e2.expenseId}/verify`, { token: A, json: { note: "Called the feedyard, confirmed 4,000 for yardage." } });
  check("verify with a note works (200)", v2.status === 200 && v2.data.expense.verificationStatus === "verified", JSON.stringify(v2.data));
  check("an investor cannot verify (403)", (await api("POST", `/api/cost-review/expenses/${e1.expenseId}/verify`, { token: inv1.token, json: { note: "trust me" } })).status === 403);
  check("flag needs a reason (400)", (await api("POST", `/api/cost-review/expenses/${e1.expenseId}/flag`, { token: A, json: { reason: "x" } })).status === 400);
  const f1 = await api("POST", `/api/cost-review/expenses/${e1.expenseId}/flag`, { token: A, json: { reason: "Vendor could not be reached." } });
  check("flag works (200)", f1.status === 200 && f1.data.expense.verificationStatus === "flagged");
  const v1 = await api("POST", `/api/cost-review/expenses/${e1.expenseId}/verify`, { token: A, json: {} });
  check("verifying a cost with an invoice on file needs no note (200)", v1.status === 200 && v1.data.expense.verificationStatus === "verified");
  const hist = await api("GET", `/api/expenses/${e1.expenseId}/history`, { token: inv1.token });
  const actions = hist.data.history.map((x) => x.action);
  check("history records create, update (invoice), flag and verify", ["create", "update", "flag", "verify"].every((a) => actions.includes(a)), actions.join(","));
  const p2 = await api("PATCH", `/api/expenses/${e2.expenseId}`, { token: A, json: { amount: 3500, reason: "Correct to the confirmed yardage bill." } });
  check("admin corrects a verified cost (200)", p2.status === 200, JSON.stringify(p2.data));
  check("changing the amount takes it off 'verified'", p2.data?.expense?.verificationStatus === "unverified", p2.data?.expense?.verificationStatus);
  check("the correction also clears who verified it", p2.data?.expense?.verifiedAt === null);
  const p3 = await api("PATCH", `/api/expenses/${e2.expenseId}`, { token: A, json: { vendorName: "Plains Yards", reason: "Add vendor." } });
  check("changing only the vendor keeps the status", p3.status === 200 && p3.data.expense.vendorName === "Plains Yards");

  section("12. Approval with the warnings acknowledged");
  const sum2 = await api("GET", `/api/cost-review/herds/${herdId}/summary`, { token: A });
  check("summary still lists the reused-invoice costs", sum2.data.duplicateInvoiceCosts === 2 && sum2.data.needsAcknowledgement === true);
  const ap3 = await api("POST", `/api/settlement/sales/${saleId}/approve`, { token: A, json: { acknowledgeCostWarnings: true, note: "Reviewed." } });
  check("approval works with the acknowledgement (200)", ap3.status === 200, JSON.stringify(ap3.data));
  check("response includes the cost review", ap3.data?.costReview?.needsAcknowledgement === true);
  const activeTotal = 12000 + 3500 + 9000;
  check("settlement still counts the active costs (money math unchanged)", Number(ap3.data?.sale?.expensesTotal ?? ap3.data?.settlement?.expensesTotal) === activeTotal, JSON.stringify(ap3.data?.sale));
  const note = await pool.query("SELECT decision_note FROM herd_sales WHERE sale_id = $1", [saleId]);
  check("the sale records that warnings were acknowledged", /Cost warnings acknowledged by admin/.test(note.rows[0].decision_note ?? "") && /Reviewed\./.test(note.rows[0].decision_note ?? ""));

  section("13. After approval everything is frozen");
  check("no new invoice (409)", (await upload(owner.token, e2.expenseId, pdfBytes("late"), "application/pdf")).status === 409);
  check("no new dispute (409)", (await api("POST", `/api/cost-review/expenses/${e1.expenseId}/dispute`, { token: inv2.token, json: { note: "too late to complain now" } })).status === 409);
  check("no verify (409)", (await api("POST", `/api/cost-review/expenses/${e2.expenseId}/verify`, { token: A, json: { note: "late check" } })).status === 409);
  check("no flag (409)", (await api("POST", `/api/cost-review/expenses/${e2.expenseId}/flag`, { token: A, json: { reason: "late flag here" } })).status === 409);

  section("14. A clean herd needs no acknowledgement");
  const h2 = await pool.query(
    `INSERT INTO herds (rancher_id, herd_name, head_count, listing_price, purchase_status, feedlot_status, dominant_stage)
     VALUES ($1, $2, 20, 50000, 'available', 'listed', 'FEEDLOT') RETURNING herd_id`,
    [owner.userId, `TEST19 Clean ${STAMP}`]
  );
  const clean = h2.rows[0].herd_id;
  const ce = await api("POST", `/api/expenses/herds/${clean}`, { token: owner.token, json: { category: "vet", amount: 800, vendorName: "Vet Clinic", invoiceNumber: "V-77" } });
  await upload(owner.token, ce.data.expense.expenseId, pdfBytes("vet bill"), "application/pdf", "vet.pdf");
  const csale = await api("POST", `/api/settlement/herds/${clean}/sale`, { token: owner.token, json: { grossAmount: 60000, headSold: 20, buyerName: "TEST19 Packer" } });
  const cid = csale.data?.sale?.saleId ?? csale.data?.saleId;
  const cap = await api("POST", `/api/settlement/sales/${cid}/approve`, { token: A, json: {} });
  check("a herd with documented costs and no flags approves with no acknowledgement (200)", cap.status === 200, JSON.stringify(cap.data));
  const nonote = await pool.query("SELECT decision_note FROM herd_sales WHERE sale_id = $1", [cid]);
  check("and its note carries no acknowledgement line", !/acknowledged/.test(nonote.rows[0].decision_note ?? ""));

  section("15. A herd with undocumented costs only warns");
  const h3 = await pool.query(
    `INSERT INTO herds (rancher_id, herd_name, head_count, listing_price, purchase_status, feedlot_status, dominant_stage)
     VALUES ($1, $2, 20, 50000, 'available', 'listed', 'FEEDLOT') RETURNING herd_id`,
    [owner.userId, `TEST19 Bare ${STAMP}`]
  );
  const bare = h3.rows[0].herd_id;
  await api("POST", `/api/expenses/herds/${bare}`, { token: owner.token, json: { category: "feed", amount: 500 } });
  const bsale = await api("POST", `/api/settlement/herds/${bare}/sale`, { token: owner.token, json: { grossAmount: 60000, headSold: 20, buyerName: "TEST19 Packer" } });
  const bid = bsale.data?.sale?.saleId ?? bsale.data?.saleId;
  const bap = await api("POST", `/api/settlement/sales/${bid}/approve`, { token: A, json: {} });
  check("approves without acknowledgement (200)", bap.status === 200, JSON.stringify(bap.data));
  check("the response warns about the missing invoice", bap.data?.costReview?.warnings?.some((w) => /no invoice/.test(w)), JSON.stringify(bap.data?.costReview));
  check("and does not ask for acknowledgement", bap.data?.costReview?.needsAcknowledgement === false);

  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\nTest run stopped:", e.message);
  try { await cleanup(); await pool.end(); } catch { /* ignore */ }
  process.exit(2);
});
