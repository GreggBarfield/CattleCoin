import { Link, useNavigate } from "react-router-dom";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VerifiedBadge } from "@/components/common/VerifiedBadge";
import { DIVISION_LABELS, ENDORSEMENT_LABELS, TRACK_LABELS, price } from "@/lib/marketplace";
import type { MarketLot } from "@/lib/marketplace";

const DIVISION_STYLES: Record<MarketLot["division"], string> = {
  "cow-calf": "bg-green-50 text-green-700 border-green-200",
  feeder: "bg-orange-50 text-orange-700 border-orange-200",
};

function lrpText(l: MarketLot): { main: string; sub: string | null } {
  if (!l.lrp) return { main: "None on file", sub: null };
  const p = l.lrp;
  const bits: string[] = [];
  if (p.floorPriceCwt != null) bits.push(`floor ${price(p.floorPriceCwt)}/cwt`);
  if (p.coveragePct != null) bits.push(`${p.coveragePct}% coverage`);
  const main = bits.length ? bits.join(", ") : ENDORSEMENT_LABELS[p.endorsementType] ?? "LRP";
  return { main, sub: p.agentVerified ? "Verified by an insurance agent" : "Recorded by the producer, not yet verified" };
}

function exitFeeText(l: MarketLot): string {
  if (!l.exitFee) return "None on file";
  const who = l.exitFee.paidBy === "producer" ? "paid by the producer" : "of your profit";
  return `${l.exitFee.pct}% ${who}`;
}

export function LotsTable({ lots, slug }: { lots: MarketLot[]; slug: string }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lot</TableHead>
            <TableHead>Price per token</TableHead>
            <TableHead>Tokens left</TableHead>
            <TableHead>Price protection (LRP)</TableHead>
            <TableHead>Exit fee</TableHead>
            <TableHead>You hold</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lots.map((l) => {
            const lrp = lrpText(l);
            return (
              <TableRow
                key={l.herdId}
                className="cursor-pointer"
                onClick={() => navigate(`/investor/${slug}/holdings/${l.herdId}`)}
              >
                <TableCell>
                  <p className="font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.breed} - {l.headCount} head
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={DIVISION_STYLES[l.division]}>
                      {DIVISION_LABELS[l.division]}
                    </Badge>
                    <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">
                      {TRACK_LABELS[l.track]}
                    </Badge>
                    <VerifiedBadge verified={l.verified} showLabel />
                  </div>
                </TableCell>
                <TableCell className="font-medium">{price(l.pricePerToken)}</TableCell>
                <TableCell>
                  {l.tokensOffered > 0 && l.tokensRemaining === 0 ? (
                    <span className="text-slate-500">Fully subscribed</span>
                  ) : (
                    <span>
                      <span className="font-medium">{l.tokensRemaining.toLocaleString()}</span> of{" "}
                      {l.tokensOffered.toLocaleString()}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <p className={l.lrp ? "" : "text-slate-500"}>{lrp.main}</p>
                  {lrp.sub && <p className="text-xs text-muted-foreground">{lrp.sub}</p>}
                </TableCell>
                <TableCell className={l.exitFee ? "" : "text-slate-500"}>{exitFeeText(l)}</TableCell>
                <TableCell>{l.myTokens > 0 ? `${l.myTokens.toLocaleString()} tokens` : <span className="text-slate-400">-</span>}</TableCell>
                <TableCell className="text-right">
                  {l.canInvest && (
                    <Button asChild size="sm" onClick={(e) => e.stopPropagation()}>
                      <Link to={`/invest/${l.herdId}`}>Invest</Link>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
