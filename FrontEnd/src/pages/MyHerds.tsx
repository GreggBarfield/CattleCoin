import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Milestone, Plus, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getMyHerds, getMyInvestments, getHerdFunds, postOpenHerd, postCloseHerd,
  herdStatus, STATUS_LABEL, checkInvestorPct, checkPrice, offerPreview,
  type MyHerdRow, type MyHerdInvestment, type HerdFunds, type HerdStatus,
} from "@/lib/rancherHerds";

// My Herds (punch list #3, pass 1): every herd the rancher owns, with its
// status, head count, stage, money raised and investors, plus open / close to
// investors and a link to Herd Stages. Money actions (costs, LRP, sale,
// payouts) come in pass 2.

const STAGE_LABEL: Record<string, string> = {
  RANCH: "Ranch",
  BACKGROUNDING: "Backgrounding",
  FEEDLOT: "Feedlot",
  PROCESSING: "Processing",
  DISTRIBUTION: "Distribution",
};

const STATUS_STYLE: Record<HerdStatus, string> = {
  not_open: "border-border bg-muted text-muted-foreground",
  open: "border-emerald-300 bg-emerald-50 text-emerald-900",
  fully_funded: "border-sky-300 bg-sky-50 text-sky-900",
  sold: "border-amber-300 bg-amber-50 text-amber-900",
};

function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

type HerdView = {
  row: MyHerdRow;
  inv: MyHerdInvestment | undefined;
  funds: HerdFunds["funds"] | undefined;
};

// -- one line in a herd's facts grid --

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

// -- open-to-investors form, shown inside a herd card --

function OpenForm({
  view, onDone, onCancel,
}: {
  view: HerdView;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { row, inv } = view;
  const startPrice = num(row.listing_price);
  const [pct, setPct] = useState(row.investor_pct != null ? String(Number(row.investor_pct)) : "");
  const [price, setPrice] = useState(startPrice != null ? String(startPrice) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A herd that was opened before keeps its share count; a new one gets one share per head.
  const totalShares = inv?.totalSupply ?? row.head_count ?? 0;
  const pctError = checkInvestorPct(pct);
  const priceError = checkPrice(price);
  const preview = pctError || priceError ? null : offerPreview(Number(price), totalShares, Number(pct));

  async function submit() {
    const problem = pctError ?? priceError;
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await postOpenHerd(row.herd_id, Number(pct), Number(price));
      onDone(r.message);
    } catch (e) {
      setError(errMsg(e, "Could not open this herd to investors."));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
      <p className="text-sm font-medium">Open to investors</p>
      <div className="flex flex-wrap gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`pct-${row.herd_id}`}>Percent offered to investors</Label>
          <Input
            id={`pct-${row.herd_id}`}
            inputMode="decimal"
            placeholder="e.g. 50"
            className="w-40"
            value={pct}
            disabled={busy}
            onChange={(e) => { setPct(e.target.value); setError(null); }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`price-${row.herd_id}`}>Herd value (asking price, $)</Label>
          <Input
            id={`price-${row.herd_id}`}
            inputMode="decimal"
            placeholder="e.g. 40000"
            className="w-48"
            value={price}
            disabled={busy}
            onChange={(e) => { setPrice(e.target.value); setError(null); }}
          />
        </div>
      </div>
      {preview && (
        <dl className="grid max-w-md grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-border bg-background p-3 text-sm">
          <dt className="text-muted-foreground">Shares offered</dt>
          <dd className="font-medium">{preview.allocation} of {preview.totalShares}</dd>
          <dt className="text-muted-foreground">Price per share</dt>
          <dd className="font-medium">{usd(preview.pricePerShare)}</dd>
          <dt className="text-muted-foreground">Most you can raise</dt>
          <dd className="font-medium">{usd(preview.maxRaise)}</dd>
        </dl>
      )}
      <p className="text-xs text-muted-foreground">
        Investors get their money back first and share only the gain above the herd's value.
        Platform fees are set by CattleCoin.
      </p>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={busy}>{busy ? "Opening..." : "Open to Investors"}</Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

// -- close-to-investors confirm, shown inside a herd card --

function CloseConfirm({
  view, onDone, onCancel,
}: {
  view: HerdView;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await postCloseHerd(view.row.herd_id);
      onDone(r.message);
    } catch (e) {
      setError(errMsg(e, "Could not close this herd to investors."));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/50 p-4">
      <p className="text-sm">
        Take <span className="font-medium">{view.row.herd_name}</span> off the investor marketplace?
        You can open it again later.
      </p>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button variant="destructive" onClick={submit} disabled={busy}>
          {busy ? "Closing..." : "Yes, close to investors"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>Keep it open</Button>
      </div>
    </div>
  );
}

// -- one herd --

function HerdCard({
  view, onChanged,
}: {
  view: HerdView;
  onChanged: (message: string) => void;
}) {
  const { row, inv, funds } = view;
  const [mode, setMode] = useState<"none" | "open" | "close">("none");
  const status = herdStatus(row);
  const headCount = row.head_count ?? 0;
  const noCattle = row.cattle_count === 0;
  const countMismatch = !noCattle && row.cattle_count !== headCount;
  const sold = inv?.tokensSold ?? 0;
  const investors = inv?.investorCount ?? 0;
  const offered = inv?.totalSupply && row.investor_pct != null
    ? Math.floor((inv.totalSupply * Number(row.investor_pct)) / 100)
    : null;
  const raised = funds ? funds.raised : inv ? inv.estimatedCapitalRaised : 0;
  const stage = row.dominant_stage || "RANCH";

  const canOpen = status === "not_open" && !noCattle && headCount > 0;
  const canClose = status === "open" && sold === 0;

  function done(message: string) {
    setMode("none");
    onChanged(message);
  }

  return (
    <Card className="rounded-3xl" data-testid="herd-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="break-words text-base">{row.herd_name}</CardTitle>
            <CardDescription>
              Posted {shortDate(row.created_at)} - ID {row.herd_id.slice(0, 8)}
              {row.breed_code ? ` - ${row.breed_code}` : ""}
              {row.season ? ` - ${row.season}` : ""}
            </CardDescription>
          </div>
          <Badge variant="outline" className={STATUS_STYLE[status]}>{STATUS_LABEL[status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          <Fact label="Head">
            {headCount} head
            <span className="block text-xs font-normal text-muted-foreground">{row.cattle_count} registered</span>
          </Fact>
          <Fact label="Stage">{STAGE_LABEL[stage] ?? stage}</Fact>
          <Fact label="Herd value">{usd(num(row.listing_price))}</Fact>
          <Fact label="Offered">
            {row.investor_pct != null && status !== "not_open" ? `${Number(row.investor_pct)}%` : "-"}
          </Fact>
          <Fact label="Shares sold">
            {offered != null && status !== "not_open" ? `${sold} of ${offered}` : sold > 0 ? String(sold) : "-"}
          </Fact>
          <Fact label="Money raised">
            {usd(raised)}
            <span className="block text-xs font-normal text-muted-foreground">
              {investors} investor{investors === 1 ? "" : "s"}
              {funds && funds.released > 0 ? ` - ${usd(funds.released)} released` : ""}
            </span>
          </Fact>
        </dl>

        {noCattle && (
          <p className="text-sm text-amber-800">
            No cattle uploaded to this herd yet, so it can't be opened to investors.
            Setup was probably left partway through Post a Lot.
          </p>
        )}
        {countMismatch && (
          <p className="text-sm text-amber-800">
            Head count is {headCount} but {row.cattle_count} animals are registered.
          </p>
        )}
        {status === "open" && sold > 0 && (
          <p className="text-xs text-muted-foreground">
            Investors have bought in, so this herd can't be closed to investors.
          </p>
        )}

        {mode === "open" && <OpenForm view={view} onDone={done} onCancel={() => setMode("none")} />}
        {mode === "close" && <CloseConfirm view={view} onDone={done} onCancel={() => setMode("none")} />}

        {mode === "none" && (
          <div className="flex flex-wrap gap-2">
            {canOpen && <Button onClick={() => setMode("open")}>Open to Investors</Button>}
            {canClose && <Button variant="outline" onClick={() => setMode("close")}>Close to Investors</Button>}
            <Button variant="outline" asChild>
              <Link to={`/rancher/stages?herd=${row.herd_id}`}>
                <Milestone className="mr-1 h-4 w-4" /> Herd Stages
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// -- page --

export function MyHerds() {
  const [views, setViews] = useState<HerdView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, invs] = await Promise.all([getMyHerds(), getMyInvestments()]);
      const invById = new Map(invs.items.map((i) => [i.herdId, i]));
      // exact money raised / released, only for herds where investors have bought in
      const withBuyers = rows.filter((r) => (invById.get(r.herd_id)?.tokensSold ?? 0) > 0);
      const fundsList = await Promise.all(
        withBuyers.map((r) => getHerdFunds(r.herd_id).then((f) => f.funds).catch(() => undefined))
      );
      const fundsById = new Map(withBuyers.map((r, i) => [r.herd_id, fundsList[i]]));
      setViews(rows.map((row) => ({ row, inv: invById.get(row.herd_id), funds: fundsById.get(row.herd_id) })));
    } catch (e) {
      setError(errMsg(e, "Could not load your herds."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function changed(msg: string) {
    setMessage(msg);
    void load();
  }

  const totals = (views ?? []).reduce(
    (acc, v) => {
      const s = herdStatus(v.row);
      acc.herds += 1;
      acc.head += v.row.head_count ?? 0;
      if (s === "open" || s === "fully_funded") acc.open += 1;
      acc.raised += v.funds ? v.funds.raised : v.inv ? v.inv.estimatedCapitalRaised : 0;
      acc.investors += v.inv?.investorCount ?? 0;
      return acc;
    },
    { herds: 0, head: 0, open: 0, raised: 0, investors: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Herds</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every lot you've posted, where it stands, and what investors have put in.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button asChild>
            <Link to="/rancher/new"><Plus className="mr-1 h-4 w-4" /> Post a Lot</Link>
          </Button>
        </div>
      </div>

      {views && views.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Herds", String(totals.herds)],
            ["Head", String(totals.head)],
            ["Open to investors", String(totals.open)],
            ["Money raised", usd(totals.raised)],
          ].map(([label, value]) => (
            <Card key={label}>
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-1 break-words text-xl font-bold sm:text-2xl">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {message && <p className="text-sm text-emerald-700" role="status">{message}</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      {views === null && !error && (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-3xl" />
          <Skeleton className="h-40 w-full rounded-3xl" />
        </div>
      )}

      {views && views.length === 0 && (
        <Card className="rounded-3xl">
          <CardContent className="space-y-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">You haven't posted any lots yet.</p>
            <Button asChild>
              <Link to="/rancher/new"><Plus className="mr-1 h-4 w-4" /> Post your first lot</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {views && views.length > 0 && (
        <div className="space-y-4">
          {views.map((v) => <HerdCard key={v.row.herd_id} view={v} onChanged={changed} />)}
        </div>
      )}
    </div>
  );
}

export default MyHerds;
