// Admin herd operations: costs, LRP records, and sale approval/settlement.
// Same pattern as feeSetup.ts and money.ts - kept in its own file so api.ts
// stays as it is. Every call sends the login token; the server works out who
// is asking (and whether they're an admin) from the token.
import { getAuthToken } from "@/context/AuthContext";

const API_BASE = "/api";

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class OpsApiError extends Error {
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
  if (!res.ok) throw new OpsApiError(res.status, await readError(res));
  return res.json() as Promise<T>;
}

async function sendJSON<T>(path: string, method: "PUT" | "POST" | "PATCH", body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new OpsApiError(res.status, await readError(res));
  return res.json() as Promise<T>;
}

// ---- costs --------------------------------------------------------------------

export const MANUAL_CATEGORIES = ["feed", "yardage", "vet", "death_loss_reserve", "other"] as const;
export type ManualCategory = (typeof MANUAL_CATEGORIES)[number];

export type Expense = {
  expenseId: string;
  herdId: string;
  category: string;
  description: string | null;
  amount: number;
  accruedDate: string;
  billingDirection: "self" | "service";
  source: string;
  status: "active" | "voided";
  lrpPolicyId: string | null;
  createdBy: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  canChange?: boolean;
  changeNeedsReason?: boolean;
};

export type HerdCostsAdmin = {
  herd: { herdId: string; herdName: string; investorsHaveBought: boolean; saleState: string | null };
  viewer: "admin" | "owner" | "investor";
  total: number;
  byCategory: Record<string, number>;
  expenses: Expense[];
};

export const getHerdCosts = (herdId: string) => getJSON<HerdCostsAdmin>(`/expenses/herds/${herdId}`);

export const patchExpense = (
  expenseId: string,
  body: { category?: string; amount?: string; description?: string; accruedDate?: string; reason?: string }
) =>
  sendJSON<{ message: string; expense: Expense }>(`/expenses/${expenseId}`, "PATCH", {
    category: body.category || undefined,
    amount: body.amount ? Number(body.amount) : undefined,
    description: body.description,
    accruedDate: body.accruedDate || undefined,
    reason: body.reason || undefined,
  });

export const voidExpense = (expenseId: string, reason: string) =>
  sendJSON<{ message: string; expense: Expense }>(`/expenses/${expenseId}/void`, "POST", { reason });

// ---- LRP ------------------------------------------------------------------------

export const ENDORSEMENTS = ["feeder_cattle", "fed_cattle", "other"] as const;
export type Endorsement = (typeof ENDORSEMENTS)[number];

export type LrpPolicy = {
  policyId: string;
  herdId: string;
  policyNumber: string | null;
  endorsementType: string;
  coverageLevelPct: number | null;
  floorPriceCwt: number | null;
  premiumAmount: number | null;
  effectiveDate: string | null;
  endDate: string | null;
  agentVerified: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export const getHerdLrp = (herdId: string) =>
  getJSON<{ herd: { herdId: string; herdName: string }; note: string; policies: LrpPolicy[] }>(`/lrp/herds/${herdId}`);

export const putLrpPolicy = (
  policyId: string,
  body: {
    policyNumber?: string; endorsementType?: string; coverageLevelPct?: string; floorPriceCwt?: string;
    premiumAmount?: string; effectiveDate?: string; endDate?: string; agentVerified?: boolean; reason: string;
  }
) =>
  sendJSON<{ message: string; policy: LrpPolicy }>(`/lrp/policies/${policyId}`, "PUT", {
    policyNumber: body.policyNumber,
    endorsementType: body.endorsementType || undefined,
    coverageLevelPct: body.coverageLevelPct === "" ? undefined : body.coverageLevelPct,
    floorPriceCwt: body.floorPriceCwt === "" ? undefined : body.floorPriceCwt,
    premiumAmount: body.premiumAmount === "" ? undefined : body.premiumAmount,
    effectiveDate: body.effectiveDate || undefined,
    endDate: body.endDate || undefined,
    agentVerified: body.agentVerified,
    reason: body.reason,
  });

// ---- sales / settlement -----------------------------------------------------------

export type SaleStatus = "pending_approval" | "approved" | "rejected" | "cancelled";

export type Sale = {
  saleId: string;
  herdId: string;
  herdName: string | null;
  sellerUserId: string;
  sellerSlug: string | null;
  buyerUserId: string | null;
  buyerSlug: string | null;
  buyerName: string | null;
  grossAmount: number;
  lrpIndemnity: number;
  lrpNote: string | null;
  proceedsTotal: number;
  headSold: number | null;
  headLost: number | null;
  liveWeightLbs: number | null;
  pricePerCwt: number | null;
  saleDate: string;
  status: SaleStatus;
  expensesTotal: number | null;
  netAmount: number | null;
  platformFeesTotal: number | null;
  feeTerms: unknown;
  submittedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  buyerResponse: string;
  buyerRespondedAt: string | null;
  buyerResponseNote: string | null;
  newHerdId: string | null;
  warnings: string[];
};

export type SettlementPayoutPreview = {
  recipientType: string;
  userId: string;
  slug: string | null;
  tokens: number;
  sharePct: number | null;
  amount: number;
};

export type SettlementBreakdown = {
  grossAmount: number;
  salePrice: number;
  lrpIndemnity: number;
  selfBilledExpenses: number;
  serviceBilledExpenses: number;
  expensesTotal: number;
  netAmount: number;
  profit: number;
  investorCapitalReturned: number;
  totalSupply: number | string;
  investorTokens: number | string;
  feeTermsApplied: boolean;
  platformFeesTotal: number;
  warnings: string[];
  payouts: SettlementPayoutPreview[];
};

export type SalePayout = {
  payoutId: string;
  userId: string;
  slug: string;
  recipientType: string;
  tokens: number;
  sharePct: number | null;
  grossBeforeFees: number | null;
  feeAmount: number;
  costBasis: number | null;
  amount: number;
  status: "owed" | "paid";
  paidAt: string | null;
  paymentReference: string | null;
};

export type SaleCorrection = {
  action: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedBy: string | null;
  at: string;
};

export type SaleDetail = {
  sale: Sale;
  preview?: SettlementBreakdown;
  payouts?: SalePayout[];
  corrections?: SaleCorrection[];
};

export type StatementLine = {
  recipientType: string;
  userId: string;
  slug: string | null;
  tokens: number;
  sharePct: number | null;
  grossBeforeFees: number | null;
  capitalReturned: number | null;
  profitShare: number | null;
  feeAmount: number;
  amount: number;
  status: string;
  paidAt: string | null;
  paymentReference: string | null;
  costBasis?: number | null;
  costBasisEstimated?: boolean;
  profit?: number | null;
  returnPct?: number | null;
};

export type FullStatement = {
  view: "full";
  statementStatus: "preview" | "final";
  sale: Sale;
  proceeds: { salePrice: number; lrpIndemnity: number; total: number };
  load: {
    headSold: number | null; headLost: number | null; liveWeightLbs: number | null;
    pricePerCwt: number | null; avgWeightPerHead: number | null; pricePerHead: number | null;
  };
  costs: { total: number; selfBilled: number; serviceBilled: number; byCategory: { category: string; amount: number }[] };
  netAmount: number;
  profit: number;
  platformFeesTotal: number;
  warnings: string[];
  payouts: StatementLine[];
  payoutsTotal: number;
  feeTerms: unknown;
};

export const getSales = (status?: SaleStatus) => getJSON<Sale[]>(`/settlement/sales${status ? `?status=${status}` : ""}`);
export const getSaleDetail = (saleId: string) => getJSON<SaleDetail>(`/settlement/sales/${saleId}`);
export const getSaleStatement = (saleId: string) => getJSON<FullStatement>(`/settlement/sales/${saleId}/statement`);

export const approveSale = (saleId: string, note?: string) =>
  sendJSON<{ message: string; sale: Sale }>(`/settlement/sales/${saleId}/approve`, "POST", { note: note || undefined });

export const rejectSale = (saleId: string, note?: string) =>
  sendJSON<{ message: string; sale: Sale }>(`/settlement/sales/${saleId}/reject`, "POST", { note: note || undefined });

export const correctSale = (
  saleId: string,
  body: { reason: string; lrpIndemnity?: string; lrpNote?: string; headLost?: string }
) =>
  sendJSON<{ message: string; sale: Sale; preview: SettlementBreakdown }>(`/settlement/sales/${saleId}/correct`, "POST", {
    reason: body.reason,
    lrpIndemnity: body.lrpIndemnity === "" || body.lrpIndemnity === undefined ? undefined : Number(body.lrpIndemnity),
    lrpNote: body.lrpNote,
    headLost: body.headLost === "" || body.headLost === undefined ? undefined : Number(body.headLost),
  });

export const markPayoutPaid = (payoutId: string, paymentReference: string) =>
  sendJSON<{ message: string }>(`/settlement/payouts/${payoutId}/mark-paid`, "POST", { paymentReference });

// ---- formatting ---------------------------------------------------------------

export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function categoryLabel(c: string): string {
  return c.replace(/_/g, " ").replace(/^\w/, (ch) => ch.toUpperCase());
}
