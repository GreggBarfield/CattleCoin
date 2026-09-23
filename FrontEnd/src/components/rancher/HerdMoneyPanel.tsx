import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getHerdFunds, type HerdFunds } from "@/lib/rancherHerds";
import {
  getCosts, postCost, patchCost, voidCost, checkCost, COST_CATEGORIES, CATEGORY_LABEL, SOURCE_LABEL,
  getLrp, postLrp, putLrp, checkLrp, lrpChanges, lrpToInput, EMPTY_LRP, ENDORSEMENT_LABEL,
  getMySales, getSale, postSale, cancelSale, getFeedlots, checkSale, salePriceCents, EMPTY_SALE,
  SALE_STATUS_LABEL, BUYER_RESPONSE_LABEL, usd, shortDate,
  type HerdCosts, type Expense, type CostInput, type LrpPolicy, type LrpInput,
  type Sale, type SaleDetail, type SaleInput, type SettlementBreakdown, type FeedlotOption,
} from "@/lib/rancherMoney";

// Pass 2 of My Herds (punch list #3): a herd's money actions, opened from its
// card. Three tabs: Costs, LRP insurance, Sale. Every rule (who may change
// what, and when) is enforced by the server; this panel shows the same rules
// up front so the rancher isn't offered a button that will be refused.

const SELECT_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-sm text-destructive" role="alert">{message}</p>;
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

type PanelHerd = { herd_id: string; herd_name: string; head_count: number | null };

type PanelData = {
  costs: HerdCosts;
  policies: LrpPolicy[];
  sales: Sale[]; // this herd's sales, newest first
  funds: HerdFunds["funds"];
};

// ============================== Costs ==============================

const EMPTY_COST: CostInput = { category: "feed", amount: "", description: "", accruedDate: "" };

function CostForm({
  idPrefix, start, submitLabel, onSubmit, onCancel,
}: {
  idPrefix: string;
  start: CostInput;
  submitLabel: string;
  onSubmit: (c: CostInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [c, setC] = useState<CostInput>(start);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof CostInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setC({ ...c, [k]: e.target.value });
    setError(null);
  };

  async function submit() {
    const problem = checkCost(c);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(c);
      setC(start);
    } catch (e) {
      setError(errMsg(e, "Could not save this cost."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field id={`${idPrefix}-cat`} label="Kind of cost">
          <select id={`${idPrefix}-cat`} className={SELECT_CLASS} value={c.category} onChange={set("category")} disabled={busy}>
            {COST_CATEGORIES.map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field id={`${idPrefix}-amt`} label="Amount ($)">
          <Input id={`${idPrefix}-amt`} inputMode="decimal" placeholder="e.g. 1250.00" value={c.amount} onChange={set("amount")} disabled={busy} />
        </Field>
        <Field id={`${idPrefix}-date`} label="Date (blank = today)">
          <Input id={`${idPrefix}-date`} type="date" value={c.accruedDate} onChange={set("accruedDate")} disabled={busy} />
        </Field>
        <Field id={`${idPrefix}-desc`} label="Note (optional)">
          <Input id={`${idPrefix}-desc`} placeholder="e.g. 10 tons hay" value={c.description} onChange={set("description")} disabled={busy} />
        </Field>
      </div>
      <ErrorLine message={error} />
      <div className="flex gap-2">
        <Button onClick={submit} disabled={busy}>{busy ? "Saving..." : submitLabel}</Button>
        {onCancel && <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>}
      </div>
    </div>
  );
}

function CostRow({ e, onDone }: { e: Expense; onDone: (msg: string) => void }) {
  const [mode, setMode] = useState<"none" | "edit" | "void">("none");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const voided = e.status !== "active";

  async function saveEdit(c: CostInput) {
    const changes: Partial<CostInput> = {};
    if (c.category !== e.category) changes.category = c.category;
    if (Number(c.amount) !== e.amount) changes.amount = c.amount;
    if (c.description.trim() !== (e.description ?? "")) changes.description = c.description.trim();
    if (c.accruedDate && c.accruedDate !== e.accruedDate) changes.accruedDate = c.accruedDate;
    if (Object.keys(changes).length === 0) { setMode("none"); return; }
    const r = await patchCost(e.expenseId, changes);
    setMode("none");
    onDone(r.message);
  }

  async function doVoid() {
    setBusy(true);
    setError(null);
    try {
      const r = await voidCost(e.expenseId, reason);
      setMode("none");
      onDone(r.message);
    } catch (err) {
      setError(errMsg(err, "Could not void this cost."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-border p-3" data-testid="cost-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className={voided ? "text-muted-foreground line-through" : ""}>
          <p className="text-sm font-medium">
            {CATEGORY_LABEL[e.category] ?? e.category} - {usd(e.amount)}
          </p>
          <p className="text-xs text-muted-foreground">
            {shortDate(e.accruedDate)}{e.description ? ` - ${e.description}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {voided ? (
            <Badge variant="outline">Voided</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">{SOURCE_LABEL[e.source] ?? e.source}</span>
          )}
          {!voided && e.canChange && mode === "none" && (
            <>
              <Button size="sm" variant="outline" onClick={() => setMode("edit")}>Edit</Button>
              <Button size="sm" variant="outline" onClick={() => { setMode("void"); setReason(""); setError(null); }}>Void</Button>
            </>
          )}
        </div>
      </div>
      {voided && e.voidReason && <p className="mt-1 text-xs text-muted-foreground">Voided: {e.voidReason}</p>}
      {mode === "edit" && (
        <div className="mt-3">
          <CostForm
            idPrefix={`edit-${e.expenseId}`}
            start={{ category: e.category, amount: String(e.amount), description: e.description ?? "", accruedDate: e.accruedDate }}
            submitLabel="Save changes"
            onSubmit={saveEdit}
            onCancel={() => setMode("none")}
          />
        </div>
      )}
      {mode === "void" && (
        <div className="mt-3 space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 p-3">
          <p className="text-sm">Void this cost? It stays on record, marked voided, and no longer counts against the sale.</p>
          <Field id={`void-${e.expenseId}`} label="Reason (optional)">
            <Input id={`void-${e.expenseId}`} value={reason} onChange={(ev) => setReason(ev.target.value)} disabled={busy} placeholder="e.g. entered twice" />
          </Field>
          <ErrorLine message={error} />
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={doVoid} disabled={busy}>{busy ? "Voiding..." : "Yes, void it"}</Button>
            <Button variant="outline" size="sm" onClick={() => setMode("none")} disabled={busy}>Keep it</Button>
          </div>
        </div>
      )}
    </li>
  );
}

function CostsTab({ herdId, costs, onDone }: { herdId: string; costs: HerdCosts; onDone: (msg: string) => void }) {
  const saleState = costs.herd.saleState;
  const canAdd = !saleState;
  const active = costs.expenses.filter((e) => e.status === "active");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="text-sm"><span className="text-muted-foreground">Total costs counted: </span><span className="font-semibold">{usd(costs.total)}</span></p>
        {Object.entries(costs.byCategory).map(([k, v]) => (
          <p key={k} className="text-xs text-muted-foreground">{CATEGORY_LABEL[k] ?? k}: {usd(v)}</p>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        These costs come off the sale price before any gain is split with investors.
        {costs.herd.investorsHaveBought
          ? " Investors have bought into this herd, so you can add costs but not change or void them. Ask CattleCoin if one needs correcting."
          : " You can change or void a cost you added until an investor buys in."}
      </p>
      {saleState && (
        <p className="text-sm text-amber-800">
          {saleState === "approved"
            ? "This herd's sale is approved, so its costs are final."
            : "A sale is waiting for approval, so costs are locked. Cancel the sale first if a cost is missing."}
        </p>
      )}

      {canAdd && (
        <div className="rounded-xl border border-border bg-muted/20 p-3">
          <p className="mb-2 text-sm font-medium">Log a cost</p>
          <CostForm
            idPrefix={`new-${herdId}`}
            start={EMPTY_COST}
            submitLabel="Log cost"
            onSubmit={async (c) => { const r = await postCost(herdId, c); onDone(r.message); }}
          />
        </div>
      )}

      {costs.expenses.length === 0 ? (
        <p className="text-sm text-muted-foreground">No costs logged yet.</p>
      ) : (
        <ul className="space-y-2">
          {[...costs.expenses].reverse().map((e) => <CostRow key={e.expenseId} e={e} onDone={onDone} />)}
        </ul>
      )}
      {active.length > 0 && costs.expenses.length > active.length && (
        <p className="text-xs text-muted-foreground">Voided costs are shown crossed out and don't count.</p>
      )}
    </div>
  );
}

// ============================== LRP ==============================

function LrpForm({
  idPrefix, start, submitLabel, onSubmit, onCancel,
}: {
  idPrefix: string;
  start: LrpInput;
  submitLabel: string;
  onSubmit: (f: LrpInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [f, setF] = useState<LrpInput>(start);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof LrpInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setF({ ...f, [k]: e.target.value });
    setError(null);
  };

  async function submit() {
    const problem = checkLrp(f);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(f);
    } catch (e) {
      setError(errMsg(e, "Could not save this LRP record."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id={`${idPrefix}-num`} label="Policy number">
          <Input id={`${idPrefix}-num`} value={f.policyNumber} onChange={set("policyNumber")} disabled={busy} />
        </Field>
        <Field id={`${idPrefix}-type`} label="Endorsement">
          <select id={`${idPrefix}-type`} className={SELECT_CLASS} value={f.endorsementType} onChange={set("endorsementType")} disabled={busy}>
            {Object.entries(ENDORSEMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field id={`${idPrefix}-cov`} label="Coverage level (%)">
          <Input id={`${idPrefix}-cov`} inputMode="decimal" placeholder="e.g. 95" value={f.coverageLevelPct} onChange={set("coverageLevelPct")} disabled={busy} />
        </Field>
        <Field id={`${idPrefix}-floor`} label="Insured floor ($/cwt)">
          <Input id={`${idPrefix}-floor`} inputMode="decimal" placeholder="e.g. 245.00" value={f.floorPriceCwt} onChange={set("floorPriceCwt")} disabled={busy} />
        </Field>
        <Field id={`${idPrefix}-prem`} label="Premium you paid ($)">
          <Input id={`${idPrefix}-prem`} inputMode="decimal" placeholder="e.g. 850.00" value={f.premiumAmount} onChange={set("premiumAmount")} disabled={busy} />
        </Field>
        <div />
        <Field id={`${idPrefix}-start`} label="Start date">
          <Input id={`${idPrefix}-start`} type="date" value={f.effectiveDate} onChange={set("effectiveDate")} disabled={busy} />
        </Field>
        <Field id={`${idPrefix}-end`} label="End date">
          <Input id={`${idPrefix}-end`} type="date" value={f.endDate} onChange={set("endDate")} disabled={busy} />
        </Field>
      </div>
      <ErrorLine message={error} />
      <div className="flex gap-2">
        <Button onClick={submit} disabled={busy}>{busy ? "Saving..." : submitLabel}</Button>
        {onCancel && <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>}
      </div>
    </div>
  );
}

function LrpRow({ p, canEdit, onDone }: { p: LrpPolicy; canEdit: boolean; onDone: (msg: string) => void }) {
  const [editing, setEditing] = useState(false);
  const before = lrpToInput(p);
  return (
    <li className="rounded-xl border border-border p-3" data-testid="lrp-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {p.policyNumber ? `Policy ${p.policyNumber}` : "Policy (no number yet)"} - {ENDORSEMENT_LABEL[p.endorsementType] ?? p.endorsementType}
          </p>
          <p className="text-xs text-muted-foreground">
            Floor {p.floorPriceCwt != null ? `${usd(p.floorPriceCwt)}/cwt` : "-"}
            {" - "}Coverage {p.coverageLevelPct != null ? `${p.coverageLevelPct}%` : "-"}
            {" - "}Premium {usd(p.premiumAmount)}
            {" - "}{shortDate(p.effectiveDate)} to {shortDate(p.endDate)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {p.agentVerified
            ? <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-900">Verified by CattleCoin</Badge>
            : <Badge variant="outline">Not verified</Badge>}
          {canEdit && !editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
        </div>
      </div>
      {editing && (
        <div className="mt-3">
          <LrpForm
            idPrefix={`lrp-${p.policyId}`}
            start={before}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSubmit={async (f) => {
              const changes = lrpChanges(before, f);
              if (Object.keys(changes).length === 0) { setEditing(false); return; }
              const r = await putLrp(p.policyId, changes);
              setEditing(false);
              onDone(r.message);
            }}
          />
        </div>
      )}
    </li>
  );
}

function LrpTab({ herdId, data, onDone }: { herdId: string; data: PanelData; onDone: (msg: string) => void }) {
  const [adding, setAdding] = useState(false);
  const saleState = data.costs.herd.saleState;
  const canAdd = !saleState;
  const canEdit = !saleState && !data.costs.herd.investorsHaveBought;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Record a Livestock Risk Protection policy you bought through your insurance agent. CattleCoin does not sell or
        verify insurance. The premium you enter is added to this herd's costs automatically.
        {!canEdit && !saleState && " Investors have bought in, so records can be added but not changed. Ask CattleCoin if one needs correcting."}
      </p>
      {saleState && <p className="text-sm text-amber-800">This herd has a sale {saleState === "approved" ? "approved" : "waiting for approval"}, so its LRP records are locked.</p>}

      {data.policies.length === 0 ? (
        <p className="text-sm text-muted-foreground">No LRP policy recorded for this herd.</p>
      ) : (
        <ul className="space-y-2">
          {data.policies.map((p) => <LrpRow key={p.policyId} p={p} canEdit={canEdit} onDone={onDone} />)}
        </ul>
      )}

      {canAdd && !adding && <Button variant="outline" onClick={() => setAdding(true)}>Add an LRP policy</Button>}
      {canAdd && adding && (
        <div className="rounded-xl border border-border bg-muted/20 p-3">
          <p className="mb-2 text-sm font-medium">New LRP policy</p>
          <LrpForm
            idPrefix={`lrp-new-${herdId}`}
            start={EMPTY_LRP}
            submitLabel="Save LRP policy"
            onCancel={() => setAdding(false)}
            onSubmit={async (f) => { const r = await postLrp(herdId, f); setAdding(false); onDone(r.message); }}
          />
        </div>
      )}
    </div>
  );
}

// ============================== Sale ==============================

function SplitSummary({ b }: { b: SettlementBreakdown }) {
  const mine = b.payouts.filter((p) => p.recipientType === "owner").reduce((s, p) => s + p.amount, 0);
  const investors = b.payouts.filter((p) => p.recipientType === "investor").reduce((s, p) => s + p.amount, 0);
  const others = b.payouts.filter((p) => p.recipientType === "provider").reduce((s, p) => s + p.amount, 0);
  return (
    <div className="space-y-2">
      <dl className="grid max-w-lg grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-border bg-background p-3 text-sm" data-testid="split">
        <dt className="text-muted-foreground">Sale price</dt><dd className="font-medium">{usd(b.salePrice)}</dd>
        {b.lrpIndemnity > 0 && (<><dt className="text-muted-foreground">LRP payout</dt><dd className="font-medium">{usd(b.lrpIndemnity)}</dd></>)}
        <dt className="text-muted-foreground">Costs</dt><dd className="font-medium">{usd(b.expensesTotal)}</dd>
        <dt className="text-muted-foreground">Gain (or loss)</dt><dd className="font-medium">{usd(b.profit)}</dd>
        <dt className="text-muted-foreground">To investors</dt><dd className="font-medium">{usd(investors)}</dd>
        {others > 0 && (<><dt className="text-muted-foreground">To service providers</dt><dd className="font-medium">{usd(others)}</dd></>)}
        {b.platformFeesTotal > 0 && (<><dt className="text-muted-foreground">Platform fees</dt><dd className="font-medium">{usd(b.platformFeesTotal)}</dd></>)}
        <dt className="text-muted-foreground">To you</dt><dd className="font-semibold">{usd(mine)}</dd>
      </dl>
      {b.warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-amber-800">{b.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
    </div>
  );
}

function SaleFacts({ s }: { s: Sale }) {
  const buyer = s.buyerSlug ? `${s.buyerSlug} (CattleCoin feedlot)` : (s.buyerName ?? "-");
  return (
    <dl className="grid max-w-lg grid-cols-2 gap-x-6 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Buyer</dt><dd className="font-medium">{buyer}</dd>
      <dt className="text-muted-foreground">Sale date</dt><dd className="font-medium">{shortDate(s.saleDate)}</dd>
      {s.headSold != null && (<><dt className="text-muted-foreground">Head sold / lost</dt><dd className="font-medium">{s.headSold} / {s.headLost ?? 0}</dd></>)}
      {s.liveWeightLbs != null && (<><dt className="text-muted-foreground">Live weight</dt><dd className="font-medium">{s.liveWeightLbs.toLocaleString("en-US")} lb at {usd(s.pricePerCwt)}/cwt</dd></>)}
      <dt className="text-muted-foreground">Sale price</dt><dd className="font-medium">{usd(s.grossAmount)}</dd>
      {s.lrpIndemnity > 0 && (<><dt className="text-muted-foreground">LRP payout</dt><dd className="font-medium">{usd(s.lrpIndemnity)}</dd></>)}
    </dl>
  );
}

function LiveSale({ sale, onDone }: { sale: Sale; onDone: (msg: string, herdChanged: boolean) => void }) {
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = sale.status === "pending_approval";

  useEffect(() => {
    getSale(sale.saleId).then(setDetail).catch((e) => setDetailError(errMsg(e, "Could not load this sale.")));
  }, [sale.saleId]);

  async function doCancel() {
    setBusy(true);
    setError(null);
    try {
      const r = await cancelSale(sale.saleId);
      onDone(r.message, true);
    } catch (e) {
      setError(errMsg(e, "Could not cancel this sale."));
      setBusy(false);
    }
  }

  const myPayouts = (detail?.payouts ?? []).filter((p) => p.recipientType === "owner");

  return (
    <div className="space-y-3" data-testid="live-sale">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={pending ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}>
          {SALE_STATUS_LABEL[sale.status] ?? sale.status}
        </Badge>
        {sale.buyerResponse && BUYER_RESPONSE_LABEL[sale.buyerResponse] && (
          <span className="text-xs text-muted-foreground">{BUYER_RESPONSE_LABEL[sale.buyerResponse]}</span>
        )}
        <span className="text-xs text-muted-foreground">Submitted {shortDate(sale.submittedAt)}</span>
      </div>
      <SaleFacts s={sale} />
      {sale.warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-amber-800">{sale.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}

      {detailError && <ErrorLine message={detailError} />}
      {!detail && !detailError && <Skeleton className="h-24 w-full max-w-lg" />}
      {pending && detail?.preview && (
        <>
          <p className="text-sm font-medium">How the money would split (estimate until approved)</p>
          <SplitSummary b={detail.preview} />
        </>
      )}
      {!pending && detail?.payouts && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Your payout from this sale</p>
          {myPayouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is owed to you from this sale.</p>
          ) : myPayouts.map((p) => (
            <p key={p.payoutId} className="text-sm">
              {usd(p.amount)} - {p.status === "paid" ? `paid ${shortDate(p.paidAt)}${p.paymentReference ? ` (ref ${p.paymentReference})` : ""}` : "owed, not paid yet"}
            </p>
          ))}
        </div>
      )}

      {pending && !confirmCancel && (
        <Button variant="outline" onClick={() => { setConfirmCancel(true); setError(null); }}>Cancel this sale</Button>
      )}
      {pending && confirmCancel && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/50 p-3">
          <p className="text-sm">Cancel this sale? The herd goes back to how it was before you submitted it, and you can submit a new sale later.</p>
          <ErrorLine message={error} />
          <div className="flex gap-2">
            <Button variant="destructive" onClick={doCancel} disabled={busy}>{busy ? "Cancelling..." : "Yes, cancel the sale"}</Button>
            <Button variant="outline" onClick={() => setConfirmCancel(false)} disabled={busy}>Keep the sale</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SaleForm({
  herd, hasLrp, onDone,
}: {
  herd: PanelHerd;
  hasLrp: boolean;
  onDone: (msg: string, herdChanged: boolean) => void;
}) {
  const headCount = herd.head_count ?? 0;
  const [s, setS] = useState<SaleInput>(EMPTY_SALE);
  const [feedlots, setFeedlots] = useState<FeedlotOption[] | null>(null);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof SaleInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setS({ ...s, [k]: e.target.value });
    setError(null);
    setReview(false);
  };
  const setKind = <K extends "buyerKind" | "priceKind">(k: K, v: SaleInput[K]) => {
    setS({ ...s, [k]: v });
    setError(null);
    setReview(false);
  };

  useEffect(() => {
    if (s.buyerKind === "platform" && feedlots === null) {
      getFeedlots().then(setFeedlots).catch(() => setFeedlots([]));
    }
  }, [s.buyerKind, feedlots]);

  const priceCents = salePriceCents(s);
  const lrpCents = s.lrpIndemnity.trim() && Number.isFinite(Number(s.lrpIndemnity)) ? Math.round(Number(s.lrpIndemnity) * 100) : 0;

  function toReview() {
    const problem = checkSale(s, headCount, hasLrp);
    if (problem) { setError(problem); return; }
    setError(null);
    setReview(true);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await postSale(herd.herd_id, s);
      onDone(r.message, true);
    } catch (e) {
      setError(errMsg(e, "Could not submit this sale."));
      setReview(false);
      setBusy(false);
    }
  }

  const radio = "flex items-center gap-2 text-sm";
  const id = herd.herd_id;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Record the sale once the cattle are sold. Submitting closes the herd to new investors, then CattleCoin reviews the
        split and approves it. You can cancel until it is approved. This records what is owed; it does not move money.
      </p>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who bought them?</legend>
        <div className="flex flex-wrap gap-4">
          <label className={radio}><input type="radio" name={`buyer-${id}`} checked={s.buyerKind === "outside"} onChange={() => setKind("buyerKind", "outside")} disabled={busy} /> A packer, sale barn or other buyer</label>
          <label className={radio}><input type="radio" name={`buyer-${id}`} checked={s.buyerKind === "platform"} onChange={() => setKind("buyerKind", "platform")} disabled={busy} /> A feedlot on CattleCoin</label>
        </div>
        {s.buyerKind === "outside" ? (
          <div className="max-w-sm">
            <Field id={`buyer-name-${id}`} label="Buyer name">
              <Input id={`buyer-name-${id}`} value={s.buyerName} onChange={set("buyerName")} disabled={busy} placeholder="e.g. Tyson Amarillo" />
            </Field>
          </div>
        ) : (
          <div className="max-w-sm space-y-1">
            <Field id={`buyer-slug-${id}`} label="Feedlot">
              <select id={`buyer-slug-${id}`} className={SELECT_CLASS} value={s.buyerSlug} onChange={set("buyerSlug")} disabled={busy || feedlots === null}>
                <option value="">{feedlots === null ? "Loading..." : "Choose a feedlot"}</option>
                {(feedlots ?? []).map((f) => <option key={f.userId} value={f.slug}>{f.slug}</option>)}
              </select>
            </Field>
            <p className="text-xs text-muted-foreground">The feedlot accepts the sale on CattleCoin before it is approved. The herd then moves to their account.</p>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">The price</legend>
        <div className="flex flex-wrap gap-4">
          <label className={radio}><input type="radio" name={`price-${id}`} checked={s.priceKind === "load"} onChange={() => setKind("priceKind", "load")} disabled={busy} /> From the load (head, weight, price per cwt)</label>
          <label className={radio}><input type="radio" name={`price-${id}`} checked={s.priceKind === "total"} onChange={() => setKind("priceKind", "total")} disabled={busy} /> One total amount</label>
        </div>
        {s.priceKind === "load" ? (
          <div className="grid gap-3 sm:grid-cols-4">
            <Field id={`head-sold-${id}`} label={`Head sold (of ${headCount})`}>
              <Input id={`head-sold-${id}`} inputMode="numeric" value={s.headSold} onChange={set("headSold")} disabled={busy} />
            </Field>
            <Field id={`head-lost-${id}`} label="Head lost (death loss)">
              <Input id={`head-lost-${id}`} inputMode="numeric" placeholder="0" value={s.headLost} onChange={set("headLost")} disabled={busy} />
            </Field>
            <Field id={`weight-${id}`} label="Total live weight (lb)">
              <Input id={`weight-${id}`} inputMode="decimal" placeholder="e.g. 27500" value={s.liveWeightLbs} onChange={set("liveWeightLbs")} disabled={busy} />
            </Field>
            <Field id={`cwt-${id}`} label="Price ($/cwt)">
              <Input id={`cwt-${id}`} inputMode="decimal" placeholder="e.g. 245.50" value={s.pricePerCwt} onChange={set("pricePerCwt")} disabled={busy} />
            </Field>
          </div>
        ) : (
          <div className="max-w-xs">
            <Field id={`gross-${id}`} label="Sale price ($)">
              <Input id={`gross-${id}`} inputMode="decimal" value={s.grossAmount} onChange={set("grossAmount")} disabled={busy} />
            </Field>
          </div>
        )}
        {priceCents !== null && (
          <p className="text-sm">Sale price: <span className="font-semibold">{usd(priceCents / 100)}</span></p>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field id={`sale-date-${id}`} label="Sale date (blank = today)">
          <Input id={`sale-date-${id}`} type="date" value={s.saleDate} onChange={set("saleDate")} disabled={busy} />
        </Field>
        {hasLrp && (
          <>
            <Field id={`lrp-pay-${id}`} label="LRP payout received ($, if any)">
              <Input id={`lrp-pay-${id}`} inputMode="decimal" value={s.lrpIndemnity} onChange={set("lrpIndemnity")} disabled={busy} />
            </Field>
            <Field id={`lrp-note-${id}`} label="LRP note (optional)">
              <Input id={`lrp-note-${id}`} value={s.lrpNote} onChange={set("lrpNote")} disabled={busy} />
            </Field>
          </>
        )}
      </div>

      <ErrorLine message={error} />

      {!review ? (
        <Button onClick={toReview} disabled={busy}>Review sale</Button>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3" data-testid="sale-review">
          <p className="text-sm">
            Submit a sale of <span className="font-medium">{herd.herd_name}</span> to{" "}
            <span className="font-medium">{s.buyerKind === "outside" ? s.buyerName.trim() : s.buyerSlug}</span> for{" "}
            <span className="font-medium">{usd((priceCents ?? 0) / 100)}</span>
            {lrpCents > 0 ? <> plus an LRP payout of <span className="font-medium">{usd(lrpCents / 100)}</span></> : null}?
            The herd closes to new investors right away.
          </p>
          <div className="flex gap-2">
            <Button onClick={submit} disabled={busy}>{busy ? "Submitting..." : "Submit sale for approval"}</Button>
            <Button variant="outline" onClick={() => setReview(false)} disabled={busy}>Change something</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SaleTab({
  herd, data, onDone,
}: {
  herd: PanelHerd;
  data: PanelData;
  onDone: (msg: string, herdChanged: boolean) => void;
}) {
  const live = data.sales.find((x) => x.status === "pending_approval" || x.status === "approved");
  const earlier = data.sales.filter((x) => x !== live);
  const unreleased = data.funds.available;

  let body: React.ReactNode;
  if (live) {
    body = <LiveSale sale={live} onDone={onDone} />;
  } else if (unreleased > 0) {
    body = (
      <p className="text-sm text-amber-800">
        Investors have paid in {usd(unreleased)} for this herd that hasn't been released to you yet. CattleCoin has to
        release it before a sale can be recorded. Contact CattleCoin to release it.
      </p>
    );
  } else if (!herd.head_count) {
    body = <p className="text-sm text-muted-foreground">This herd has no head count, so a sale can't be recorded.</p>;
  } else {
    body = (
      <SaleForm
        herd={herd}
        hasLrp={data.policies.length > 0}
        onDone={onDone}
      />
    );
  }

  return (
    <div className="space-y-4">
      {body}
      {earlier.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Earlier sales on this herd</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {earlier.map((x) => (
              <li key={x.saleId}>
                {shortDate(x.saleDate)} - {x.buyerSlug ?? x.buyerName ?? "-"} - {usd(x.grossAmount)} - {SALE_STATUS_LABEL[x.status] ?? x.status}
                {x.decisionNote ? ` (${x.decisionNote})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============================== the panel ==============================

async function loadPanel(herdId: string): Promise<PanelData> {
  const [costs, lrp, sales, funds] = await Promise.all([
    getCosts(herdId),
    getLrp(herdId),
    getMySales(),
    getHerdFunds(herdId),
  ]);
  return {
    costs,
    policies: lrp.policies,
    sales: sales.filter((x) => x.herdId === herdId),
    funds: funds.funds,
  };
}

type Tab = "costs" | "lrp" | "sale";
const TAB_LABEL: Record<Tab, string> = { costs: "Costs", lrp: "LRP insurance", sale: "Sale" };

export function HerdMoneyPanel({
  herd, onHerdChanged,
}: {
  herd: PanelHerd;
  onHerdChanged: (msg: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("costs");
  const [data, setData] = useState<PanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    loadPanel(herd.herd_id)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(errMsg(e, "Could not load this herd's money details.")));
  }, [herd.herd_id, reloadKey]);

  function done(msg: string, herdChanged = false) {
    setMessage(msg);
    setReloadKey((k) => k + 1);
    if (herdChanged) onHerdChanged(msg);
  }

  return (
    <div className="space-y-4 rounded-xl border border-border p-4" data-testid="money-panel">
      <div className="flex flex-wrap gap-1" role="tablist">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <Button
            key={t}
            role="tab"
            aria-selected={tab === t}
            size="sm"
            variant={tab === t ? "default" : "outline"}
            onClick={() => { setTab(t); setMessage(null); }}
          >
            {TAB_LABEL[t]}
          </Button>
        ))}
      </div>
      {message && <p className="text-sm text-emerald-700" role="status">{message}</p>}
      <ErrorLine message={error} />
      {!data && !error && <Skeleton className="h-32 w-full" />}
      {data && tab === "costs" && <CostsTab herdId={herd.herd_id} costs={data.costs} onDone={(m) => done(m)} />}
      {data && tab === "lrp" && <LrpTab herdId={herd.herd_id} data={data} onDone={(m) => done(m)} />}
      {data && tab === "sale" && <SaleTab herd={herd} data={data} onDone={done} />}
    </div>
  );
}

export default HerdMoneyPanel;
