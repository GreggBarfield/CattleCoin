import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  flagCost, verifyCost, resolveDispute,
  type CostReviewSummary, type Dispute,
} from "@/lib/costReview";
import { usd, categoryLabel, shortDateTime } from "@/lib/herdOps";

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

// Admin: verify or flag one owner-typed cost. Verify needs an invoice on file
// or a note saying how it was checked; flag always needs a reason.
export function AdminCostReview({
  expenseId, hasInvoice, onChanged,
}: { expenseId: string; hasInvoice: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<"none" | "verify" | "flag">("none");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    if (mode === "flag" && text.trim().length < 5) { setError("A reason is required to flag a cost."); return; }
    if (mode === "verify" && !hasInvoice && !text.trim()) {
      setError("There is no invoice on file. Say how you checked this cost (for example: called the vendor).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "verify") await verifyCost(expenseId, text);
      else await flagCost(expenseId, text);
      setMode("none");
      setText("");
      onChanged();
    } catch (e) {
      setError(errMsg(e, "That did not go through."));
    } finally {
      setBusy(false);
    }
  }

  if (mode === "none") {
    return (
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => { setMode("verify"); setError(null); }}>Verify</Button>
        <Button size="sm" variant="outline" onClick={() => { setMode("flag"); setError(null); }}>Flag</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-2" data-testid="admin-review-form">
      <Input
        aria-label={mode === "verify" ? "How you checked this cost" : "Why you are flagging this cost"}
        placeholder={mode === "verify" ? (hasInvoice ? "Note (optional)" : "How you checked it (required, no invoice)") : "Reason (required)"}
        value={text}
        onChange={(e) => { setText(e.target.value); setError(null); }}
        disabled={busy}
      />
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={go} disabled={busy}>{busy ? "Saving..." : mode === "verify" ? "Mark verified" : "Flag this cost"}</Button>
        <Button size="sm" variant="outline" onClick={() => setMode("none")} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

const D_BADGE: Record<Dispute["status"], string> = {
  open: "border-amber-300 bg-amber-50 text-amber-800",
  upheld: "border-red-300 bg-red-50 text-red-700",
  dismissed: "border-slate-200 bg-slate-50 text-slate-600",
};

// Admin: every dispute on a herd, with a ruling form on the open ones.
export function AdminDisputes({ disputes, onChanged }: { disputes: Dispute[]; onChanged: () => void }) {
  if (disputes.length === 0) return null;
  const open = disputes.filter((d) => d.status === "open");
  const done = disputes.filter((d) => d.status !== "open");
  return (
    <div className="space-y-2" data-testid="admin-disputes">
      <p className="text-sm font-medium">Investor disputes ({open.length} open)</p>
      {open.map((d) => <AdminDisputeRow key={d.disputeId} d={d} onChanged={onChanged} />)}
      {done.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Ruled on ({done.length})</summary>
          <div className="mt-2 space-y-2">
            {done.map((d) => <AdminDisputeRow key={d.disputeId} d={d} onChanged={onChanged} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function AdminDisputeRow({ d, onChanged }: { d: Dispute; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function rule(outcome: "upheld" | "dismissed") {
    if (note.trim().length < 5) { setError("Write a few words explaining your ruling."); return; }
    setBusy(true);
    setError(null);
    try {
      await resolveDispute(d.disputeId, outcome, note);
      setNote("");
      onChanged();
    } catch (e) {
      setError(errMsg(e, "Could not save that ruling."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background p-3 text-sm" data-testid="admin-dispute-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{categoryLabel(d.cost.category)} - {usd(d.cost.amount)}</span>
        <Badge variant="outline" className={D_BADGE[d.status]}>{d.status}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Raised by {d.raisedBy ?? "an investor"} - {shortDateTime(d.createdAt)}
      </p>
      <p className="mt-1">"{d.note}"</p>
      {d.ownerResponse
        ? <p className="mt-1 text-xs"><span className="font-medium">Owner replied:</span> {d.ownerResponse}</p>
        : d.status === "open" && <p className="mt-1 text-xs text-muted-foreground">The owner has not replied yet.</p>}
      {d.resolutionNote && <p className="mt-1 text-xs"><span className="font-medium">Ruling:</span> {d.resolutionNote}</p>}
      {d.status === "open" && (
        <div className="mt-2 space-y-2">
          <Input aria-label="Your ruling" placeholder="Explain your ruling (required)" value={note}
            onChange={(e) => { setNote(e.target.value); setError(null); }} disabled={busy} />
          {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" onClick={() => rule("upheld")} disabled={busy}>Uphold (flags the cost)</Button>
            <Button size="sm" variant="outline" onClick={() => rule("dismissed")} disabled={busy}>Dismiss</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Upholding flags the cost. Then use Correct or Void on the cost to fix the numbers.
          </p>
        </div>
      )}
    </div>
  );
}

// Shown above Approve on a pending sale: what the cost review found, and whether it blocks.
export function CostReviewBanner({ review }: { review: CostReviewSummary }) {
  const clean = !review.blocked && review.warnings.length === 0;
  return (
    <div
      className={`rounded-xl border p-3 text-sm ${review.blocked ? "border-red-300 bg-red-50" : clean ? "border-green-200 bg-green-50" : "border-amber-300 bg-amber-50"}`}
      data-testid="cost-review-banner"
    >
      <p className="font-medium">Cost review</p>
      {review.blocked && (
        <p className="text-red-700">
          {review.openDisputes} open dispute{review.openDisputes === 1 ? "" : "s"}. This sale cannot be approved until they are ruled on (Herd costs, below).
        </p>
      )}
      {review.warnings.map((w, i) => <p key={i} className="text-xs text-amber-900">{w}</p>)}
      {clean && <p className="text-xs text-green-800">No open disputes, flags or duplicate invoices.</p>}
    </div>
  );
}
