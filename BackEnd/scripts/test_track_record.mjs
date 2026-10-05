// Story test for the producer track record.
//
//   node scripts/test_track_record.mjs
//
// Run from the BackEnd folder with the backend running and migration 019
// applied. Makes its own test data (names start with TEST20), runs three herds
// through the REAL sale and settlement engine, then checks the track record
// against figures worked out here by hand. Deletes its data when it finishes.
//
//   BASE_URL / ADMIN_USER / ADMIN_PASS  as in test_cost_verification.mjs
//
// Local database only. Never run this against the live server.

import pool from "../src/db.js";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "CattleDemo-2026";
const PASS = "Test20-pass-2026!";
const STAMP = Date.now().toString(36);

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail ? "  -> " + detail : ""}`); }
}
const section = (t) => console.log(`\n${t}`);
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 0.006;

async function api(method, path, { token, json, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (raw !== undefined) body = raw;
  const res = await fetch(BASE + path, { method, headers: h, body });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

async function signupAndLogin(name, role) {
  const username = `test20_${name}_${STAMP}`;
  await api("POST", "/api/auth/signup", { json: { username, email: `${username}@example.test`, password: PASS, role } });
  const l = await api("POST", "/api/auth/login", { json: { username, password: PASS } });
  if (!l.data?.token) throw new Error(`login ${name} failed`);
  return { token: l.data.token, userId: l.data.userId, slug: l.data.slug };
}

const pdf = (tag) => Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<<>>endobj\n%%EOF\n`);

async function cleanup() {
  await pool.query("DELETE FROM herds WHERE herd_name LIKE 'TEST20%'");
  await pool.query("DELETE FROM users WHERE slug LIKE 'test20\\_%'");
}

// A 40-head herd where investors hold 12 + 8 tokens (60,000 paid in, released).
async function makeHerd(owner, inv1, inv2, name, tag) {
  const h = await pool.query(
    `INSERT INTO herds (rancher_id, herd_name, head_count, listing_price, purchase_status, feedlot_status, dominant_stage)
     VALUES ($1, $2, 40, 120000, 'available', 'listed', 'FEEDLOT') RETURNING herd_id`,
    [owner.userId, `TEST20 ${name} ${STAMP}`]
  );
  const herdId = h.rows[0].herd_id;
  const tp = await pool.query("INSERT INTO token_pools (herd_id, total_supply) VALUES ($1, 40) RETURNING pool_id", [herdId]);
  for (const [inv, tokens, amt, k] of [[inv1, 12, 36000, "a"], [inv2, 8, 24000, "b"]]) {
    await pool.query("INSERT INTO ownership (user_id, pool_id, token_amount) VALUES ($1, $2, $3)", [inv.userId, tp.rows[0].pool_id, tokens]);
    await pool.query(
      "INSERT INTO investor_payments (herd_id, user_id, tokens, amount, stripe_payment_intent_id) VALUES ($1, $2, $3, $4, $5)",
      [herdId, inv.userId, tokens, amt, `pi_test20_${STAMP}_${tag}_${k}`]
    );
  }
  await pool.query("UPDATE herds SET tokens_sold = 20 WHERE herd_id = $1", [herdId]);
  // Every real feeder herd carries what was paid for it as its first cost.
  await pool.query(
    `INSERT INTO herd_expenses (herd_id, category, description, amount, billing_direction, source, created_by_user_id)
     VALUES ($1, 'purchase', 'Purchase price', 90000, 'self', 'purchase', $2)`,
    [herdId, owner.userId]
  );
  await pool.query(
    `INSERT INTO herd_releases (herd_id, producer_user_id, gross_amount, raise_fee_pct, raise_fee, per_head_fee, net_to_producer, status)
     VALUES ($1, $2, 60000, 0, 0, 0, 60000, 'paid')`,
    [herdId, owner.userId]
  );
  return herdId;
}

async function main() {
  console.log(`Track record story test against ${BASE}`);
  await cleanup();
  const adm = await api("POST", "/api/auth/login", { json: { username: ADMIN_USER, password: ADMIN_PASS } });
  if (!adm.data?.token) throw new Error("Admin login failed. Set ADMIN_USER and ADMIN_PASS.");
  const A = adm.data.token;
  const owner = await signupAndLogin("owner", "feedlot");
  const rancher = await signupAndLogin("rancher", "rancher");
  const inv1 = await signupAndLogin("inv1", "investor");
  const inv2 = await signupAndLogin("inv2", "investor");

  section("1. A producer with no history is labelled new");
  const empty = await api("GET", `/api/producers/${rancher.slug}/track-record`, { token: inv1.token });
  check("record loads (200)", empty.status === 200, JSON.stringify(empty.data));
  check("label is 'new'", empty.data?.label === "new");
  check("no herds, no outcomes", empty.data?.herds?.completedWithInvestors === 0 && empty.data?.investorOutcomes?.weightedOutcomePct === null);
  check("division is cow-calf for a rancher", empty.data?.producer?.division === "cow-calf");
  check("only the username is shown", Object.keys(empty.data.producer).sort().join() === "division,memberSince,slug");
  check("carries the plain notice", /say nothing certain about any future herd/.test(empty.data?.notice ?? ""));

  section("2. Three herds through the real sale engine");
  // Every herd also carries a 90,000 purchase cost (see makeHerd).
  // Herd A: costs 20,000 (with an invoice); sold for 150,000.
  const hA = await makeHerd(owner, inv1, inv2, "Alpha", "A");
  const cA = await api("POST", `/api/expenses/herds/${hA}`, { token: owner.token, json: { category: "feed", amount: 20000, vendorName: "Feed Co", invoiceNumber: "A-1" } });
  await api("POST", `/api/cost-review/expenses/${cA.data.expense.expenseId}/documents`, { token: owner.token, raw: pdf("A"), headers: { "Content-Type": "application/pdf", "X-Filename": "a.pdf" } });
  // Herd B: costs 20,000 (no invoice); sold for 100,000, a loss.
  const hB = await makeHerd(owner, inv1, inv2, "Bravo", "B");
  await api("POST", `/api/expenses/herds/${hB}`, { token: owner.token, json: { category: "feed", amount: 20000 } });
  // Herd C: two costs of 5,000 (one with an invoice); sold for 160,000; one dispute upheld.
  const hC = await makeHerd(owner, inv1, inv2, "Charlie", "C");
  const cC1 = await api("POST", `/api/expenses/herds/${hC}`, { token: owner.token, json: { category: "feed", amount: 5000, vendorName: "Hay Co", invoiceNumber: "C-1" } });
  await api("POST", `/api/cost-review/expenses/${cC1.data.expense.expenseId}/documents`, { token: owner.token, raw: pdf("C1"), headers: { "Content-Type": "application/pdf", "X-Filename": "c1.pdf" } });
  const cC2 = await api("POST", `/api/expenses/herds/${hC}`, { token: owner.token, json: { category: "vet", amount: 5000 } });
  const disp = await api("POST", `/api/cost-review/expenses/${cC2.data.expense.expenseId}/dispute`, { token: inv1.token, json: { note: "No bill was shown for this vet charge." } });
  check("investor disputes herd C's vet cost (201)", disp.status === 201);
  await api("POST", `/api/cost-review/disputes/${disp.data.disputeId}/resolve`, { token: A, json: { outcome: "upheld", note: "No bill could be produced." } });

  const sell = async (herdId, gross, buyer) => {
    const s = await api("POST", `/api/settlement/herds/${herdId}/sale`, { token: owner.token, json: { grossAmount: gross, headSold: 40, buyerName: buyer } });
    const id = s.data?.sale?.saleId ?? s.data?.saleId;
    const ap = await api("POST", `/api/settlement/sales/${id}/approve`, { token: A, json: { acknowledgeCostWarnings: true } });
    return ap;
  };
  check("herd A sold and approved (200)", (await sell(hA, 150000, "TEST20 Packer")).status === 200);
  check("herd B sold and approved (200)", (await sell(hB, 100000, "TEST20 Packer")).status === 200);
  check("herd C sold and approved (200)", (await sell(hC, 160000, "TEST20 Packer")).status === 200);

  // Worked by hand (no fee terms, so no exit fees):
  //   A: costs 110,000, sold 150,000, profit 40,000 -> +12,000 and +8,000 on capital: out 80,000 on 60,000 in
  //   B: costs 110,000, sold 100,000, loss   10,000 -> -3,000 and -2,000 off capital: out 55,000 on 60,000 in
  //   C: costs 100,000, sold 160,000, profit 60,000 -> +18,000 and +12,000 on capital: out 90,000 on 60,000 in
  section("3. The record matches the hand-worked numbers");
  const rec = await api("GET", `/api/producers/${owner.slug}/track-record`, { token: inv2.token });
  check("record loads (200)", rec.status === 200, JSON.stringify(rec.data));
  const r = rec.data;
  check("3 completed herds", r.herds.completedWithInvestors === 3);
  check("label is 'established'", r.label === "established");
  check("division is feeder", r.producer.division === "feeder");
  check("capital raised 180,000", r.investorOutcomes.capitalRaised === 180000);
  check("capital returned 225,000", r.investorOutcomes.capitalReturned === 225000);
  check("weighted outcome +25.00%", near(r.investorOutcomes.weightedOutcomePct, 25));
  check("2 herds made investors whole, 1 did not", r.investorOutcomes.herdsMadeWhole === 2 && r.investorOutcomes.herdsNotMadeWhole === 1);
  check("best +50.00%, worst -8.33%", near(r.investorOutcomes.bestOutcomePct, 50) && near(r.investorOutcomes.worstOutcomePct, -8.33));
  check("history lists the 3 herds", r.history.length === 3);
  const byName = Object.fromEntries(r.history.map((h) => [h.herdName.split(" ")[1], h]));
  check("herd A: 60,000 in, 80,000 out", byName.Alpha.paidIn === 60000 && byName.Alpha.paidOut === 80000 && byName.Alpha.madeWhole === true && near(byName.Alpha.outcomePct, 33.33));
  check("herd B: 60,000 in, 55,000 out, not made whole", byName.Bravo.paidIn === 60000 && byName.Bravo.paidOut === 55000 && byName.Bravo.madeWhole === false && near(byName.Bravo.outcomePct, -8.33));
  check("herd C: 60,000 in, 90,000 out", byName.Charlie.paidIn === 60000 && byName.Charlie.paidOut === 90000 && near(byName.Charlie.outcomePct, 50));
  check("each herd shows 2 investors", r.history.every((h) => h.investors === 2));
  check("4 typed-in costs, 2 with an invoice (50%)", r.costs.manualCosts === 4 && r.costs.withInvoice === 2 && near(r.costs.withInvoicePct, 50));
  check("1 cost was flagged", r.costs.everFlagged === 1);
  check("1 dispute raised and upheld, none open", r.disputes.raised === 1 && r.disputes.upheld === 1 && r.disputes.dismissed === 0 && r.disputes.open === 0);
  check("nothing open to investors now", r.herds.openToInvestorsNow === 0);

  section("4. Looking up by herd and by who can ask");
  const byHerd = await api("GET", `/api/producers/by-herd/${hA}/track-record`, { token: inv1.token });
  check("lookup by herd finds the owner's record (200)", byHerd.status === 200 && byHerd.data.producer.slug === owner.slug && byHerd.data.herds.completedWithInvestors === 3);
  check("an unknown herd is 404", (await api("GET", "/api/producers/by-herd/00000000-0000-4000-8000-000000000000/track-record", { token: inv1.token })).status === 404);
  check("a bad herd id is 400", (await api("GET", "/api/producers/by-herd/not-a-uuid/track-record", { token: inv1.token })).status === 400);
  check("an unknown producer is 404", (await api("GET", "/api/producers/nobody_here_xyz/track-record", { token: inv1.token })).status === 404);
  check("an investor's name is not a producer (404)", (await api("GET", `/api/producers/${inv1.slug}/track-record`, { token: inv2.token })).status === 404);
  check("a producer can read another's record (200)", (await api("GET", `/api/producers/${owner.slug}/track-record`, { token: rancher.token })).status === 200);
  check("no login is refused (401)", (await api("GET", `/api/producers/${owner.slug}/track-record`)).status === 401);
  check("the slug lookup ignores letter case", (await api("GET", `/api/producers/${owner.slug.toUpperCase()}/track-record`, { token: inv1.token })).status === 200);

  section("5. Herds still being sold do not count");
  const hD = await makeHerd(owner, inv1, inv2, "Delta", "D");
  const sD = await api("POST", `/api/settlement/herds/${hD}/sale`, { token: owner.token, json: { grossAmount: 80000, headSold: 40, buyerName: "TEST20 Packer" } });
  check("herd D's sale is waiting for approval (201)", sD.status === 201);
  const r2 = (await api("GET", `/api/producers/${owner.slug}/track-record`, { token: inv1.token })).data;
  check("a pending sale is not a completed herd", r2.herds.completedWithInvestors === 3 && r2.investorOutcomes.capitalRaised === 180000);
  const sid = sD.data?.sale?.saleId ?? sD.data?.saleId;
  await api("POST", `/api/settlement/sales/${sid}/reject`, { token: A, json: { note: "test" } });
  const r3 = (await api("GET", `/api/producers/${owner.slug}/track-record`, { token: inv1.token })).data;
  check("a rejected sale is not counted either", r3.herds.completedWithInvestors === 3);
  check("herd D is open to investors again", r3.herds.openToInvestorsNow === 1);

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
