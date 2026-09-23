// Rancher-facing herd stage transitions, and feedlot/packer carcass grade
// entry (plan step 9 remainder frontend). Same fetch/auth pattern as
// herdOps.ts and feeSetup.ts - kept in its own file so api.ts stays as it is.
// Every call sends the login token; the server works out who is asking (and
// whether they own the herd) from the token.
import { getAuthToken } from "@/context/AuthContext";

const API_BASE = "/api";

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class LifecycleApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new LifecycleApiError(res.status, await readError(res));
  return res.json() as Promise<T>;
}

async function sendJSON<T>(path: string, method: "POST" | "PUT", body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new LifecycleApiError(res.status, await readError(res));
  return res.json() as Promise<T>;
}

// ---- herds owned by the logged-in rancher/feedlot --------------------------
// GET /api/herds is a public listing route (no auth on it), filtered here by
// the caller's own userId so each person only sees their own herds.

export type OwnedHerd = {
  herd_id: string;
  herd_name: string;
  head_count: number | null;
  dominant_stage: string;
  purchase_status: string;
  feedlot_status: string | null;
  cattle_count: number;
  // C4: not requested from the server specially - GET /api/herds already
  // returns this, it just wasn't in this type yet - used to tell apart two
  // herds with the same name in the Herd Stages dropdown.
  created_at?: string;
};

export const getHerdsByOwner = (rancherId: string) =>
  getJSON<{ count: number; items: OwnedHerd[] }>(`/herds?rancherId=${encodeURIComponent(rancherId)}&limit=200`);

export type HerdAnimal = {
  cow_id: number;
  official_id: string | null;
  animal_name: string | null;
  registration_number: string;
  breed_code: string;
  sex_code: string;
};

export const getHerdAnimals = (herdId: string) =>
  getJSON<{ count: number; items: HerdAnimal[] }>(`/herds/${herdId}/cattle?limit=200`);

// ---- stage transitions -------------------------------------------------------

export const STAGES = ["RANCH", "BACKGROUNDING", "FEEDLOT", "PROCESSING", "DISTRIBUTION"] as const;
export type Stage = (typeof STAGES)[number];

export type StageEntry = {
  historyId: string;
  herdId: string;
  fromStage: string | null;
  toStage: string;
  changedBy: string | null;
  changedAt: string;
  note: string | null;
  isCorrection: boolean;
};

export type StageHistoryResult = {
  herd: { herdId: string; herdName: string; dominantStage: string };
  stages: string[];
  history: StageEntry[];
};

export const getStageHistory = (herdId: string) => getJSON<StageHistoryResult>(`/herds/${herdId}/stage-history`);

export const postStageChange = (herdId: string, body: { stage: string; note?: string }) =>
  sendJSON<{ message: string; herdId: string; dominantStage: string; entry: StageEntry }>(
    `/herds/${herdId}/stage`,
    "POST",
    { stage: body.stage, note: body.note || undefined }
  );

// The one next stage a herd's own owner may move it to (no skipping). Admin
// corrections (any stage, any direction) aren't offered from this screen.
export function nextStage(current: string): Stage | null {
  const idx = STAGES.indexOf(current as Stage);
  if (idx < 0 || idx === STAGES.length - 1) return null;
  return STAGES[idx + 1];
}

// ---- carcass records ----------------------------------------------------------

export const QUALITY_GRADES = ["Prime", "Choice", "Select", "Standard", "Utility", "Commercial", "Cutter", "Canner"] as const;

export type CarcassRecord = {
  recordId: string;
  herdId: string;
  animalId: number;
  officialId: string | null;
  saleId: string | null;
  hotCarcassWeightLbs: number | null;
  qualityGrade: string | null;
  yieldGrade: number | null;
  dressingPct: number | null;
  backfatIn: number | null;
  ribeyeAreaSqin: number | null;
  marblingScore: string | null;
  gridPremiumDiscount: number | null;
  source: string;
  status: "active" | "voided";
  verified: boolean;
  createdBy: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
};

// Form-string versions of the same optional numeric/text fields, shared by
// the create and edit forms. "" is sent through as null (clears the field).
export type CarcassFields = {
  hotCarcassWeightLbs?: string;
  qualityGrade?: string;
  yieldGrade?: string;
  dressingPct?: string;
  backfatIn?: string;
  ribeyeAreaSqin?: string;
  marblingScore?: string;
  gridPremiumDiscount?: string;
};

const TEXT_CARCASS_FIELDS = new Set(["qualityGrade", "marblingScore"]);

function cleanFields(f: CarcassFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined) continue;
    if (v === "") { out[k] = null; continue; }
    out[k] = TEXT_CARCASS_FIELDS.has(k) ? v : Number(v);
  }
  return out;
}

export const getHerdCarcass = (herdId: string) =>
  getJSON<{ herd: { herdId: string; herdName: string }; note: string; records: CarcassRecord[] }>(
    `/carcass/herds/${herdId}`
  );

export const postCarcassRecord = (
  herdId: string,
  body: { animalId?: string; officialId?: string } & CarcassFields
) =>
  sendJSON<{ message: string; record: CarcassRecord }>(`/carcass/herds/${herdId}`, "POST", {
    animalId: body.animalId || undefined,
    officialId: body.officialId || undefined,
    ...cleanFields(body),
  });

export const putCarcassRecord = (
  recordId: string,
  body: CarcassFields & { reason?: string; verified?: boolean }
) =>
  sendJSON<{ message: string; record: CarcassRecord }>(`/carcass/records/${recordId}`, "PUT", {
    ...cleanFields(body),
    reason: body.reason || undefined,
    verified: body.verified,
  });

export const voidCarcassRecord = (recordId: string, reason?: string) =>
  sendJSON<{ message: string; record: CarcassRecord }>(`/carcass/records/${recordId}/void`, "POST", {
    reason: reason || undefined,
  });
