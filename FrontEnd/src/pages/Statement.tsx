import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getStatement, usd, shortDate, costLabel } from "@/lib/money";
import type { Statement as StatementData } from "@/lib/money";

function Row({
  label,
  value,
  strong,
  note,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  note?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className={"flex items-start justify-between gap-4 py-2 " + (strong ? "border-t font-semibold" : "")}>
      <div>
        <span>{label}</span>
        {note && <p className="text-xs text-slate-500 font-normal">{note}</p>}
      </div>
      <span className={tone === "good" ? "text-green-700" : tone === "bad" ? "text-red-600" : ""}>{value}</span>
    </div>
  );
}

export function Statement() {
  const { slug, saleId } = useParams<{ slug: string; saleId: string }>();
  const resolvedSlug = slug ?? "";
  // the result is stored with the sale it belongs to, so a new saleId shows "loading" at once
  const [result, setResult] = useState<{ saleId: string; data: StatementData | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!saleId) return;
    let alive = true;
    getStatement(saleId)
      .then((d) => alive && setResult({ saleId, data: d, error: null }))
      .catch((e: Error) =>
        alive && setResult({ saleId, data: null, error: e.message || "Could not load this statement." })
      );
    return () => {
      alive = false;
    };
  }, [saleId]);

  const current = result && result.saleId === saleId ? result : null;
  const loading = !current;
  const data = current?.data ?? null;
  const error = current?.error ?? null;

  const back = (
    <Link to={`/investor/${resolvedSlug}/money`} className="hover:underline">
      My Money
    </Link>
  );

  if (error) {
    return (
      <div className="space-y-4">
        <nav className="flex items-center gap-1 text-sm text-slate-500">
          {back}
        </nav>
        <div className="p-8 text-center space-y-3">
          <h2 className="text-lg font-semibold">Statement not available</h2>
          <p className="text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  const you = data?.you ?? null;
  const preview = data?.statementStatus === "preview";
  const gain = you?.profit != null ? you.profit >= 0 : true;

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-sm text-slate-500">
        {back}
        <ChevronRight className="h-3.5 w-3.5" />
        {loading ? <Skeleton className="h-4 w-24" /> : <span>{data?.sale.herdName}</span>}
      </nav>

      {loading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Settlement statement - {data.sale.herdName}</h1>
            {preview ? (
              <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                Preview - not yet approved
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                Final
              </Badge>
            )}
          </div>
          {preview && (
            <p className="text-sm text-slate-600">
              This sale is waiting for approval. These numbers are what the split would be today. They are
              final once the sale is approved.
            </p>
          )}

          {data.warnings.length > 0 && (
            <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 space-y-1">
              {data.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          )}

          {you ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your money</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <Row
                  label="What you paid in"
                  value={usd(you.costBasis)}
                  note={
                    you.costBasisEstimated
                      ? "Part of this is an estimate: some of your tokens have no payment on record."
                      : undefined
                  }
                />
                <Row label="Your money back" value={usd(you.capitalReturned)} note="Investors get what they paid in first." />
                <Row
                  label={you.profitShare != null && you.profitShare < 0 ? "Your share of the loss" : "Your share of the profit"}
                  value={usd(you.profitShare)}
                  note={you.sharePct != null ? `You hold ${you.tokens.toLocaleString()} tokens, ${you.sharePct}% of the herd.` : undefined}
                  tone={you.profitShare != null && you.profitShare < 0 ? "bad" : undefined}
                />
                <Row
                  label="Exit fee"
                  value={you.feeAmount > 0 ? "-" + usd(you.feeAmount) : usd(0)}
                  note={you.feeAmount > 0 ? "A fee on your profit, as agreed for this herd." : "No exit fee on this sale."}
                />
                <Row label={preview ? "You would receive" : "You receive"} value={usd(you.amount)} strong />
                {you.profit != null && (
                  <Row
                    label={gain ? "Your gain on this herd" : "Your loss on this herd"}
                    value={
                      usd(Math.abs(you.profit)) +
                      (you.returnPct != null ? ` (${you.returnPct >= 0 ? "+" : ""}${you.returnPct}%)` : "")
                    }
                    tone={gain ? "good" : "bad"}
                  />
                )}
                <div className="mt-3 text-slate-600">
                  {preview ? (
                    <span>Not paid yet - waiting for the sale to be approved.</span>
                  ) : you.status === "paid" ? (
                    <span>
                      Paid {shortDate(you.paidAt)}
                      {you.paymentReference ? `, reference ${you.paymentReference}` : ""}.
                    </span>
                  ) : (
                    <span>Approved and owed to you. It has not been paid out yet.</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-slate-600">You have no line on this sale.</p>
          )}

          <div className="grid lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">The sale</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <Row label="Sale date" value={shortDate(data.sale.saleDate)} />
                <Row label="Buyer" value={data.sale.buyerName ?? data.sale.buyerSlug ?? "-"} />
                {data.load.headSold != null && (
                  <Row
                    label="Head sold"
                    value={String(data.load.headSold)}
                    note={data.load.headLost ? `${data.load.headLost} head lost before the sale` : undefined}
                  />
                )}
                {data.load.liveWeightLbs != null && (
                  <Row
                    label="Live weight"
                    value={`${data.load.liveWeightLbs.toLocaleString()} lb`}
                    note={data.load.avgWeightPerHead != null ? `${data.load.avgWeightPerHead} lb per head` : undefined}
                  />
                )}
                {data.load.pricePerCwt != null && <Row label="Price per hundredweight" value={usd(data.load.pricePerCwt)} />}
                <Row label="Sale price" value={usd(data.proceeds.salePrice)} />
                {data.proceeds.lrpIndemnity > 0 && (
                  <Row label="Price-protection (LRP) payout" value={usd(data.proceeds.lrpIndemnity)} />
                )}
                <Row label="Total proceeds" value={usd(data.proceeds.total)} strong />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">What the herd cost</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {data.costs.byCategory.length === 0 && <p className="text-slate-500">No costs were recorded.</p>}
                {data.costs.byCategory.map((c) => (
                  <Row key={c.category} label={costLabel(c.category)} value={usd(c.amount)} />
                ))}
                <Row label="Total costs" value={usd(data.costs.total)} strong />
                <Row
                  label={data.profit >= 0 ? "Profit on the herd" : "Loss on the herd"}
                  value={usd(Math.abs(data.profit))}
                  note="Total proceeds less total costs, before anyone is paid."
                  tone={data.profit >= 0 ? "good" : "bad"}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
