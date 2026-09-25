import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Lock, ScrollText, Percent, Wallet, Users, TrendingUp } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  getFeeDefaults, putFeeDefaults, getHerds, getHerdFees, putHerdFees,
  getInvestorOverrides, putInvestorOverride, deleteInvestorOverride,
  getFeeAudit, getFeeRevenue, getHerdFunds, postReleaseFunds, postMarkReleasePaid, getInvestors,
  termsToDraft, usd, pct, shortDateTime, FeeApiError, MAX_FEE_PCT, MAX_PER_HEAD_FEE,
  type FeeTerms, type FeeTermsDraft, type HerdListItem, type InvestorOverride,
  type FeeAuditEntry, type FeeRevenue, type HerdFundsDetail, type UserSummary,
} from "@/lib/feeSetup";

// ── shared bits ────────────────────────────────────────────────────────────

function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {children}
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return <p className="text-sm text-red-600">{message}</p>;
}

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof FeeApiError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

const EMPTY_DRAFT: FeeTermsDraft = {
  raiseFeePct: "0",
  exitProfitFeePct: "0",
  exitFeePayer: "investor",
  perHeadFee: "0",
  perHeadFeeTiming: "raise",
  note: "",
};

/** The raise fee %, exit profit fee %, payer, per-head fee, and timing fields. Reused for defaults and per-herd terms. */
function TermsFields({
  draft, onChange, disabled, lockedNote,
}: {
  draft: FeeTermsDraft;
  onChange: (next: FeeTermsDraft) => void;
  disabled?: boolean;
  lockedNote?: string;
}) {
  return (
    <div className="space-y-4">
      {lockedNote && (
        <Banner>
          <Lock className="mr-1 inline h-3.5 w-3.5" />
          {lockedNote}
        </Banner>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Raise fee (% of investor money, paid by the producer)</Label>
          <Input
            type="number" step="0.01" min={0} max={MAX_FEE_PCT} disabled={disabled}
            value={draft.raiseFeePct}
            onChange={(e) => onChange({ ...draft, raiseFeePct: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Exit profit fee (% of profit at sale)</Label>
          <Input
            type="number" step="0.01" min={0} max={MAX_FEE_PCT} disabled={disabled}
            value={draft.exitProfitFeePct}
            onChange={(e) => onChange({ ...draft, exitProfitFeePct: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Who pays the exit profit fee</Label>
          <Select
            value={draft.exitFeePayer} disabled={disabled}
            onValueChange={(v: "investor" | "producer") => onChange({ ...draft, exitFeePayer: v })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="investor">Investor</SelectItem>
              <SelectItem value="producer">Producer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Per-head fee ($ flat, optional)</Label>
          <Input
            type="number" step="0.01" min={0} max={MAX_PER_HEAD_FEE} disabled={disabled}
            value={draft.perHeadFee}
            onChange={(e) => onChange({ ...draft, perHeadFee: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>When the per-head fee is charged</Label>
          <Select
            value={draft.perHeadFeeTiming} disabled={disabled}
            onValueChange={(v: "raise" | "exit") => onChange({ ...draft, perHeadFeeTiming: v })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="raise">At raise (first release)</SelectItem>
              <SelectItem value="exit">At exit (from sale proceeds)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 md:col-span-2">
          <Label>Note (optional, shown in the audit log)</Label>
          <Input
            disabled={disabled} value={draft.note} maxLength={255}
            onChange={(e) => onChange({ ...draft, note: e.target.value })}
            placeholder="Why these terms - e.g. large-producer discount"
          />
        </div>
      </div>
    </div>
  );
}

// ── platform defaults ───────────────────────────────────────────────────────

function DefaultsSection() {
  const [terms, setTerms] = useState<FeeTerms | null>(null);
  const [draft, setDraft] = useState<FeeTermsDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  function load() {
    setError(null);
    getFeeDefaults()
      .then((r) => { setTerms(r.defaults); setDraft(termsToDraft(r.defaults)); })
      .catch((e) => setError(errMsg(e, "Could not load platform defaults.")));
  }
  useEffect(load, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      const r = await putFeeDefaults(draft);
      setTerms(r.defaults);
      setDraft(termsToDraft(r.defaults));
      setSavedMsg("Saved. New herds will start from these numbers.");
    } catch (e) {
      setError(errMsg(e, "Could not save platform defaults."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rounded-3xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-primary/10 p-2 text-primary"><Percent className="h-4 w-4" /></div>
          <CardTitle className="text-base">Platform defaults</CardTitle>
        </div>
        <CardDescription>
          The starting point for every new herd. Changing this does not touch herds that already have their own terms.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <ErrorNote message={error} />}
        {!terms ? (
          <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : (
          <>
            <TermsFields draft={draft} onChange={setDraft} />
            <div className="flex items-center gap-3">
              <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save defaults"}</Button>
              {savedMsg && <span className="text-sm text-muted-foreground">{savedMsg}</span>}
            </div>
            {terms.updatedAt && (
              <p className="text-xs text-muted-foreground">Last updated {shortDateTime(terms.updatedAt)}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── per-herd terms + funds ──────────────────────────────────────────────────

function HerdSection() {
  const [herds, setHerds] = useState<HerdListItem[] | null>(null);
  const [herdId, setHerdId] = useState<string>("");
  const [draft, setDraft] = useState<FeeTermsDraft>(EMPTY_DRAFT);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getHerdFees>> | null>(null);
  const [funds, setFunds] = useState<HerdFundsDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [releaseAmount, setReleaseAmount] = useState("");
  const [releaseNote, setReleaseNote] = useState("");
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [payRefByRelease, setPayRefByRelease] = useState<Record<string, string>>({});

  useEffect(() => {
    getHerds()
      .then((r) => setHerds(r.items))
      .catch((e) => setError(errMsg(e, "Could not load the herd list.")));
  }, []);

  function loadHerd(id: string) {
    setHerdId(id);
    setDetail(null);
    setFunds(null);
    setError(null);
    setSavedMsg(null);
    if (!id) return;
    getHerdFees(id)
      .then((d) => {
        setDetail(d);
        setDraft(d.terms ? termsToDraft(d.terms) : termsToDraft(d.defaultsThatWouldApply ?? EMPTY_DRAFT as unknown as FeeTerms));
      })
      .catch((e) => setError(errMsg(e, "Could not load this herd's fee terms.")));
    getHerdFunds(id).then(setFunds).catch(() => setFunds(null));
  }

  async function save() {
    if (!herdId) return;
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      await putHerdFees(herdId, draft);
      loadHerd(herdId);
      setSavedMsg("Saved.");
    } catch (e) {
      setError(errMsg(e, "Could not save this herd's fee terms."));
    } finally {
      setSaving(false);
    }
  }

  async function release() {
    if (!herdId) return;
    setReleaseBusy(true);
    setReleaseError(null);
    try {
      await postReleaseFunds(herdId, { amount: releaseAmount || undefined, note: releaseNote || undefined });
      setReleaseAmount("");
      setReleaseNote("");
      loadHerd(herdId);
    } catch (e) {
      setReleaseError(errMsg(e, "Could not release funds."));
    } finally {
      setReleaseBusy(false);
    }
  }

  async function markPaid(releaseId: string) {
    const ref = payRefByRelease[releaseId]?.trim();
    if (!ref) return;
    try {
      await postMarkReleasePaid(releaseId, ref);
      loadHerd(herdId);
    } catch (e) {
      setReleaseError(errMsg(e, "Could not mark that release paid."));
    }
  }

  const locked = !!detail?.locked;

  return (
    <Card className="rounded-3xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-primary/10 p-2 text-primary"><Wallet className="h-4 w-4" /></div>
          <CardTitle className="text-base">Herd fee terms and funds</CardTitle>
        </div>
        <CardDescription>
          Pick a herd to see or change its own terms (starts from the platform defaults), and to release raised money to the producer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <ErrorNote message={error} />}
        <div className="grid gap-1.5 md:max-w-md">
          <Label>Herd</Label>
          {herds === null ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select value={herdId} onValueChange={loadHerd}>
              <SelectTrigger><SelectValue placeholder="Choose a herd" /></SelectTrigger>
              <SelectContent>
                {herds.map((h) => (
                  <SelectItem key={h.herd_id} value={h.herd_id}>
                    {h.herd_name}{h.head_count != null ? ` (${h.head_count} head)` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {herdId && !detail && !error && <Skeleton className="h-40 w-full" />}

        {detail && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={detail.termsSet ? "default" : "outline"}>
                {detail.termsSet ? "Has its own terms" : "Using platform defaults (not yet set for this herd)"}
              </Badge>
              {locked && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Locked</Badge>}
            </div>

            <TermsFields
              draft={draft}
              onChange={setDraft}
              lockedNote={locked ? "An investor has bought in or money has been released, so these terms are locked: fees can be lowered but not raised, and the payer/timing can't change." : undefined}
            />
            <div className="flex items-center gap-3">
              <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save herd terms"}</Button>
              {savedMsg && <span className="text-sm text-muted-foreground">{savedMsg}</span>}
            </div>

            {funds && (
              <div className="space-y-3 rounded-2xl border border-border bg-muted/30 p-4">
                <p className="text-sm font-semibold">Funds position</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div><p className="text-xs text-muted-foreground">Raised</p><p className="font-medium">{usd(funds.funds.raised)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Released</p><p className="font-medium">{usd(funds.funds.released)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Available</p><p className="font-medium">{usd(funds.funds.available)}</p></div>
                </div>

                {releaseError && <ErrorNote message={releaseError} />}
                <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                  <div className="grid gap-1.5">
                    <Label>Amount (blank = all available)</Label>
                    <Input type="number" step="0.01" min={0} value={releaseAmount} onChange={(e) => setReleaseAmount(e.target.value)} placeholder={usd(funds.funds.available)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Note (optional)</Label>
                    <Input value={releaseNote} onChange={(e) => setReleaseNote(e.target.value)} />
                  </div>
                  <Button onClick={release} disabled={releaseBusy || funds.funds.available <= 0 || !detail.termsSet}>
                    {releaseBusy ? "Releasing..." : "Release to producer"}
                  </Button>
                </div>
                {!detail.termsSet && (
                  <p className="text-xs text-muted-foreground">Set this herd's fee terms above before releasing money.</p>
                )}

                {funds.releases.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <p className="text-sm font-semibold">Releases</p>
                    {funds.releases.map((r) => (
                      <div key={r.releaseId} className="rounded-xl border border-border bg-background p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            {usd(r.grossAmount)} gross - raise fee {usd(r.raiseFee)}, per-head {usd(r.perHeadFee)} -&gt; net {usd(r.netToProducer)} to producer
                          </span>
                          <Badge variant={r.status === "paid" ? "default" : "outline"}>{r.status === "paid" ? "Paid" : "Owed"}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{shortDateTime(r.releasedAt)}{r.note ? ` - ${r.note}` : ""}</p>
                        {r.status === "paid" ? (
                          <p className="mt-1 text-xs text-muted-foreground">Paid {shortDateTime(r.paidAt)} - ref {r.paymentReference}</p>
                        ) : (
                          <div className="mt-2 flex gap-2">
                            <Input
                              placeholder="Payment reference"
                              className="h-8"
                              value={payRefByRelease[r.releaseId] ?? ""}
                              onChange={(e) => setPayRefByRelease((cur) => ({ ...cur, [r.releaseId]: e.target.value }))}
                            />
                            <Button size="sm" variant="outline" onClick={() => markPaid(r.releaseId)}>Mark paid</Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── investor overrides ──────────────────────────────────────────────────────

function OverridesSection() {
  const [overrides, setOverrides] = useState<InvestorOverride[] | null>(null);
  const [investors, setInvestors] = useState<UserSummary[] | null>(null);
  const [herds, setHerds] = useState<HerdListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [herdId, setHerdId] = useState<string>("__all__");
  const [pctValue, setPctValue] = useState("0");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    setError(null);
    getInvestorOverrides().then(setOverrides).catch((e) => setError(errMsg(e, "Could not load investor overrides.")));
  }
  useEffect(() => {
    load();
    getInvestors().then(setInvestors).catch(() => setInvestors([]));
    getHerds().then((r) => setHerds(r.items)).catch(() => setHerds([]));
  }, []);

  async function add() {
    if (!slug) return;
    setBusy(true);
    setError(null);
    try {
      await putInvestorOverride({ investorSlug: slug, herdId: herdId === "__all__" ? undefined : herdId, exitProfitFeePct: pctValue, note });
      setSlug("");
      setPctValue("0");
      setNote("");
      setHerdId("__all__");
      load();
    } catch (e) {
      setError(errMsg(e, "Could not save that override."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(overrideId: string) {
    setError(null);
    try {
      await deleteInvestorOverride(overrideId);
      load();
    } catch (e) {
      setError(errMsg(e, "Could not remove that override."));
    }
  }

  return (
    <Card className="rounded-3xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-primary/10 p-2 text-primary"><Users className="h-4 w-4" /></div>
          <CardTitle className="text-base">Investor overrides</CardTitle>
        </div>
        <CardDescription>
          Give one investor a different exit profit fee - for one herd, or all herds. A herd-specific override wins over an all-herds one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <ErrorNote message={error} />}

        <div className="grid gap-3 sm:grid-cols-[1.2fr_1.2fr_0.8fr_1.4fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label>Investor</Label>
            <Select value={slug} onValueChange={setSlug}>
              <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>
                {(investors ?? []).map((u) => <SelectItem key={u.userId} value={u.slug}>{u.slug}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Applies to</Label>
            <Select value={herdId} onValueChange={setHerdId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All herds</SelectItem>
                {(herds ?? []).map((h) => <SelectItem key={h.herd_id} value={h.herd_id}>{h.herd_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Exit fee %</Label>
            <Input type="number" step="0.01" min={0} max={MAX_FEE_PCT} value={pctValue} onChange={(e) => setPctValue(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} />
          </div>
          <Button onClick={add} disabled={busy || !slug}>{busy ? "Saving..." : "Add / update"}</Button>
        </div>

        {overrides === null ? (
          <Skeleton className="h-24 w-full" />
        ) : overrides.length === 0 ? (
          <p className="text-sm text-muted-foreground">No investor overrides yet.</p>
        ) : (
          <div className="space-y-2">
            {overrides.map((o) => (
              <div key={o.overrideId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-3 text-sm">
                <div>
                  <span className="font-medium">{o.investorSlug}</span>{" "}
                  <span className="text-muted-foreground">- {o.appliesTo}{o.herdName ? ` (${o.herdName})` : ""} - {pct(o.exitProfitFeePct)} exit fee</span>
                  {o.note && <p className="text-xs text-muted-foreground">{o.note}</p>}
                </div>
                <Button size="sm" variant="destructive" onClick={() => remove(o.overrideId)}>Remove</Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── audit log ────────────────────────────────────────────────────────────────

function AuditSection() {
  const [entries, setEntries] = useState<FeeAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFeeAudit().then(setEntries).catch((e) => setError(errMsg(e, "Could not load the fee audit log.")));
  }, []);

  return (
    <Card className="rounded-3xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-primary/10 p-2 text-primary"><ScrollText className="h-4 w-4" /></div>
          <CardTitle className="text-base">Fee change history</CardTitle>
        </div>
        <CardDescription>The most recent 200 fee changes, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {error && <ErrorNote message={error} />}
        {entries === null ? (
          <Skeleton className="h-32 w-full" />
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fee changes recorded yet.</p>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {entries.map((a) => (
              <div key={a.auditId} className="rounded-xl border border-border bg-background p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{a.action.replace(/_/g, " ")}</span>
                  <span className="text-xs text-muted-foreground">{shortDateTime(a.changedAt)}{a.changedBy ? ` - by ${a.changedBy}` : ""}</span>
                </div>
                {a.investorSlug && <p className="text-xs text-muted-foreground">Investor: {a.investorSlug}</p>}
                {(a.oldValues || a.newValues) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.oldValues ? `Before: ${JSON.stringify(a.oldValues)}. ` : ""}
                    {a.newValues ? `After: ${JSON.stringify(a.newValues)}` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── revenue ──────────────────────────────────────────────────────────────────

function RevenueSection() {
  const [revenue, setRevenue] = useState<FeeRevenue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFeeRevenue().then(setRevenue).catch((e) => setError(errMsg(e, "Could not load fee revenue.")));
  }, []);

  return (
    <Card className="rounded-3xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-primary/10 p-2 text-primary"><TrendingUp className="h-4 w-4" /></div>
          <CardTitle className="text-base">What the platform has earned in fees</CardTitle>
        </div>
        <CardDescription>Recorded when money is released and when a sale is approved. No money has moved.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <ErrorNote message={error} />}
        {revenue === null ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">Raise fees</p><p className="font-medium">{usd(revenue.totals.raiseFees)}</p></div>
              <div><p className="text-xs text-muted-foreground">Per-head at raise</p><p className="font-medium">{usd(revenue.totals.perHeadFeesAtRaise)}</p></div>
              <div><p className="text-xs text-muted-foreground">Exit fees</p><p className="font-medium">{usd(revenue.totals.exitFees)}</p></div>
              <div><p className="text-xs text-muted-foreground">Total</p><p className="font-medium">{usd(revenue.totals.total)}</p></div>
            </div>
            {revenue.herds.length === 0 ? (
              <p className="text-sm text-muted-foreground">No fees recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2 font-medium">Herd</th>
                      <th className="px-2 py-2 font-medium">Raise fees</th>
                      <th className="px-2 py-2 font-medium">Per-head at raise</th>
                      <th className="px-2 py-2 font-medium">Exit fees</th>
                      <th className="px-2 py-2 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {revenue.herds.map((h) => (
                      <tr key={h.herdId}>
                        <td className="px-2 py-2">{h.herdName}</td>
                        <td className="px-2 py-2">{usd(h.raiseFees)}</td>
                        <td className="px-2 py-2">{usd(h.perHeadFeesAtRaise)}</td>
                        <td className="px-2 py-2">{usd(h.exitFees)}</td>
                        <td className="px-2 py-2 font-medium">{usd(h.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export function FeeSetup() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to admin
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Fee setup</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Set the raise fee, exit profit fee, and per-head fee - platform-wide, per herd, or per investor. Every fee starts
          at 0 until you set it here. Once a herd has its first investor payment or its first release, its terms lock:
          from then on fees can only be lowered, not raised, and the payer/timing can't change.
        </p>
      </div>

      <DefaultsSection />
      <HerdSection />
      <OverridesSection />
      <div className="grid gap-6 xl:grid-cols-2">
        <RevenueSection />
        <AuditSection />
      </div>
    </div>
  );
}

export default FeeSetup;
