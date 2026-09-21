import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Receipt, ShieldCheck, Gavel, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { getHerds, type HerdListItem } from "@/lib/feeSetup";
import {
  getHerdCosts, patchExpense, voidExpense,
  getHerdLrp, putLrpPolicy,
  getSales, getSaleDetail, approveSale, rejectSale, correctSale, markPayoutPaid,
  usd, shortDateTime, categoryLabel, OpsApiError, MANUAL_CATEGORIES, ENDORSEMENTS,
  type Expense, type LrpPolicy, type Sale, type SaleStatus, type SaleDetail,
} from "@/lib/herdOps";

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof OpsApiError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

function ErrorNote({ message }: { message: string }) {
  return <p className="text-sm text-red-600">{message}</p>;
}

function SectionHeader({ icon: Icon, title, description }: { icon: typeof Receipt; title: string; description: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="rounded-full bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></div>
      <div>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
    </div>
  );
}

// ── herd picker (shared by costs + LRP) ─────────────────────────────────────

function useHerdList() {
  const [herds, setHerds] = useState<HerdListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getHerds().then((r) => setHerds(r.items)).catch((e) => setError(errMsg(e, "Could not load the herd list.")));
  }, []);
  return { herds, error };
}

// ── costs ────────────────────────────────────────────────────────────────────

function ExpenseRow({ expense, onChanged }: { expense: Expense; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState(expense.category);
  const [amount, setAmount] = useState(String(expense.amount));
  const [description, setDescription] = useState(expense.description ?? "");
  const [accruedDate, setAccruedDate] = useState(expense.accruedDate);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (expense.changeNeedsReason && !reason.trim()) {
      setError("A reason is required to correct this cost.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await patchExpense(expense.expenseId, { category, amount, description, accruedDate, reason });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(errMsg(e, "Could not save that change."));
    } finally {
      setBusy(false);
    }
  }

  async function voidIt() {
    if (expense.changeNeedsReason && !reason.trim()) {
      setError("A reason is required to void this cost.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await voidExpense(expense.expenseId, reason);
      onChanged();
    } catch (e) {
      setError(errMsg(e, "Could not void that cost."));
    } finally {
      setBusy(false);
    }
  }

  if (expense.status === "voided") {
    return (
      <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm opacity-70">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{categoryLabel(expense.category)} - {usd(expense.amount)} - {expense.accruedDate}</span>
          <Badge variant="outline">Voided</Badge>
        </div>
        {expense.voidReason && <p className="text-xs text-muted-foreground">{expense.voidReason}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-background p-3 text-sm">
      {!editing ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-medium">{categoryLabel(expense.category)}</span> - {usd(expense.amount)} - {expense.accruedDate}
            {expense.description && <p className="text-xs text-muted-foreground">{expense.description}</p>}
            <p className="text-xs text-muted-foreground">
              {expense.billingDirection === "service" ? "Service-billed" : "Self-billed"} - source: {expense.source}
              {expense.createdBy ? ` - by ${expense.createdBy}` : ""}
            </p>
          </div>
          {expense.canChange && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Correct</Button>
              <Button size="sm" variant="destructive" onClick={voidIt} disabled={busy}>Void</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {error && <ErrorNote message={error} />}
          <div className="grid gap-2 sm:grid-cols-4">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MANUAL_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Input type="date" value={accruedDate} onChange={(e) => setAccruedDate(e.target.value)} />
            <Input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {expense.changeNeedsReason && (
            <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CostsSection() {
  const { herds, error: herdsError } = useHerdList();
  const [herdId, setHerdId] = useState("");
  const [data, setData] = useState<Awaited<ReturnType<typeof getHerdCosts>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load(id: string) {
    setHerdId(id);
    setData(null);
    setError(null);
    if (!id) return;
    getHerdCosts(id).then(setData).catch((e) => setError(errMsg(e, "Could not load this herd's costs.")));
  }

  const active = data?.expenses.filter((e) => e.status === "active") ?? [];
  const voided = data?.expenses.filter((e) => e.status === "voided") ?? [];

  return (
    <Card className="rounded-3xl">
      <CardHeader><SectionHeader icon={Receipt} title="Herd costs" description="Feed, yardage, vet, and other costs the producer has logged. Admin can correct or void an entry (with a reason once investors have bought in); the producer adds new ones." /></CardHeader>
      <CardContent className="space-y-4">
        {herdsError && <ErrorNote message={herdsError} />}
        {error && <ErrorNote message={error} />}
        <div className="grid gap-1.5 md:max-w-md">
          <Label>Herd</Label>
          {herds === null ? <Skeleton className="h-10 w-full" /> : (
            <Select value={herdId} onValueChange={load}>
              <SelectTrigger><SelectValue placeholder="Choose a herd" /></SelectTrigger>
              <SelectContent>
                {herds.map((h) => <SelectItem key={h.herd_id} value={h.herd_id}>{h.herd_name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>

        {herdId && !data && !error && <Skeleton className="h-32 w-full" />}

        {data && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant="outline">Total: {usd(data.total)}</Badge>
              <Badge variant={data.herd.investorsHaveBought ? "outline" : "default"} className={data.herd.investorsHaveBought ? "border-amber-300 bg-amber-50 text-amber-900" : ""}>
                {data.herd.investorsHaveBought ? "Investors have bought in - corrections need a reason" : "No investors yet - freely editable by the owner"}
              </Badge>
              {data.herd.saleState && <Badge variant="outline">Sale: {data.herd.saleState.replace(/_/g, " ")}</Badge>}
            </div>
            {active.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active costs logged for this herd.</p>
            ) : (
              <div className="space-y-2">
                {active.map((e) => <ExpenseRow key={e.expenseId} expense={e} onChanged={() => load(herdId)} />)}
              </div>
            )}
            {voided.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Voided ({voided.length})</summary>
                <div className="mt-2 space-y-2">
                  {voided.map((e) => <ExpenseRow key={e.expenseId} expense={e} onChanged={() => load(herdId)} />)}
                </div>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── LRP ──────────────────────────────────────────────────────────────────────

function LrpRow({ policy, onChanged }: { policy: LrpPolicy; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [policyNumber, setPolicyNumber] = useState(policy.policyNumber ?? "");
  const [endorsementType, setEndorsementType] = useState(policy.endorsementType);
  const [coverageLevelPct, setCoverageLevelPct] = useState(policy.coverageLevelPct != null ? String(policy.coverageLevelPct) : "");
  const [floorPriceCwt, setFloorPriceCwt] = useState(policy.floorPriceCwt != null ? String(policy.floorPriceCwt) : "");
  const [premiumAmount, setPremiumAmount] = useState(policy.premiumAmount != null ? String(policy.premiumAmount) : "");
  const [effectiveDate, setEffectiveDate] = useState(policy.effectiveDate ?? "");
  const [endDate, setEndDate] = useState(policy.endDate ?? "");
  const [agentVerified, setAgentVerified] = useState(policy.agentVerified);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!reason.trim()) {
      setError("A reason is required for an admin correction.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await putLrpPolicy(policy.policyId, {
        policyNumber, endorsementType, coverageLevelPct, floorPriceCwt, premiumAmount,
        effectiveDate, endDate, agentVerified, reason,
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(errMsg(e, "Could not save that change."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background p-3 text-sm">
      {!editing ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-medium">{policy.policyNumber ?? "No policy number"}</span>{" "}
            <span className="text-muted-foreground">- {policy.endorsementType.replace(/_/g, " ")}</span>
            <p className="text-xs text-muted-foreground">
              {policy.coverageLevelPct != null ? `${policy.coverageLevelPct}% coverage` : "coverage not set"}
              {policy.floorPriceCwt != null ? `, floor $${policy.floorPriceCwt}/cwt` : ""}
              {policy.premiumAmount != null ? `, premium ${usd(policy.premiumAmount)}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {policy.effectiveDate ?? "?"} to {policy.endDate ?? "?"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={policy.agentVerified ? "default" : "outline"}>
              {policy.agentVerified ? "Agent verified" : "Not verified"}
            </Badge>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Correct</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {error && <ErrorNote message={error} />}
          <div className="grid gap-2 sm:grid-cols-3">
            <Input placeholder="Policy number" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
            <Select value={endorsementType} onValueChange={setEndorsementType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENDORSEMENTS.map((e) => <SelectItem key={e} value={e}>{e.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Coverage %" type="number" step="0.01" value={coverageLevelPct} onChange={(e) => setCoverageLevelPct(e.target.value)} />
            <Input placeholder="Floor $/cwt" type="number" step="0.01" value={floorPriceCwt} onChange={(e) => setFloorPriceCwt(e.target.value)} />
            <Input placeholder="Premium $" type="number" step="0.01" value={premiumAmount} onChange={(e) => setPremiumAmount(e.target.value)} />
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={agentVerified} onChange={(e) => setAgentVerified(e.target.checked)} />
              Agent verified
            </label>
          </div>
          <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LrpSection() {
  const { herds, error: herdsError } = useHerdList();
  const [herdId, setHerdId] = useState("");
  const [data, setData] = useState<Awaited<ReturnType<typeof getHerdLrp>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load(id: string) {
    setHerdId(id);
    setData(null);
    setError(null);
    if (!id) return;
    getHerdLrp(id).then(setData).catch((e) => setError(errMsg(e, "Could not load this herd's LRP records.")));
  }

  return (
    <Card className="rounded-3xl">
      <CardHeader><SectionHeader icon={ShieldCheck} title="LRP records" description="Placeholder records of Livestock Risk Protection policies bought through an agent. CattleCoin does not sell or verify insurance - admin can correct a record or mark it agent-verified." /></CardHeader>
      <CardContent className="space-y-4">
        {herdsError && <ErrorNote message={herdsError} />}
        {error && <ErrorNote message={error} />}
        <div className="grid gap-1.5 md:max-w-md">
          <Label>Herd</Label>
          {herds === null ? <Skeleton className="h-10 w-full" /> : (
            <Select value={herdId} onValueChange={load}>
              <SelectTrigger><SelectValue placeholder="Choose a herd" /></SelectTrigger>
              <SelectContent>
                {herds.map((h) => <SelectItem key={h.herd_id} value={h.herd_id}>{h.herd_name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>

        {herdId && !data && !error && <Skeleton className="h-24 w-full" />}

        {data && (
          data.policies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No LRP records for this herd. The producer adds these; admin can correct or verify once one exists.</p>
          ) : (
            <div className="space-y-2">
              {data.policies.map((p) => <LrpRow key={p.policyId} policy={p} onChanged={() => load(herdId)} />)}
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

// ── sales / settlement ────────────────────────────────────────────────────────

function SaleActions({ sale, onChanged }: { sale: Sale; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState("");
  const [lrpIndemnity, setLrpIndemnity] = useState(String(sale.lrpIndemnity));
  const [lrpNote, setLrpNote] = useState(sale.lrpNote ?? "");
  const [headLost, setHeadLost] = useState(sale.headLost != null ? String(sale.headLost) : "");

  async function act(fn: (id: string, note?: string) => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn(sale.saleId, note || undefined);
      onChanged();
    } catch (e) {
      setError(errMsg(e, "That action failed."));
    } finally {
      setBusy(false);
    }
  }

  async function submitCorrection() {
    if (!reason.trim()) {
      setError("A reason is required to correct a sale.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await correctSale(sale.saleId, { reason, lrpIndemnity, lrpNote, headLost });
      setCorrecting(false);
      onChanged();
    } catch (e) {
      setError(errMsg(e, "Could not correct that sale."));
    } finally {
      setBusy(false);
    }
  }

  if (sale.status !== "pending_approval") return null;

  return (
    <div className="space-y-2 border-t border-border pt-3">
      {error && <ErrorNote message={error} />}
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5">
          <Label>Note (optional)</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} className="w-64" />
        </div>
        <Button size="sm" onClick={() => act(approveSale)} disabled={busy}>Approve</Button>
        <Button size="sm" variant="destructive" onClick={() => act(rejectSale)} disabled={busy}>Reject</Button>
        <Button size="sm" variant="outline" onClick={() => setCorrecting((c) => !c)}>Correct</Button>
      </div>
      {correcting && (
        <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">Only the LRP payout, its note, and head lost can be corrected here. To change the sale price or load, the seller cancels and resubmits.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input placeholder="LRP indemnity $" type="number" step="0.01" value={lrpIndemnity} onChange={(e) => setLrpIndemnity(e.target.value)} />
            <Input placeholder="Head lost" type="number" value={headLost} onChange={(e) => setHeadLost(e.target.value)} />
            <Input placeholder="LRP note" value={lrpNote} onChange={(e) => setLrpNote(e.target.value)} />
          </div>
          <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" onClick={submitCorrection} disabled={busy}>{busy ? "Saving..." : "Save correction"}</Button>
        </div>
      )}
    </div>
  );
}

// The statement endpoint doesn't carry payoutId (it's keyed by user), so
// mark-paid uses the plain sale-detail payouts list (which does have
// payoutId) instead of the statement.
function ApprovedPayouts({ saleId, onChanged }: { saleId: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refByPayout, setRefByPayout] = useState<Record<string, string>>({});

  function load() {
    getSaleDetail(saleId).then(setDetail).catch((e) => setError(errMsg(e, "Could not load payouts.")));
  }
  useEffect(load, [saleId]);

  async function markPaid(payoutId: string) {
    const ref = refByPayout[payoutId]?.trim();
    if (!ref) return;
    try {
      await markPayoutPaid(payoutId, ref);
      load();
      onChanged();
    } catch (e) {
      setError(errMsg(e, "Could not mark that payout paid."));
    }
  }

  if (error) return <ErrorNote message={error} />;
  if (!detail?.payouts) return <Skeleton className="h-24 w-full" />;

  return (
    <div className="space-y-2">
      {detail.payouts.map((p) => (
        <div key={p.payoutId} className="rounded-xl border border-border bg-background p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><span className="font-medium">{p.slug}</span> ({p.recipientType}) - {usd(p.amount)}</span>
            <Badge variant={p.status === "paid" ? "default" : "outline"}>{p.status === "paid" ? "Paid" : "Owed"}</Badge>
          </div>
          {p.status === "owed" ? (
            <div className="mt-2 flex gap-2">
              <Input
                placeholder="Payment reference" className="h-8"
                value={refByPayout[p.payoutId] ?? ""}
                onChange={(e) => setRefByPayout((c) => ({ ...c, [p.payoutId]: e.target.value }))}
              />
              <Button size="sm" variant="outline" onClick={() => markPaid(p.payoutId)}>Mark paid</Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Paid {shortDateTime(p.paidAt)} - ref {p.paymentReference}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function SaleCard({ sale, onChanged }: { sale: Sale; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      getSaleDetail(sale.saleId).then(setDetail).catch((e) => setError(errMsg(e, "Could not load sale detail.")));
    }
  }

  function refresh() {
    setDetail(null);
    getSaleDetail(sale.saleId).then(setDetail).catch((e) => setError(errMsg(e, "Could not load sale detail.")));
    onChanged();
  }

  return (
    <div className="rounded-2xl border border-border bg-background">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <div>
            <p className="text-sm font-medium">{sale.herdName} - {usd(sale.grossAmount)}</p>
            <p className="text-xs text-muted-foreground">
              Seller {sale.sellerSlug} - submitted {shortDateTime(sale.submittedAt)}
              {sale.buyerSlug ? ` - buyer ${sale.buyerSlug} (${sale.buyerResponse})` : ""}
            </p>
          </div>
        </div>
        <Badge variant={sale.status === "approved" ? "default" : sale.status === "pending_approval" ? "outline" : "destructive"}
          className={sale.status === "pending_approval" ? "border-amber-300 bg-amber-50 text-amber-900" : ""}>
          {sale.status.replace(/_/g, " ")}
        </Badge>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-4">
          {error && <ErrorNote message={error} />}
          {sale.warnings.length > 0 && (
            <div className="space-y-1">
              {sale.warnings.map((w, i) => <p key={i} className="text-xs text-amber-800">{w}</p>)}
            </div>
          )}
          {!detail ? <Skeleton className="h-20 w-full" /> : (
            <>
              {detail.preview && (
                <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm">
                  <p className="font-medium">Preview split (not yet approved)</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {detail.preview.payouts.map((p, i) => (
                      <p key={i} className="text-xs text-muted-foreground">
                        {p.slug ?? p.recipientType} ({p.recipientType}): {usd(p.amount)}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {sale.status === "approved" && <ApprovedPayouts saleId={sale.saleId} onChanged={refresh} />}
              {detail.corrections && detail.corrections.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Correction history ({detail.corrections.length})</summary>
                  <div className="mt-2 space-y-1">
                    {detail.corrections.map((c, i) => (
                      <p key={i} className="text-muted-foreground">
                        {c.action} by {c.changedBy ?? "?"} at {shortDateTime(c.at)}{c.reason ? ` - ${c.reason}` : ""}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
          <SaleActions sale={sale} onChanged={refresh} />
        </div>
      )}
    </div>
  );
}

function SalesSection() {
  const [status, setStatus] = useState<SaleStatus | "all">("pending_approval");
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Used to refresh after an action (approve/reject/correct/mark-paid) - those
  // run from a click handler, not an effect, so resetting state up front here
  // is fine there.
  function load() {
    setSales(null);
    setError(null);
    getSales(status === "all" ? undefined : status).then(setSales).catch((e) => setError(errMsg(e, "Could not load sales.")));
  }
  // The initial/status-change load is a real effect, so it only ever calls
  // setState from inside the promise callbacks (never synchronously in the
  // effect body), same shape as the rest of this file's data-loading effects.
  useEffect(() => {
    let alive = true;
    getSales(status === "all" ? undefined : status)
      .then((s) => { if (alive) { setSales(s); setError(null); } })
      .catch((e) => { if (alive) setError(errMsg(e, "Could not load sales.")); });
    return () => { alive = false; };
  }, [status]);

  return (
    <Card className="rounded-3xl">
      <CardHeader><SectionHeader icon={Gavel} title="Sales" description="Approve or reject a submitted sale, correct the LRP payout or head lost before approval, and mark settled payouts paid once approved." /></CardHeader>
      <CardContent className="space-y-4">
        {error && <ErrorNote message={error} />}
        <div className="grid gap-1.5 md:max-w-xs">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v: SaleStatus | "all") => setStatus(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending_approval">Pending approval</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {sales === null ? <Skeleton className="h-32 w-full" /> : sales.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales with this status.</p>
        ) : (
          <div className="space-y-2">
            {sales.map((s) => <SaleCard key={s.saleId} sale={s} onChanged={load} />)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export function HerdOps() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to admin
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Herd operations</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Costs, LRP records, and sale approval and settlement - the producer logs costs and LRP and submits a sale;
          admin corrects, verifies, approves or rejects, and marks payouts paid once a sale is settled.
        </p>
      </div>

      <SalesSection />
      <CostsSection />
      <LrpSection />
    </div>
  );
}

export default HerdOps;
