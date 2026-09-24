import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import {
  getMySales, acceptSale, declineSale, offerState, OFFER_STATE_LABEL, usd, shortDate,
  type Sale, type OfferState,
} from "@/lib/rancherMoney";

// Fix #14 (tracker FD-A1): offers to buy a herd. A rancher (or another feedlot)
// can send a sale to a CattleCoin feedlot; the buyer has to accept it before
// CattleCoin can approve it, and the herd only moves to the buyer's account on
// approval. This card is where the buyer answers. The buyer sees the deal
// (price, load, LRP payout) - never how the seller's investors and providers
// split the money (the server leaves that out for a buyer).

const STATE_STYLE: Record<OfferState, string> = {
  answer: "border-amber-300 bg-amber-50 text-amber-900",
  accepted: "border-sky-300 bg-sky-50 text-sky-900",
  approved: "border-emerald-300 bg-emerald-50 text-emerald-900",
  declined: "border-border bg-muted text-muted-foreground",
  cancelled: "border-border bg-muted text-muted-foreground",
  rejected: "border-border bg-muted text-muted-foreground",
};

const EARLIER_LIMIT = 5;

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

type Mode = "none" | "accept" | "decline";

function OfferCard({
  sale, state, onAnswered,
}: {
  sale: Sale;
  state: OfferState;
  onAnswered: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("none");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headText =
    sale.headSold != null ? `${sale.headSold} head${sale.headLost ? ` (${sale.headLost} lost)` : ""}` : "-";

  async function answer(kind: "accept" | "decline") {
    setBusy(true);
    setError(null);
    try {
      const trimmed = note.trim();
      const r = kind === "accept"
        ? await acceptSale(sale.saleId, trimmed || undefined)
        : await declineSale(sale.saleId, trimmed || undefined);
      onAnswered(r.message);
    } catch (e) {
      setError(errMsg(e, kind === "accept" ? "Could not accept this sale." : "Could not decline this sale."));
      setBusy(false);
    }
  }

  return (
    <li className="space-y-3 rounded-xl border border-border p-4" data-testid="offer-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{sale.herdName ?? "Herd"}</p>
          <p className="text-xs text-muted-foreground">
            From {sale.sellerSlug ?? "the seller"} - sent {shortDate(sale.submittedAt)}
          </p>
        </div>
        <Badge variant="outline" className={STATE_STYLE[state]}>{OFFER_STATE_LABEL[state]}</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Fact label="Price">{usd(sale.grossAmount)}</Fact>
        <Fact label="Head">{headText}</Fact>
        <Fact label="Live weight">{sale.liveWeightLbs != null ? `${sale.liveWeightLbs.toLocaleString("en-US")} lb` : "-"}</Fact>
        <Fact label="Price per cwt">{sale.pricePerCwt != null ? usd(sale.pricePerCwt) : "-"}</Fact>
        {sale.lrpIndemnity > 0 && <Fact label="LRP payout">{usd(sale.lrpIndemnity)}</Fact>}
        <Fact label="Sale date">{shortDate(sale.saleDate)}</Fact>
      </dl>

      {sale.warnings.map((w) => (
        <p key={w} className="text-xs text-amber-800">{w}</p>
      ))}
      {sale.buyerResponseNote && state !== "answer" && (
        <p className="text-xs text-muted-foreground">Your note: {sale.buyerResponseNote}</p>
      )}
      {state === "approved" && (
        <p className="text-xs text-muted-foreground">
          CattleCoin approved this sale. The herd is now in your account under My Herds.
        </p>
      )}
      {state === "accepted" && (
        <p className="text-xs text-muted-foreground">
          You said yes. CattleCoin still has to approve it - the herd moves to your account then.
        </p>
      )}

      {state === "answer" && mode === "none" && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => { setMode("accept"); setError(null); }}>Accept sale</Button>
          <Button variant="outline" onClick={() => { setMode("decline"); setError(null); }}>Decline</Button>
        </div>
      )}

      {state === "answer" && mode !== "none" && (
        <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/60 p-4">
          <p className="text-sm font-medium">
            {mode === "accept"
              ? `Buy ${headText} of ${sale.herdName ?? "this herd"} for ${usd(sale.grossAmount)}?`
              : `Turn down this offer for ${sale.herdName ?? "this herd"}?`}
          </p>
          <p className="text-xs text-muted-foreground">
            {mode === "accept"
              ? "This sends the sale to CattleCoin for approval. The herd moves to your account once it is approved. You can't take this back yourself."
              : "The sale is closed and the herd goes back to the seller. This can't be undone."}
          </p>
          <div className="grid max-w-md gap-1.5">
            <Label htmlFor={`offer-note-${sale.saleId}`}>Note (optional)</Label>
            <Input
              id={`offer-note-${sale.saleId}`}
              value={note}
              maxLength={255}
              disabled={busy}
              onChange={(e) => { setNote(e.target.value); setError(null); }}
            />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant={mode === "accept" ? "default" : "destructive"}
              disabled={busy}
              onClick={() => void answer(mode)}
            >
              {busy ? "Working..." : mode === "accept" ? "Yes, accept" : "Yes, decline"}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => { setMode("none"); setError(null); }}>Cancel</Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function IncomingOffers({ refreshKey, onAnswered }: { refreshKey: number; onAnswered: () => void }) {
  const { currentUser } = useAuth();
  const userId = currentUser?.userId ?? null;
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    getMySales()
      .then((r) => { if (live) { setSales(r); setError(null); } })
      .catch((e) => { if (live) setError(errMsg(e, "Could not load your offers.")); });
    return () => { live = false; };
  }, [refreshKey, reload]);

  const offers = (sales ?? [])
    .map((s) => ({ sale: s, state: offerState(s, userId) }))
    .filter((o): o is { sale: Sale; state: OfferState } => o.state !== null);

  const open = offers.filter((o) => o.state === "answer" || o.state === "accepted");
  const earlier = offers.filter((o) => o.state !== "answer" && o.state !== "accepted").slice(0, EARLIER_LIMIT);

  function answered(msg: string) {
    setMessage(msg);
    setReload((n) => n + 1);
    onAnswered();
  }

  return (
    <Card className="rounded-3xl" data-testid="incoming-offers">
      <CardHeader>
        <CardTitle className="text-base">Offers to buy a herd</CardTitle>
        <CardDescription>
          When a rancher sends you a sale, it shows up here. Accept it and CattleCoin approves it, then the herd is yours to run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {message && <p className="text-sm text-emerald-700" role="status">{message}</p>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {sales === null && !error && <Skeleton className="h-20 w-full" />}
        {sales && open.length === 0 && (
          <p className="text-sm text-muted-foreground">No offers waiting on you right now.</p>
        )}
        {open.length > 0 && (
          <ul className="space-y-3">
            {open.map((o) => <OfferCard key={o.sale.saleId} sale={o.sale} state={o.state} onAnswered={answered} />)}
          </ul>
        )}
        {earlier.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Earlier offers</p>
            <ul className="space-y-3">
              {earlier.map((o) => <OfferCard key={o.sale.saleId} sale={o.sale} state={o.state} onAnswered={answered} />)}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default IncomingOffers;
