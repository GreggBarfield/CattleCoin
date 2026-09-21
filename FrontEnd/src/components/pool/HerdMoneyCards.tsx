import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getMyMoney,
  getHerdCosts,
  getHerdLrp,
  usd,
  shortDate,
  costLabel,
  STATE_LABELS,
} from "@/lib/money";
import type { MoneyHerd, HerdCosts, HerdLrpPolicy } from "@/lib/money";

// The money side of one herd, for an investor who holds it: what they paid in,
// what the herd has cost so far, and any price-protection (LRP) policy on file.
// Each piece loads on its own and simply stays out of the way if the server
// says the investor may not see it (for example a herd they have no stake in).
export function HerdMoneyCards({ herdId, slug }: { herdId: string; slug: string }) {
  const [mine, setMine] = useState<MoneyHerd | null>(null);
  const [costs, setCosts] = useState<HerdCosts | null>(null);
  const [policies, setPolicies] = useState<HerdLrpPolicy[]>([]);

  useEffect(() => {
    let alive = true;
    getMyMoney()
      .then((m) => alive && setMine(m.herds.find((h) => h.herdId === herdId) ?? null))
      .catch(() => alive && setMine(null));
    getHerdCosts(herdId)
      .then((c) => alive && setCosts(c))
      .catch(() => alive && setCosts(null));
    getHerdLrp(herdId)
      .then((l) => alive && setPolicies(l.policies))
      .catch(() => alive && setPolicies([]));
    return () => {
      alive = false;
    };
  }, [herdId]);

  if (!mine && !costs && policies.length === 0) return null;

  const activeCosts = costs ? costs.expenses.filter((e) => e.status === "active") : [];

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {mine && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your money in this herd</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex justify-between">
              <span>You paid</span>
              <span className="font-medium">{mine.paidIn > 0 ? usd(mine.paidIn) : "No payment on record"}</span>
            </div>
            {mine.estimatedExtra != null && mine.estimatedExtra > 0 && (
              <p className="text-xs text-slate-500">
                Plus about {usd(mine.estimatedExtra)} (estimate) for tokens held before payments were recorded.
              </p>
            )}
            <div className="flex justify-between">
              <span>Where it stands</span>
              <Badge variant="outline">{STATE_LABELS[mine.state]}</Badge>
            </div>
            {mine.payout && (
              <div className="flex justify-between">
                <span>{mine.payout.status === "paid" ? "Paid to you" : "Owed to you"}</span>
                <span className="font-medium">{usd(mine.payout.amount)}</span>
              </div>
            )}
            {mine.sale && (
              <Link
                to={`/investor/${slug}/statements/${mine.sale.saleId}`}
                className="block pt-1 text-blue-600 hover:underline"
              >
                {mine.sale.status === "approved" ? "See the settlement statement" : "See the statement preview"}
              </Link>
            )}
            <Link to={`/investor/${slug}/money`} className="block text-blue-600 hover:underline">
              All my money
            </Link>
          </CardContent>
        </Card>
      )}

      {costs && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What this herd has cost so far</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {Object.keys(costs.byCategory).length === 0 ? (
              <p className="text-slate-500">No costs recorded yet.</p>
            ) : (
              <div className="divide-y">
                {Object.entries(costs.byCategory).map(([cat, amt]) => (
                  <div key={cat} className="flex justify-between py-1.5">
                    <span>{costLabel(cat)}</span>
                    <span>{usd(amt)}</span>
                  </div>
                ))}
                <div className="flex justify-between py-1.5 font-semibold">
                  <span>Total</span>
                  <span>{usd(costs.total)}</span>
                </div>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">
              When the herd sells, costs come off the sale price first. You get your own money back before
              profit is shared.
            </p>
            {activeCosts.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-blue-600">Every cost, by date</summary>
                <ul className="mt-2 divide-y text-xs">
                  {activeCosts.map((e) => (
                    <li key={e.expenseId} className="flex justify-between gap-3 py-1">
                      <span>
                        {shortDate(e.accruedDate)} - {costLabel(e.category)}
                        {e.description ? ` (${e.description})` : ""}
                      </span>
                      <span>{usd(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {policies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Price protection (LRP)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            {policies.map((p) => (
              <div key={p.policyId} className="space-y-1">
                {p.floorPriceCwt != null && (
                  <div className="flex justify-between">
                    <span>Price floor</span>
                    <span className="font-medium">{usd(p.floorPriceCwt)} per cwt</span>
                  </div>
                )}
                {p.coverageLevelPct != null && (
                  <div className="flex justify-between">
                    <span>Coverage level</span>
                    <span>{p.coverageLevelPct}%</span>
                  </div>
                )}
                {p.premiumAmount != null && (
                  <div className="flex justify-between">
                    <span>Premium paid</span>
                    <span>{usd(p.premiumAmount)}</span>
                  </div>
                )}
                {(p.effectiveDate || p.endDate) && (
                  <div className="flex justify-between">
                    <span>Covers</span>
                    <span>
                      {shortDate(p.effectiveDate)} to {shortDate(p.endDate)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Checked with an insurance agent</span>
                  <span>{p.agentVerified ? "Yes" : "Not yet"}</span>
                </div>
              </div>
            ))}
            <p className="text-xs text-slate-500">
              A price floor protects against a fall in cattle prices only. It does not cover death loss, feed
              costs or health problems. CattleCoin does not sell or check insurance; this is the producer's
              record of a policy bought through an agent.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
