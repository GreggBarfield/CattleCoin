// Investor money: what an investor paid in, what each herd has cost, and the
// settlement statement for a sale. Kept in its own file so the older api.ts
// stays as it was. Every call sends the login token; the server works out who
// is asking from the token, never from anything typed in the browser.
import { getAuthToken } from "@/context/AuthContext";

const API_BASE = "/api";

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class MoneyApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    let msg = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* keep the default message */
    }
    throw new MoneyApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

// ---- types ----------------------------------------------------------------

export type HerdState = "open" | "sale_pending" | "sold" | "closed";

export type MoneyPayout = {
  payoutId: string;
  saleId: string;
  amount: number;
  capitalReturned: number;
  profitShare: number | null;
  exitFee: number;
  status: "owed" | "paid";
  paidAt: string | null;
  paymentReference: string | null;
  profit: number | null;
};

export type MoneyHerd = {
  herdId: string;
  herdName: string;
  producerType: "cow-calf" | "feeder";
  state: HerdState;
  headCount: number | null;
  tokens: number;
  totalSupply: number | null;
  sharePct: number | null;
  paidIn: number;
  estimatedExtra: number | null;
  unrecordedTokens: number;
  payments: { paymentId: string; paidAt: string; tokens: number; amount: number }[];
  costsTotal: number;
  sale: { saleId: string; status: "pending_approval" | "approved"; saleDate: string } | null;
  payout: MoneyPayout | null;
};

export type MyMoney = {
  asOfIso: string;
  totals: {
    paidIn: number;
    estimatedExtra: number;
    stillInvested: number;
    receivedFromSales: number;
    owedFromSales: number;
  };
  herds: MoneyHerd[];
};

export type StatementLine = {
  recipientType: string;
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
  costBasis: number | null;
  costBasisEstimated: boolean;
  profit: number | null;
  returnPct: number | null;
};

export type Statement = {
  view: "full" | "investor";
  statementStatus: "preview" | "final";
  sale: {
    saleId: string;
    herdId: string;
    herdName: string;
    status: string;
    saleDate: string;
    buyerName?: string | null;
    buyerSlug?: string | null;
    headSold: number | null;
    headLost: number | null;
    liveWeightLbs: number | null;
    pricePerCwt: number | null;
  };
  proceeds: { salePrice: number; lrpIndemnity: number; total: number };
  load: {
    headSold: number | null;
    headLost: number | null;
    liveWeightLbs: number | null;
    pricePerCwt: number | null;
    avgWeightPerHead: number | null;
    pricePerHead: number | null;
  };
  costs: {
    total: number;
    selfBilled: number;
    serviceBilled: number;
    byCategory: { category: string; amount: number }[];
  };
  netAmount: number;
  profit: number;
  platformFeesTotal: number;
  warnings: string[];
  you?: StatementLine | null;
};

export type HerdExpense = {
  expenseId: string;
  category: string;
  description: string | null;
  amount: number;
  accruedDate: string;
  billingDirection: "self" | "service";
  source: string;
  status: "active" | "voided";
};

export type HerdCosts = {
  total: number;
  byCategory: Record<string, number>;
  expenses: HerdExpense[];
};

export type HerdLrpPolicy = {
  policyId: string;
  policyNumber: string | null;
  endorsementType: string;
  coverageLevelPct: number | null;
  floorPriceCwt: number | null;
  premiumAmount: number | null;
  effectiveDate: string | null;
  endDate: string | null;
  agentVerified: boolean;
};

// ---- calls ----------------------------------------------------------------

export const getMyMoney = () => getJSON<MyMoney>("/my-money");
export const getStatement = (saleId: string) => getJSON<Statement>(`/settlement/sales/${saleId}/statement`);
export const getHerdCosts = (herdId: string) => getJSON<HerdCosts>(`/expenses/herds/${herdId}`);
export const getHerdLrp = (herdId: string) =>
  getJSON<{ policies: HerdLrpPolicy[] }>(`/lrp/herds/${herdId}`);

// ---- formatting -------------------------------------------------------------

/** Dollars and cents, e.g. $39,537.00 (the older formatUsd rounds to whole dollars). */
export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  // a plain date (2026-09-20) has no time zone; read it as that calendar day, not as UTC midnight
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = plain ? new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** A plain-English name for a cost category. */
export const COST_LABELS: Record<string, string> = {
  feed: "Feed",
  yardage: "Yardage",
  vet: "Vet and health",
  death_loss_reserve: "Death-loss reserve",
  lrp_premium: "LRP price-protection premium",
  purchase: "What the cattle cost to buy",
  herd_value: "Starting value of the herd",
  other: "Other",
};

export function costLabel(category: string): string {
  return COST_LABELS[category] ?? category;
}

export const STATE_LABELS: Record<HerdState, string> = {
  open: "Open to investors",
  sale_pending: "Sale pending approval",
  sold: "Sold",
  closed: "Closed",
};
