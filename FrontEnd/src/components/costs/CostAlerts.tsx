import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { getMyAlerts, type CostAlert } from "@/lib/costReview";
import { usd, shortDate } from "@/lib/money";

// "New costs" notice for an investor: costs the producer added to herds they
// hold since they last opened that herd, and any of their questions that got a ruling.
// Stays out of the way when there is nothing new (or the server says no).
export function CostAlerts({ slug }: { slug: string }) {
  const [alerts, setAlerts] = useState<CostAlert[]>([]);

  useEffect(() => {
    let alive = true;
    getMyAlerts()
      .then((r) => alive && setAlerts(r.alerts))
      .catch(() => alive && setAlerts([]));
    return () => { alive = false; };
  }, []);

  if (alerts.length === 0) return null;
  return (
    <Card className="border-amber-300 bg-amber-50/40" data-testid="cost-alerts">
      <CardHeader><CardTitle className="text-base">New on your herds</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {alerts.map((a) => (
          <div key={a.herdId} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <span className="font-medium">{a.herdName}</span>
              {a.newCostCount > 0 && (
                <>: {a.newCostCount} new cost{a.newCostCount === 1 ? "" : "s"} totalling {usd(a.newCostTotal)} since {shortDate(a.since)}
                  {a.newWithoutInvoice > 0 ? ` (${a.newWithoutInvoice} with no invoice)` : ""}</>
              )}
              {a.myDisputesRuledOn > 0 && (
                <>{a.newCostCount > 0 ? "; " : ": "}{a.myDisputesRuledOn} of your questions {a.myDisputesRuledOn === 1 ? "has" : "have"} been ruled on</>
              )}
            </span>
            <Link to={`/investor/${slug}/holdings/${a.herdId}`} className="text-blue-600 hover:underline">Review</Link>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
