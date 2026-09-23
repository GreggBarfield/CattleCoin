import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getMyPayouts, RECIPIENT_LABEL, usd, shortDate, type MyPayout } from "@/lib/rancherMoney";

// Pass 2 of My Herds (punch list #3, tracker D7): what the rancher is owed or
// has been paid from approved sales. Read-only; CattleCoin marks each payout
// paid (with a reference) once the money has actually gone out.

export function MyPayouts({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<MyPayout[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyPayouts()
      .then((r) => { setRows(r); setError(null); })
      .catch((e) => setError(e instanceof Error && e.message ? e.message : "Could not load your payouts."));
  }, [refreshKey]);

  const owed = (rows ?? []).filter((p) => p.status === "owed").reduce((s, p) => s + p.amount, 0);
  const paid = (rows ?? []).filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);

  return (
    <Card className="rounded-3xl" data-testid="my-payouts">
      <CardHeader>
        <CardTitle className="text-base">My payouts</CardTitle>
        <CardDescription>
          Money owed to you from approved sales, and what CattleCoin has already paid.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {rows === null && !error && <Skeleton className="h-16 w-full" />}
        {rows && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No payouts yet. They show up here once a sale is approved.</p>
        )}
        {rows && rows.length > 0 && (
          <>
            <p className="text-sm">
              <span className="text-muted-foreground">Owed to you: </span><span className="font-semibold">{usd(owed)}</span>
              <span className="ml-6 text-muted-foreground">Paid so far: </span><span className="font-semibold">{usd(paid)}</span>
            </p>
            <ul className="space-y-2">
              {rows.map((p) => (
                <li key={p.payoutId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3" data-testid="payout-row">
                  <div>
                    <p className="text-sm font-medium">{p.herdName}</p>
                    <p className="text-xs text-muted-foreground">
                      Sold {shortDate(p.saleDate)} - {RECIPIENT_LABEL[p.recipientType] ?? p.recipientType}
                      {p.status === "paid" ? ` - paid ${shortDate(p.paidAt)}${p.paymentReference ? `, ref ${p.paymentReference}` : ""}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{usd(p.amount)}</span>
                    {p.status === "paid"
                      ? <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-900">Paid</Badge>
                      : <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Owed</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default MyPayouts;
