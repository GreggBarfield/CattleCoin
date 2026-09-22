import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ClipboardList, PlusCircle } from "lucide-react";
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
  getHerdsByOwner, getHerdAnimals, getHerdCarcass,
  postCarcassRecord, putCarcassRecord, voidCarcassRecord,
  QUALITY_GRADES, LifecycleApiError,
  type OwnedHerd, type HerdAnimal, type CarcassRecord, type CarcassFields,
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

function animalLabel(a: HerdAnimal): string {
  return a.animal_name || a.official_id || a.registration_number || `#${a.cow_id}`;
}

// -- the 8 carcass fields, shared shape for both the add form and edit rows --

function CarcassFieldGrid({
  values,
  onChange,
  disabled,
}: {
  values: CarcassFields;
  onChange: (patch: Partial<CarcassFields>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="grid gap-1.5">
        <Label className="text-xs">Hot carcass weight (lbs)</Label>
        <Input
          type="number" step="0.01" min="1" disabled={disabled}
          value={values.hotCarcassWeightLbs ?? ""}
          onChange={(e) => onChange({ hotCarcassWeightLbs: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">USDA quality grade</Label>
        <Select
          value={values.qualityGrade ?? ""}
          onValueChange={(v) => onChange({ qualityGrade: v })}
          disabled={disabled}
        >
          <SelectTrigger><SelectValue placeholder="Choose a grade" /></SelectTrigger>
          <SelectContent>
            {QUALITY_GRADES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">Yield grade (1.0-5.9)</Label>
        <Input
          type="number" step="0.1" min="1" max="5.9" disabled={disabled}
          value={values.yieldGrade ?? ""}
          onChange={(e) => onChange({ yieldGrade: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">Dressing %</Label>
        <Input
          type="number" step="0.01" min="0" max="100" disabled={disabled}
          value={values.dressingPct ?? ""}
          onChange={(e) => onChange({ dressingPct: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">Backfat (in)</Label>
        <Input
          type="number" step="0.01" min="0" max="10" disabled={disabled}
          value={values.backfatIn ?? ""}
          onChange={(e) => onChange({ backfatIn: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">Ribeye area (sq in)</Label>
        <Input
          type="number" step="0.01" min="0" max="50" disabled={disabled}
          value={values.ribeyeAreaSqin ?? ""}
          onChange={(e) => onChange({ ribeyeAreaSqin: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">Marbling score</Label>
        <Input
          disabled={disabled}
          placeholder="e.g. Sm50"
          value={values.marblingScore ?? ""}
          onChange={(e) => onChange({ marblingScore: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">Grid premium/discount ($)</Label>
        <Input
          type="number" step="0.01" disabled={disabled}
          value={values.gridPremiumDiscount ?? ""}
          onChange={(e) => onChange({ gridPremiumDiscount: e.target.value })}
        />
      </div>
    </div>
  );
}

// -- add-record form --

const EMPTY_FIELDS: CarcassFields = {};

function AddRecordForm({ herdId, animals, onAdded }: { herdId: string; animals: HerdAnimal[]; onAdded: () => void }) {
  const [animalId, setAnimalId] = useState("");
  const [fields, setFields] = useState<CarcassFields>(EMPTY_FIELDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!animalId) {
      setError("Choose which animal this record is for.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postCarcassRecord(herdId, { animalId, ...fields });
      setAnimalId("");
      setFields(EMPTY_FIELDS);
      onAdded();
    } catch (e) {
      setError(errMsg(e, "Could not save that record."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
      {error && <ErrorNote message={error} />}
      <div className="grid gap-1.5 md:max-w-sm">
        <Label className="text-xs">Animal</Label>
        {animals.length === 0 ? (
          <p className="text-sm text-muted-foreground">This herd has no registered animals yet.</p>
        ) : (
          <Select value={animalId} onValueChange={setAnimalId}>
            <SelectTrigger><SelectValue placeholder="Choose an animal" /></SelectTrigger>
            <SelectContent>
              {animals.map((a) => (
                <SelectItem key={a.cow_id} value={String(a.cow_id)}>{animalLabel(a)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <CarcassFieldGrid values={fields} onChange={(patch) => setFields((f) => ({ ...f, ...patch }))} disabled={busy} />
      <Button size="sm" onClick={submit} disabled={busy || animals.length === 0}>
        {busy ? "Saving..." : "Save carcass record"}
      </Button>
    </div>
  );
}

// -- one existing record, with inline edit/void --

function RecordCard({
  record,
  animals,
  onChanged,
}: {
  record: CarcassRecord;
  animals: HerdAnimal[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<CarcassFields>({
    hotCarcassWeightLbs: record.hotCarcassWeightLbs != null ? String(record.hotCarcassWeightLbs) : "",
    qualityGrade: record.qualityGrade ?? "",
    yieldGrade: record.yieldGrade != null ? String(record.yieldGrade) : "",
    dressingPct: record.dressingPct != null ? String(record.dressingPct) : "",
    backfatIn: record.backfatIn != null ? String(record.backfatIn) : "",
    ribeyeAreaSqin: record.ribeyeAreaSqin != null ? String(record.ribeyeAreaSqin) : "",
    marblingScore: record.marblingScore ?? "",
    gridPremiumDiscount: record.gridPremiumDiscount != null ? String(record.gridPremiumDiscount) : "",
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const animal = animals.find((a) => a.cow_id === record.animalId);
  const label = animal ? animalLabel(animal) : (record.officialId ?? `#${record.animalId}`);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await putCarcassRecord(record.recordId, { ...fields, reason: reason.trim() || undefined });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(errMsg(e, "Could not save that change."));
    } finally {
      setBusy(false);
    }
  }

  async function voidRecord() {
    setBusy(true);
    setError(null);
    try {
      await voidCarcassRecord(record.recordId, reason.trim() || undefined);
      onChanged();
    } catch (e) {
      setError(errMsg(e, "Could not void that record."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{label}</span>
          {record.qualityGrade && <Badge variant="outline">{record.qualityGrade}</Badge>}
          {record.status === "voided" && <Badge variant="destructive">Voided</Badge>}
          {record.verified && <Badge className="bg-emerald-100 text-emerald-800">Verified</Badge>}
        </div>
        <span className="text-xs text-muted-foreground">{record.createdBy ?? "?"} - {shortDateTime(record.createdAt)}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        {record.hotCarcassWeightLbs != null && <span>{record.hotCarcassWeightLbs} lbs HCW</span>}
        {record.yieldGrade != null && <span>Yield {record.yieldGrade}</span>}
        {record.dressingPct != null && <span>{record.dressingPct}% dressing</span>}
        {record.backfatIn != null && <span>{record.backfatIn}" backfat</span>}
        {record.ribeyeAreaSqin != null && <span>{record.ribeyeAreaSqin} sq in REA</span>}
        {record.marblingScore && <span>Marbling {record.marblingScore}</span>}
        {record.gridPremiumDiscount != null && <span>Grid {record.gridPremiumDiscount >= 0 ? "+" : ""}{record.gridPremiumDiscount}</span>}
      </div>
      {record.status === "voided" && record.voidReason && (
        <p className="mt-1 text-xs text-muted-foreground">Void reason: {record.voidReason}</p>
      )}

      {record.status === "active" && (
        <div className="mt-3 space-y-2">
          {error && <ErrorNote message={error} />}
          {editing ? (
            <>
              <CarcassFieldGrid values={fields} onChange={(patch) => setFields((f) => ({ ...f, ...patch }))} disabled={busy} />
              <div className="grid gap-1.5 md:max-w-sm">
                <Label className="text-xs">Reason (required once investors have bought in, or for an admin correction)</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
              <Button size="sm" variant="destructive" onClick={voidRecord} disabled={busy}>Void</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -- page --

export function CarcassEntry() {
  const { currentUser } = useAuth();
  const [herds, setHerds] = useState<OwnedHerd[] | null>(null);
  const [herdsError, setHerdsError] = useState<string | null>(null);
  const [herdId, setHerdId] = useState("");
  const [animals, setAnimals] = useState<HerdAnimal[]>([]);
  const [records, setRecords] = useState<CarcassRecord[] | null>(null);
  const [herdName, setHerdName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    getHerdsByOwner(currentUser.userId)
      .then((r) => setHerds(r.items))
      .catch((e) => setHerdsError(errMsg(e, "Could not load your herds.")));
  }, [currentUser]);

  function load(id: string) {
    setHerdId(id);
    setRecords(null);
    setAnimals([]);
    setLoadError(null);
    if (!id) return;
    Promise.all([getHerdAnimals(id), getHerdCarcass(id)])
      .then(([a, c]) => {
        setAnimals(a.items);
        setRecords(c.records);
        setHerdName(c.herd.herdName);
      })
      .catch((e) => setLoadError(errMsg(e, "Could not load this herd's carcass records.")));
  }

  const active = records?.filter((r) => r.status === "active") ?? [];
  const voided = records?.filter((r) => r.status === "voided") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/feedlot" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Carcass records</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Log what the packer reported for each animal - quality grade, yield grade, hot carcass weight, and grid
          detail. Record-keeping only right now; it does not change any payout.
        </p>
      </div>

      <Card className="rounded-3xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-primary/10 p-2 text-primary"><ClipboardList className="h-4 w-4" /></div>
            <div>
              <CardTitle className="text-base">Choose a herd</CardTitle>
              <CardDescription>Only herds you own are listed.</CardDescription>
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

          {herdId && records === null && !loadError && <Skeleton className="h-24 w-full" />}
          {loadError && <ErrorNote message={loadError} />}
        </CardContent>
      </Card>

      {herdId && records !== null && (
        <>
          <Card className="rounded-3xl">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-primary/10 p-2 text-primary"><PlusCircle className="h-4 w-4" /></div>
                <div>
                  <CardTitle className="text-base">Add a record</CardTitle>
                  <CardDescription>{herdName} - pick the animal this carcass sheet is for.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <AddRecordForm herdId={herdId} animals={animals} onAdded={() => load(herdId)} />
            </CardContent>
          </Card>

          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle className="text-base">Existing records ({active.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {active.length === 0 ? (
                <p className="text-sm text-muted-foreground">No carcass records logged for this herd yet.</p>
              ) : (
                active.map((r) => <RecordCard key={r.recordId} record={r} animals={animals} onChanged={() => load(herdId)} />)
              )}
              {voided.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Voided ({voided.length})</summary>
                  <div className="mt-2 space-y-2">
                    {voided.map((r) => <RecordCard key={r.recordId} record={r} animals={animals} onChanged={() => load(herdId)} />)}
                  </div>
                </details>
              )}
            </CardContent>
          </Card>
          <Separator />
        </>
      )}
    </div>
  );
}

export default CarcassEntry;
