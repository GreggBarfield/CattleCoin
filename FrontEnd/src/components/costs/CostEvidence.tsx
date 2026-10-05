import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  STATUS_LABEL, checkInvoiceFile, fileSize, openInvoice, uploadInvoice,
  type CostDocument, type CostSignal, type VerificationStatus,
} from "@/lib/costReview";

// Small pieces shared by the rancher's Costs tab and the investor's herd page:
// the status badge, the invoice list, the warning list, and invoice upload.

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

const BADGE_CLASS: Record<VerificationStatus, string> = {
  unverified: "border-amber-300 bg-amber-50 text-amber-800",
  documented: "border-blue-200 bg-blue-50 text-blue-700",
  verified: "border-green-200 bg-green-50 text-green-700",
  flagged: "border-red-300 bg-red-50 text-red-700",
  system: "border-slate-200 bg-slate-50 text-slate-600",
};

export function StatusBadge({ status }: { status: VerificationStatus | undefined }) {
  if (!status || status === "system") return null; // system-booked costs need no badge
  return (
    <Badge variant="outline" className={BADGE_CLASS[status]} data-testid="verification-badge">
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function InvoiceLinks({ documents }: { documents: CostDocument[] | undefined }) {
  const [error, setError] = useState<string | null>(null);
  if (!documents || documents.length === 0) return null;
  return (
    <div className="space-y-1">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {documents.map((d) => (
          <li key={d.docId}>
            <button
              type="button"
              className="text-xs text-blue-600 hover:underline"
              onClick={() => { setError(null); openInvoice(d.docId).catch((e) => setError(errMsg(e, "Could not open that file."))); }}
            >
              {d.filename} ({fileSize(d.sizeBytes)})
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}

// "No invoice" is shown by the badge already, so it is left out of the list.
export function SignalList({ signals }: { signals: CostSignal[] | undefined }) {
  const shown = (signals ?? []).filter((s) => s.code !== "no_invoice");
  if (shown.length === 0) return null;
  return (
    <ul className="space-y-0.5" data-testid="cost-signals">
      {shown.map((s) => (
        <li key={s.code} className="text-xs text-amber-800">
          {s.label}{s.note ? `: ${s.note}` : ""}
        </li>
      ))}
    </ul>
  );
}

export function InvoiceUpload({ expenseId, onDone }: { expenseId: string; onDone: (msg: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function chosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same file again still fires
    if (!file) return;
    const problem = checkInvoiceFile(file);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await uploadInvoice(expenseId, file);
      onDone(r.message);
    } catch (err) {
      setError(errMsg(err, "Could not attach that file."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        aria-label="Invoice file"
        data-testid="invoice-input"
        onChange={chosen}
      />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Attaching..." : "Attach invoice"}
      </Button>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}
