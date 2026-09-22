import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Milestone } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import {
  getHerdsByOwner, getStageHistory, postStageChange, nextStage,
  STAGES, LifecycleApiError,
  type OwnedHerd, type StageHistoryResult,
} from "@/lib/herdLifecycle";

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof LifecycleApiError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

function ErrorNote({ message }: { message: string }) {
  return <p className="text-sm text-red-600">{message}</p>;
}

function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const STAGE_LABEL: Record<string, string> = {
  RANCH: "Ranch",
  BACKGROUNDING: "Backgrounding",
  FEEDLOT: "Feedlot",
  PROCESSING: "Processing",
  DISTRIBUTION: "Distribution",
};

// -- stage progress strip --

function StageStrip({ current }: { current: string }) {
  const idx = STAGES.indexOf(current as (typeof STAGES)[number]);
  return (
    <div className="flex items-center">
      {STAGES.map((s, i) => {
        const done = idx >= 0 && i < idx;
        const active = s === current;
        return (
          <div key={s} className="flex items-center">
            {i > 0 && <div className={`h-px w-6 ${done || active ? "bg-primary" : "bg-border"}`} />}
            <div
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : done
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
              }`}
            >
              {STAGE_LABEL[s] ?? s}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// -- stage history list --

function HistoryList({ history }: { history: StageHistoryResult["history"] }) {
  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">No stage changes recorded yet.</p>;
  }
  return (
    <div className="space-y-2">
      {[...history].reverse().map((h) => (
        <div key={h.historyId} className="rounded-xl border border-border bg-muted/20 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {h.fromStage ? `${STAGE_LABEL[h.fromStage] ?? h.fromStage} -> ` : ""}
              {STAGE_LABEL[h.toStage] ?? h.toStage}
            </span>
            {h.isCorrection && (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                Admin correction
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {h.changedBy ?? "?"} - {shortDateTime(h.changedAt)}
            {h.note ? ` - ${h.note}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

// -- page --

export function StageUpdate() {
  const { currentUser } = useAuth();
  const [herds, setHerds] = useState<OwnedHerd[] | null>(null);
  const [herdsError, setHerdsError] = useState<string | null>(null);
  const [herdId, setHerdId] = useState("");
  const [data, setData] = useState<StageHistoryResult | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    getHerdsByOwner(currentUser.userId)
      .then((r) => setHerds(r.items))
      .catch((e) => setHerdsError(errMsg(e, "Could not load your herds.")));
  }, [currentUser]);

  function load(id: string) {
    setHerdId(id);
    setData(null);
    setDataError(null);
    setActionError(null);
    setMessage(null);
    if (!id) return;
    getStageHistory(id).then(setData).catch((e) => setDataError(errMsg(e, "Could not load this herd's stage history.")));
  }

  async function advance() {
    if (!data) return;
    const to = nextStage(data.herd.dominantStage);
    if (!to) return;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const r = await postStageChange(herdId, { stage: to, note: note.trim() || undefined });
      setMessage(r.message);
      setNote("");
      load(herdId);
    } catch (e) {
      setActionError(errMsg(e, "Could not update the stage."));
    } finally {
      setBusy(false);
    }
  }

  const upcoming = data ? nextStage(data.herd.dominantStage) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/rancher" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Herd stages</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Move a herd forward one custody stage at a time - Ranch, Backgrounding, Feedlot, Processing, Distribution.
          No skipping ahead; every change is kept in a history you and an admin can see.
        </p>
      </div>

      <Card className="rounded-3xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-primary/10 p-2 text-primary"><Milestone className="h-4 w-4" /></div>
            <div>
              <CardTitle className="text-base">Update a herd's stage</CardTitle>
              <CardDescription>Choose one of your herds, then move it to the next stage.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {herdsError && <ErrorNote message={herdsError} />}
          <div className="grid gap-1.5 md:max-w-md">
            <Label>Herd</Label>
            {herds === null ? <Skeleton className="h-10 w-full" /> : herds.length === 0 ? (
              <p className="text-sm text-muted-foreground">You don't have any herds yet.</p>
            ) : (
              <Select value={herdId} onValueChange={load}>
                <SelectTrigger><SelectValue placeholder="Choose a herd" /></SelectTrigger>
                <SelectContent>
                  {herds.map((h) => (
                    <SelectItem key={h.herd_id} value={h.herd_id}>
                      {h.herd_name} ({h.cattle_count} head)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {herdId && !data && !dataError && <Skeleton className="h-24 w-full" />}
          {dataError && <ErrorNote message={dataError} />}

          {data && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium">{data.herd.herdName}</span>
                  <Badge variant="outline">{STAGE_LABEL[data.herd.dominantStage] ?? data.herd.dominantStage}</Badge>
                </div>
                <StageStrip current={data.herd.dominantStage} />
              </div>

              {message && <p className="text-sm text-emerald-700">{message}</p>}
              {actionError && <ErrorNote message={actionError} />}

              {upcoming ? (
                <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-muted/20 p-3">
                  <div className="grid gap-1.5">
                    <Label>Note (optional)</Label>
                    <Input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="w-64"
                      placeholder="e.g. loaded and shipped 9/22"
                    />
                  </div>
                  <Button onClick={advance} disabled={busy}>
                    {busy ? "Updating..." : `Move to ${STAGE_LABEL[upcoming] ?? upcoming}`}
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This herd is already at the last stage ({STAGE_LABEL[data.herd.dominantStage] ?? data.herd.dominantStage}).
                  Ask an admin if it needs a correction.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {data && (
        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle className="text-base">Stage history</CardTitle>
            <CardDescription>Oldest to newest change, newest shown first.</CardDescription>
          </CardHeader>
          <CardContent>
            <HistoryList history={data.history} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default StageUpdate;
