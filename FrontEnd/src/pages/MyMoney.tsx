import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiCard, KpiCardSkeleton } from "@/components/common/KpiCard";
import { getMyMoney, usd, shortDate, STATE_LABELS } from "@/lib/money";
import type { MyMoney as MyMoneyData, MoneyHerd, HerdState } from "@/lib/money";

const STATE_STYLES: Record<HerdState, string> = {
  open: "bg-green-50 text-green-700 border-green-200",
  sale_pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  sold: "bg-slate-50 text-slate-600 border-slate-200",
  closed: "bg-slate-50 text-slate-600 border-slate-200",
};

function PaidInCell({ h }: { h: MoneyHerd }) {
  if (h.paidIn > 0 && h.estimatedExtra == null && h.unrecordedTokens === 0) {
    return <span className="font-medium">{usd(h.paidIn)}</span>;
  }
  return (
    <div>
      <span className="font-medium">{h.paidIn > 0 ? usd(h.paidIn) : "No payment on record"}</span>
      {h.estimatedExtra != null && h.estimatedExtra > 0 && (
        <p className="text-xs text-slate-500">
          plus about {usd(h.estimatedExtra)} (estimate) for {h.unrecordedTokens.toLocaleString()} tokens
          held before payments were recorded
        </p>
      )}
    </div>
  );
}

function PayoutCell({ h }: { h: MoneyHerd }) {
  if (h.payout) {
    const p = h.payout;
    return (
      <div>
        <span className="font-medium">{usd(p.amount)}</span>{" "}
        {p.status === "paid" ? (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            Paid {shortDate(p.paidAt)}
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
            Owed to you
          </Badge>
        )}
        {p.profit != null && (
          <p className={p.profit >= 0 ? "text-xs text-green-700" : "text-xs text-red-600"}>
            {p.profit >= 0 ? "Gain " : "Loss "}
            {usd(Math.abs(p.profit))}
          </p>
        )}
      </div>
    );
  }
  if (h.state === "sale_pending") return <span className="text-slate-500">Waiting for approval</span>;
  return <span className="text-slate-400">-</span>;
}

export function MyMoney() {
  const { slug } = useParams<{ slug: string }>();
  const resolvedSlug = slug ?? "";
  const [result, setResult] = useState<{ data: MyMoneyData | null; error: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    getMyMoney()
      .then((d) => alive && setResult({ data: d, error: null }))
      .catch((e: Error) => alive && setResult({ data: null, error: e.message || "Could not load your money." }));
    return () => {
      alive = false;
    };
  }, []);

  const loading = result === null;
  const data = result?.data ?? null;
  const error = result?.error ?? null;

  if (error) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-red-600">{error}</p>
        <button className="px-4 py-2 bg-slate-100 rounded text-sm" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  const t = data?.totals;
  const allHerds = data?.herds ?? [];
  // herds with a payment on record, a sale or a payout are the real investments;
  // the rest are older holdings from before payments were recorded
  const herds = allHerds.filter((h) => h.paidIn > 0 || h.payout || h.sale);
  const older = allHerds.filter((h) => !(h.paidIn > 0 || h.payout || h.sale));
  const nothing = !loading && data && allHerds.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Money</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          What you paid in, where each herd stands, and what you have been paid. These are the actual
          payment records, not estimates.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          <>
            <KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton />
          </>
        ) : t ? (
          <>
            <KpiCard label="Paid In" value={usd(t.paidIn)} subtitle="all payments on record" trend="neutral" />
            <KpiCard label="Still Invested" value={usd(t.stillInvested)} subtitle="in herds not yet sold" trend="neutral" />
            <KpiCard label="Paid To You" value={usd(t.receivedFromSales)} subtitle="from sold herds" trend="up" />
            <KpiCard
              label="Owed To You"
              value={usd(t.owedFromSales)}
              subtitle={t.owedFromSales > 0 ? "approved, not yet paid out" : "nothing waiting"}
              trend={t.owedFromSales > 0 ? "up" : "neutral"}
            />
          </>
        ) : null}
      </div>

      {!loading && t && t.estimatedExtra > 0 && (
        <p className="text-xs text-slate-500">
          Older holdings with no payment on record are listed separately at the bottom. They are not counted in
          "Paid In" above.
        </p>
      )}

      {(loading || nothing || herds.length > 0) && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your investments</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : nothing ? (
            <p className="p-6 text-center text-slate-500 text-sm">
              You have not invested in a herd yet.{" "}
              <Link to={`/investor/${resolvedSlug}/holdings`} className="text-blue-600 hover:underline">
                Browse the lots
              </Link>
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 font-medium">Herd</th>
                    <th className="px-4 py-2 font-medium">Your share</th>
                    <th className="px-4 py-2 font-medium">You paid</th>
                    <th className="px-4 py-2 font-medium">Where it stands</th>
                    <th className="px-4 py-2 font-medium">Your payout</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {herds.map((h) => (
                    <tr key={h.herdId} className="align-top">
                      <td className="px-4 py-3">
                        {h.state === "open" ? (
                          <Link
                            to={`/investor/${resolvedSlug}/holdings/${h.herdId}`}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            {h.herdName}
                          </Link>
                        ) : (
                          // a herd that is sold or in a sale no longer has a lots page; its statement is the record
                          <span className="font-medium">{h.herdName}</span>
                        )}
                        <p className="text-xs text-slate-500">
                          {h.producerType === "feeder" ? "Feeder herd" : "Cow-calf herd"}
                          {h.headCount != null ? ` - ${h.headCount} head` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {h.tokens.toLocaleString()} tokens
                        {h.sharePct != null && <p className="text-xs text-slate-500">{h.sharePct}% of the herd</p>}
                      </td>
                      <td className="px-4 py-3"><PaidInCell h={h} /></td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={STATE_STYLES[h.state] + " whitespace-nowrap"}>
                          {STATE_LABELS[h.state]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3"><PayoutCell h={h} /></td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {h.sale ? (
                          <Link
                            to={`/investor/${resolvedSlug}/statements/${h.sale.saleId}`}
                            className="text-blue-600 hover:underline"
                          >
                            {h.sale.status === "approved" ? "Statement" : "Preview statement"}
                          </Link>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {!loading && herds.some((h) => h.payments.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your payments</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y text-sm">
              {herds.flatMap((h) =>
                h.payments.map((p) => (
                  <li key={p.paymentId} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <span>
                      <span className="font-medium">{h.herdName}</span>
                      <span className="text-slate-500"> - {p.tokens.toLocaleString()} tokens</span>
                    </span>
                    <span className="text-right">
                      <span className="font-medium">{usd(p.amount)}</span>
                      <span className="text-xs text-slate-400 ml-3">{shortDate(p.paidAt)}</span>
                    </span>
                  </li>
                ))
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {!loading && older.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Older holdings with no payment on record</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <p className="px-4 pb-2 text-xs text-slate-500">
              You hold tokens in these herds, but no payment was recorded for them. The amounts are estimates
              (your tokens x the herd's listing price / total tokens). If one of these herds sells, the
              settlement uses the same estimate.
            </p>
            <ul className="divide-y text-sm">
              {older.map((h) => (
                <li key={h.herdId} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span>
                    <Link
                      to={`/investor/${resolvedSlug}/holdings/${h.herdId}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {h.herdName}
                    </Link>
                    <span className="text-slate-500">
                      {" "}- {h.tokens.toLocaleString()} tokens{h.sharePct != null ? `, ${h.sharePct}%` : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    {h.estimatedExtra != null ? "about " + usd(h.estimatedExtra) : "-"}
                    <span className="text-xs text-slate-400 ml-3">{STATE_LABELS[h.state]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
