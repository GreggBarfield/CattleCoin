// Admin fee setup: platform defaults, per-herd terms, per-investor overrides,
// the audit log, and platform revenue. Kept in its own file, same pattern as
// money.ts, so api.ts stays as it is. Every call sends the login token; the
// server works out who is asking (and whether they're an admin) from the
// token, never from anything typed in the browser.
import { getAuthToken } from "@/context/AuthContext";

const API_BASE = "/api";

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class FeeApiError extends Error {
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
  if (!res.ok) throw new FeeApiError(res.status, await readError(res));
  return res.json() as Promise<T>;
}

async function sendJSON<T>(path: string, method: "PUT" | "POST" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new FeeApiError(res.status, await readError(res));
  return res.json() as Promise<T>;
}

// ---- types ------------------------------------------------------------------

export type ExitFeePayer = "investor" | "producer";
export type PerHeadFeeTiming = "raise" | "exit";

export const MAX_FEE_PCT = 25;
export const MAX_PER_HEAD_FEE = 500;

export type FeeTerms = {
  raiseFeePct: number;
  exitProfitFeePct: number;
  exitFeePayer: ExitFeePayer;
  perHeadFee: number;
  perHeadFeeTiming: PerHeadFeeTiming;
  note: string | null;
  lockedAt: string | null;
  updatedAt: string | null;
};

/** A blank editable draft, shaped like FeeTerms but with string inputs (for controlled form fields). */
export type FeeTermsDraft = {
  raiseFeePct: string;
  exitProfitFeePct: string;
  exitFeePayer: ExitFeePayer;
  perHeadFee: string;
  perHeadFeeTiming: PerHeadFeeTiming;
  note: string;
};

export function termsToDraft(t: FeeTerms): FeeTermsDraft {
  return {
    raiseFeePct: String(t.raiseFeePct),
    exitProfitFeePct: String(t.exitProfitFeePct),
    exitFeePayer: t.exitFeePayer,
    perHeadFee: String(t.perHeadFee),
    perHeadFeeTiming: t.perHeadFeeTiming,
    note: t.note ?? "",
  };
}

export type HerdFundsPosition = {
  raised: number;
  released: number;
  available: number;
  paymentCount: number;
  releaseCount: number;
};

export type InvestorOverride = {
  overrideId: string;
  investorSlug: string;
  herdId: string | null;
  herdName?: string | null;
  appliesTo: "this herd" | "one herd" | "all herds";
  exitProfitFeePct: number;
  note: string | null;
  updatedAt?: string;
};

export type HerdFeeDetail = {
  herdId: string;
  herdName: string;
  headCount: number | null;
  termsSet: boolean;
  locked: boolean;
  terms: FeeTerms | null;
  defaultsThatWouldApply?: FeeTerms;
  investorOverrides?: InvestorOverride[];
  funds?: HerdFundsPosition;
};

export type HerdListItem = {
  herd_id: string;
  herd_name: string;
  head_count: number | null;
  purchase_status: string;
  feedlot_status: string | null;
};

export type HerdRelease = {
  releaseId: string;
  herdId: string;
  herdName: string | null;
  producerSlug: string | null;
  grossAmount: number;
  raiseFeePct: number;
  raiseFee: number;
  perHeadFee: number;
  netToProducer: number;
  status: "owed" | "paid";
  note: string | null;
  releasedAt: string;
  paidAt: string | null;
  paymentReference: string | null;
};

export type HerdFundsDetail = {
  herdId: string;
  herdName: string;
  funds: HerdFundsPosition;
  feeTermsSet: boolean;
  terms: FeeTerms | null;
  releases: HerdRelease[];
  payments?: {
    paymentId: string;
    investorSlug: string;
    tokens: number;
    amount: number;
    stripePaymentIntentId: string | null;
    paidAt: string;
  }[];
};

export type FeeAuditEntry = {
  auditId: string;
  action: string;
  herdId: string | null;
  investorSlug: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  changedBy: string | null;
  changedAt: string;
};

export type FeeRevenueRow = {
  herdId: string;
  herdName: string;
  raiseFees: number;
  perHeadFeesAtRaise: number;
  exitFees: number;
  total: number;
};

export type FeeRevenue = {
  totals: { raiseFees: number; perHeadFeesAtRaise: number; exitFees: number; total: number };
  herds: FeeRevenueRow[];
  note: string;
};

export type UserSummary = { userId: string; slug: string; role: string; email: string };

// ---- calls --------------------------------------------------------------------

export const getFeeDefaults = () => getJSON<{ defaults: FeeTerms }>("/fees/defaults");
export const putFeeDefaults = (body: Partial<Record<keyof FeeTermsDraft, string>>) =>
  sendJSON<{ message: string; defaults: FeeTerms }>("/fees/defaults", "PUT", numericBody(body));

export const getHerds = () => getJSON<{ count: number; items: HerdListItem[] }>("/herds?limit=200");

export const getHerdFees = (herdId: string) => getJSON<HerdFeeDetail>(`/fees/herds/${herdId}`);
export const putHerdFees = (herdId: string, body: Partial<Record<keyof FeeTermsDraft, string>>) =>
  sendJSON<{ message: string; terms: FeeTerms }>(`/fees/herds/${herdId}`, "PUT", numericBody(body));

export const getInvestorOverrides = (params?: { investorSlug?: string; herdId?: string }) => {
  const q = new URLSearchParams();
  if (params?.investorSlug) q.set("investorSlug", params.investorSlug);
  if (params?.herdId) q.set("herdId", params.herdId);
  const qs = q.toString();
  return getJSON<InvestorOverride[]>(`/fees/investor-overrides${qs ? `?${qs}` : ""}`);
};

export const putInvestorOverride = (body: { investorSlug: string; herdId?: string | null; exitProfitFeePct: string; note?: string }) =>
  sendJSON<{ message: string; override: InvestorOverride }>("/fees/investor-overrides", "PUT", {
    investorSlug: body.investorSlug,
    herdId: body.herdId || undefined,
    exitProfitFeePct: Number(body.exitProfitFeePct),
    note: body.note,
  });

export const deleteInvestorOverride = (overrideId: string) =>
  sendJSON<{ message: string }>(`/fees/investor-overrides/${overrideId}`, "DELETE");

export const getFeeAudit = (herdId?: string) => getJSON<FeeAuditEntry[]>(`/fees/audit${herdId ? `?herdId=${herdId}` : ""}`);

export const getFeeRevenue = () => getJSON<FeeRevenue>("/fees/revenue");

export const getHerdFunds = (herdId: string) => getJSON<HerdFundsDetail>(`/funds/herds/${herdId}`);

export const postReleaseFunds = (herdId: string, body: { amount?: string; note?: string }) =>
  sendJSON<{ message: string; release: HerdRelease; funds: HerdFundsPosition; warnings: string[] }>(
    `/funds/herds/${herdId}/release`,
    "POST",
    { amount: body.amount ? Number(body.amount) : undefined, note: body.note || undefined }
  );

export const postMarkReleasePaid = (releaseId: string, paymentReference: string) =>
  sendJSON<{ message: string; release: HerdRelease }>(`/funds/releases/${releaseId}/mark-paid`, "POST", { paymentReference });

export const getInvestors = () => getJSON<UserSummary[]>("/users?role=investor");

// A draft form only sends the fields the numeric parser can use; blank
// strings are dropped so the backend keeps whatever value was already there.
function numericBody(body: Partial<Record<keyof FeeTermsDraft, string>>) {
  const out: Record<string, unknown> = {};
  if (body.raiseFeePct !== undefined && body.raiseFeePct !== "") out.raiseFeePct = Number(body.raiseFeePct);
  if (body.exitProfitFeePct !== undefined && body.exitProfitFeePct !== "") out.exitProfitFeePct = Number(body.exitProfitFeePct);
  if (body.perHeadFee !== undefined && body.perHeadFee !== "") out.perHeadFee = Number(body.perHeadFee);
  if (body.perHeadFeeTiming !== undefined) out.perHeadFeeTiming = body.perHeadFeeTiming;
  if (body.exitFeePayer !== undefined) out.exitFeePayer = body.exitFeePayer;
  if (body.note !== undefined) out.note = body.note;
  return out;
}

// ---- formatting ---------------------------------------------------------------

export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${value}%`;
}

export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
