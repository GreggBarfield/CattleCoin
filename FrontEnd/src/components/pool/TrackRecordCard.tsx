import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getTrackRecordByHerd, pctText, type TrackRecord } from "@/lib/costReview";
import { usd, shortDate } from "@/lib/money";

const LABEL_TEXT: Record<TrackRecord["label"], string> = {
  new: "New producer - no completed herds with investors yet",
  limited: "Limited record - 1 or 2 completed herds",
  established: "Established - 3 or more completed herds",
};

// The producer's record, read from the ledger. Facts only, no score. Stays out
// of the way if the server will not show it.
export function TrackRecordCard({ herdId }: { herdId: string }) {
  const [rec, setRec] = useState<TrackRecord | null>(null);

  useEffect(() => {
    let alive = true;
    getTrackRecordByHerd(herdId)
      .then((r) => alive && setRec(r))
      .catch(() => alive && setRec(null));
    return () => { alive = false; };
  }, [herdId]);

  if (!rec) return null;
  const o = rec.investorOutcomes;
  const done = rec.herds.completedWithInvestors;

  return (
    <Card data-testid="track-record">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Producer track record: {rec.producer.slug}</CardTitle>
          <Badge variant="outline">{rec.label === "new" ? "New" : rec.label === "limited" ? "Limited record" : "Established"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-slate-600">{LABEL_TEXT[rec.label]}</p>

        {done > 0 && (
          <div className="divide-y">
            <Row k="Herds sold with investors" v={String(done)} />
            <Row k="Investors made whole" v={`${o.herdsMadeWhole} of ${done}`} />
            <Row k="Investor money in / back" v={`${usd(o.capitalRaised)} / ${usd(o.capitalReturned)}`} />
            <Row k="Overall investor result" v={pctText(o.weightedOutcomePct)} />
            <Row k="Best / worst herd" v={`${pctText(o.bestOutcomePct)} / ${pctText(o.worstOutcomePct)}`} />
          </div>
        )}

        <div className="divide-y">
          <Row
            k="Costs with an invoice"
            v={rec.costs.manualCosts === 0 ? "none logged yet" : `${rec.costs.withInvoice} of ${rec.costs.manualCosts} (${Math.round(rec.costs.withInvoicePct ?? 0)}%)`}
          />
          <Row k="Costs ever flagged" v={String(rec.costs.everFlagged)} />
          <Row
            k="Investor questions on costs"
            v={`${rec.disputes.raised} raised, ${rec.disputes.upheld} upheld, ${rec.disputes.dismissed} dismissed`}
          />
        </div>

        {rec.history.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-blue-600">Herd by herd</summary>
            <ul className="mt-2 divide-y text-xs">
              {rec.history.map((h, i) => (
                <li key={`${h.herdName}-${i}`} className="flex justify-between gap-3 py-1">
                  <span>{h.herdName} - sold {shortDate(h.saleDate)}, {h.investors} investor{h.investors === 1 ? "" : "s"}</span>
                  <span>{usd(h.paidIn)} in, {usd(h.paidOut)} back ({pctText(h.outcomePct)})</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="text-xs text-slate-500">{rec.notice}</p>
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <span>{k}</span>
      <span className="font-medium text-right">{v}</span>
    </div>
  );
}
