import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { disputeCost, respondToDispute, type Dispute } from "@/lib/costReview";
import { CATEGORY_LABEL, usd, shortDate } from "@/lib/rancherMoney";

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

// An investor questions one cost. Opens from a small link under the cost.
export function DisputeForm({ expenseId, onDone }: { expenseId: string; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (note.trim().length < 5) { setError("Tell us what looks wrong with this cost (a few words is enough)."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await disputeCost(expenseId, note);
      setOpen(false);
      setNote("");
      onDone(r.message);
    } catch (e) {
      setError(errMsg(e, "Could not send your question."));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setOpen(true)}>
        Question this cost
      </button>
    );
  }
  return (
    <div className="mt-1 space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 p-2">
      <p className="text-xs">
        Tell us what looks wrong. The herd's owner can reply and a CattleCoin admin will review it.
        The sale cannot be approved while a question is open.
      </p>
      <Input
        aria-label="What looks wrong with this cost"
        value={note}
        onChange={(e) => { setNote(e.target.value); setError(null); }}
        disabled={busy}
        placeholder="e.g. Feed price is double what the other lots paid"
      />
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={send} disabled={busy}>{busy ? "Sending..." : "Send question"}</Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

const DISPUTE_BADGE: Record<Dispute["status"], string> = {
  open: "border-amber-300 bg-amber-50 text-amber-800",
  upheld: "border-red-300 bg-red-50 text-red-700",
  dismissed: "border-slate-200 bg-slate-50 text-slate-600",
};
const DISPUTE_LABEL: Record<Dispute["status"], string> = {
  open: "Open", upheld: "Upheld by CattleCoin", dismissed: "Dismissed by CattleCoin",
};

// The owner's view of the questions investors have raised, with a reply box.
export function OwnerDisputes({ disputes, onDone }: { disputes: Dispute[]; onDone: (msg: string) => void }) {
  if (disputes.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="owner-disputes">
      <p className="text-sm font-medium">Questions from investors</p>
      <ul className="space-y-2">
        {disputes.map((d) => <OwnerDisputeRow key={d.disputeId} d={d} onDone={onDone} />)}
      </ul>
    </div>
  );
}

function OwnerDisputeRow({ d, onDone }: { d: Dispute; onDone: (msg: string) => void }) {
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (reply.trim().length < 2) { setError("Write your reply."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await respondToDispute(d.disputeId, reply);
      setReply("");
      onDone(r.message);
    } catch (e) {
      setError(errMsg(e, "Could not save your reply."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-border p-3 text-sm" data-testid="dispute-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {CATEGORY_LABEL[d.cost.category] ?? d.cost.category} - {usd(d.cost.amount)}
        </span>
        <Badge variant="outline" className={DISPUTE_BADGE[d.status]}>{DISPUTE_LABEL[d.status]}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Raised {shortDate(d.createdAt)}</p>
      <p className="mt-1">"{d.note}"</p>
      {d.ownerResponse && <p className="mt-2 text-xs"><span className="font-medium">Your reply:</span> {d.ownerResponse}</p>}
      {d.resolutionNote && <p className="mt-1 text-xs"><span className="font-medium">CattleCoin's ruling:</span> {d.resolutionNote}</p>}
      {d.status === "open" && !d.ownerResponse && (
        <div className="mt-2 space-y-2">
          <Input
            aria-label="Your reply"
            value={reply}
            onChange={(e) => { setReply(e.target.value); setError(null); }}
            disabled={busy}
            placeholder="Explain this cost (invoices help)"
          />
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          <Button size="sm" onClick={send} disabled={busy}>{busy ? "Saving..." : "Send reply"}</Button>
        </div>
      )}
    </li>
  );
}
