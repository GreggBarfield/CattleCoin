import { dollars } from "./routeHelpers.js";

// A producer's track record, built from the ledger (sales, payouts, costs,
// disputes) and never typed in by anyone. Facts only: no score, no stars.
//
// What counts as a completed herd: a herd the producer owned, that had real
// investor money paid in (investor_payments), and whose sale an admin approved.
// For each one the investors' outcome is what they were paid (their payout rows,
// after any exit fee) against what they paid in.
//
// What is NOT here, on purpose:
//   - Payout timing. The platform holds the money and an admin marks payouts
//     paid, so a late payout is the platform's, not the producer's.
//   - Cost-versus-market benchmarks. Needs more herds on the platform first.
//   - Reviews. Not built.

export const NOTICE =
  "Results of herds this producer has already sold, as recorded by CattleCoin. " +
  "They say nothing certain about any future herd; cattle prices and costs change.";

// "new" = no completed herd with investors yet; "limited" = 1 or 2; "established" = 3 or more.
export const labelFor = (completed) => (completed === 0 ? "new" : completed < 3 ? "limited" : "established");

const cents = (v) => Math.round(Number(v) * 100);
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 10000) / 100 : null);

export async function getTrackRecord(db, producerUserId) {
  const who = await db.query(
    "SELECT user_id, slug, role, created_at FROM users WHERE user_id = $1 AND role IN ('rancher', 'feedlot')",
    [producerUserId]
  );
  if (who.rowCount === 0) return null;
  const u = who.rows[0];

  // Completed herds with investor money, one row each.
  const sold = await db.query(
    `SELECT s.sale_id, s.herd_id, h.herd_name, s.sale_date::text AS sale_date, s.decided_at,
            (SELECT COALESCE(SUM(ip.amount), 0) FROM investor_payments ip WHERE ip.herd_id = s.herd_id) AS paid_in,
            (SELECT COALESCE(SUM(p.amount), 0)
               FROM herd_payouts p
              WHERE p.sale_id = s.sale_id AND p.recipient_type = 'investor'
                AND EXISTS (SELECT 1 FROM investor_payments ip WHERE ip.herd_id = s.herd_id AND ip.user_id = p.user_id)
            ) AS paid_out,
            (SELECT COUNT(DISTINCT ip.user_id) FROM investor_payments ip WHERE ip.herd_id = s.herd_id) AS investors
       FROM herd_sales s
       JOIN herds h ON h.herd_id = s.herd_id
      WHERE s.seller_user_id = $1 AND s.status = 'approved'
        AND EXISTS (SELECT 1 FROM investor_payments ip WHERE ip.herd_id = s.herd_id)
      ORDER BY s.decided_at, s.sale_id`,
    [producerUserId]
  );
  const history = sold.rows.map((r) => {
    const inC = cents(r.paid_in);
    const outC = cents(r.paid_out);
    return {
      herdName: r.herd_name, saleDate: r.sale_date, investors: Number(r.investors),
      paidIn: dollars(inC), paidOut: dollars(outC),
      outcomePct: pct(outC - inC, inC), madeWhole: outC >= inC,
    };
  });
  const totalIn = sold.rows.reduce((a, r) => a + cents(r.paid_in), 0);
  const totalOut = sold.rows.reduce((a, r) => a + cents(r.paid_out), 0);
  const outcomes = history.map((h) => h.outcomePct).filter((x) => x !== null);

  // Costs the producer typed in, on herds that have had investors.
  const costs = await db.query(
    `SELECT COUNT(*) AS manual_costs,
            COUNT(*) FILTER (WHERE e.verification_status IN ('documented', 'verified')) AS with_invoice
       FROM herd_expenses e
       JOIN herds h ON h.herd_id = e.herd_id
      WHERE h.rancher_id = $1 AND e.source = 'manual' AND e.status = 'active'
        AND EXISTS (SELECT 1 FROM investor_payments ip WHERE ip.herd_id = e.herd_id)`,
    [producerUserId]
  );
  const flagged = await db.query(
    `SELECT COUNT(DISTINCT x.expense_id) AS n
       FROM herd_expense_history x JOIN herds h ON h.herd_id = x.herd_id
      WHERE h.rancher_id = $1 AND x.action = 'flag'`,
    [producerUserId]
  );
  const disputes = await db.query(
    `SELECT COUNT(*) AS raised,
            COUNT(*) FILTER (WHERE d.status = 'upheld') AS upheld,
            COUNT(*) FILTER (WHERE d.status = 'dismissed') AS dismissed,
            COUNT(*) FILTER (WHERE d.status = 'open') AS open_now
       FROM herd_expense_disputes d JOIN herds h ON h.herd_id = d.herd_id
      WHERE h.rancher_id = $1`,
    [producerUserId]
  );
  const openNow = await db.query(
    "SELECT COUNT(*) AS n FROM herds WHERE rancher_id = $1 AND feedlot_status = 'listed'",
    [producerUserId]
  );

  const manualCosts = Number(costs.rows[0].manual_costs);
  const withInvoice = Number(costs.rows[0].with_invoice);
  const d = disputes.rows[0];
  const completed = history.length;

  return {
    producer: { slug: u.slug, division: u.role === "feedlot" ? "feeder" : "cow-calf", memberSince: u.created_at },
    label: labelFor(completed),
    herds: { completedWithInvestors: completed, openToInvestorsNow: Number(openNow.rows[0].n) },
    investorOutcomes: {
      capitalRaised: dollars(totalIn),
      capitalReturned: dollars(totalOut),
      weightedOutcomePct: pct(totalOut - totalIn, totalIn),
      herdsMadeWhole: history.filter((h) => h.madeWhole).length,
      herdsNotMadeWhole: history.filter((h) => !h.madeWhole).length,
      bestOutcomePct: outcomes.length ? Math.max(...outcomes) : null,
      worstOutcomePct: outcomes.length ? Math.min(...outcomes) : null,
    },
    costs: {
      manualCosts, withInvoice, withInvoicePct: pct(withInvoice, manualCosts),
      everFlagged: Number(flagged.rows[0].n),
    },
    disputes: {
      raised: Number(d.raised), upheld: Number(d.upheld), dismissed: Number(d.dismissed), open: Number(d.open_now),
    },
    history,
    notice: NOTICE,
  };
}
