// Rancher "My Herds" pass 2 (punch list #3): a herd's costs, LRP records, the
// sale, and the rancher's payouts. Same fetch/auth pattern as rancherHerds.ts.
// The shapes returned by the server are the ones herdOps.ts already describes
// (the admin screens read the same routes), so those types are reused here.
// Every call sends the login token; the server decides what this rancher may
// see and change (owner of the herd, before or after investors bought in, sale
// pending or approved) and says why in its error message when it refuses.
import { getAuthToken } from "@/context/AuthContext";
import type { Expense, HerdCostsAdmin, LrpPolicy, Sale, SaleDetail, SettlementBreakdown } from "@/lib/herdOps";

export type { Expense, LrpPolicy, Sale, SaleDetail, SettlementBreakdown };
export type HerdCosts = HerdCostsAdmin;

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
  if (!res.ok) throw new MoneyApiError(res.status, await readError(res));
  return res.json() as Promise<T>;
}

async function sendJSON<T>(path: string, method: "POST" | "PUT" | "PATCH", body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new MoneyApiError(res.status, await readError(res));
  return res.json() as Promise<T>;
}

// Drops keys whose value is undefined so only what the rancher filled in is sent.
function compact(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

// ---- costs -------------------------------------------------------------------

export const COST_CATEGORIES = ["feed", "yardage", "vet", "death_loss_reserve", "other"] as const;

export const CATEGORY_LABEL: Record<string, string> = {
  feed: "Feed",
  yardage: "Yardage",
  vet: "Vet / health",
  death_loss_reserve: "Death loss reserve",
  other: "Other",
  lrp_premium: "LRP premium",
  purchase: "Purchase price",
  herd_value: "Herd starting value",
};

export const SOURCE_LABEL: Record<string, string> = {
  manual: "Added by you",
  value: "Booked when opened to investors",
  lrp: "From the LRP record",
  purchase: "Booked when the herd was bought",
};

export const getCosts = (herdId: string) => getJSON<HerdCosts>(`/expenses/herds/${herdId}`);

export type CostInput = { category: string; amount: string; description: string; accruedDate: string };

export const postCost = (herdId: string, c: CostInput) =>
  sendJSON<{ message: string; expense: Expense }>(`/expenses/herds/${herdId}`, "POST", compact({
    category: c.category,
    amount: Number(c.amount),
    description: c.description.trim() || undefined,
    accruedDate: c.accruedDate || undefined,
  }));

// Only the fields that changed are sent.
export const patchCost = (expenseId: string, changes: Partial<CostInput>) =>
  sendJSON<{ message: string; expense: Expense }>(`/expenses/${expenseId}`, "PATCH", compact({
    category: changes.category,
    amount: changes.amount !== undefined ? Number(changes.amount) : undefined,
    description: changes.description,
    accruedDate: changes.accruedDate,
  }));

export const voidCost = (expenseId: string, reason: string) =>
  sendJSON<{ message: string; expense: Expense }>(`/expenses/${expenseId}/void`, "POST", compact({
    reason: reason.trim() || undefined,
  }));

export function checkCost(c: CostInput): string | null {
  if (!COST_CATEGORIES.includes(c.category as (typeof COST_CATEGORIES)[number])) return "Choose a kind of cost.";
  return checkMoney(c.amount, "Amount", { allowZero: false });
}

// ---- LRP records -------------------------------------------------------------

export const ENDORSEMENT_LABEL: Record<string, string> = {
  feeder_cattle: "Feeder cattle",
  fed_cattle: "Fed cattle",
  other: "Other",
};

export const getLrp = (herdId: string) =>
  getJSON<{ herd: { herdId: string; herdName: string }; note: string; policies: LrpPolicy[] }>(`/lrp/herds/${herdId}`);

export type LrpInput = {
  policyNumber: string;
  endorsementType: string;
  coverageLevelPct: string;
  floorPriceCwt: string;
  premiumAmount: string;
  effectiveDate: string;
  endDate: string;
};

export const EMPTY_LRP: LrpInput = {
  policyNumber: "", endorsementType: "feeder_cattle", coverageLevelPct: "", floorPriceCwt: "",
  premiumAmount: "", effectiveDate: "", endDate: "",
};

export function lrpToInput(p: LrpPolicy): LrpInput {
  const s = (v: number | string | null) => (v === null || v === undefined ? "" : String(v));
  return {
    policyNumber: s(p.policyNumber), endorsementType: p.endorsementType || "other",
    coverageLevelPct: s(p.coverageLevelPct), floorPriceCwt: s(p.floorPriceCwt), premiumAmount: s(p.premiumAmount),
    effectiveDate: s(p.effectiveDate), endDate: s(p.endDate),
  };
}

// New record: only the fields filled in. Blank means "not known yet".
export const postLrp = (herdId: string, f: LrpInput) =>
  sendJSON<{ message: string; policy: LrpPolicy }>(`/lrp/herds/${herdId}`, "POST", compact({
    policyNumber: f.policyNumber.trim() || undefined,
    endorsementType: f.endorsementType || undefined,
    coverageLevelPct: f.coverageLevelPct.trim() || undefined,
    floorPriceCwt: f.floorPriceCwt.trim() || undefined,
    premiumAmount: f.premiumAmount.trim() || undefined,
    effectiveDate: f.effectiveDate || undefined,
    endDate: f.endDate || undefined,
  }));

// Changed record: only the fields that differ from what is on file. A field
// emptied by the rancher is sent as "" so the server clears it.
export function lrpChanges(before: LrpInput, after: LrpInput): Partial<LrpInput> {
  const out: Partial<LrpInput> = {};
  for (const k of Object.keys(after) as (keyof LrpInput)[]) {
    if (after[k].trim() !== before[k].trim()) out[k] = after[k].trim();
  }
  return out;
}

export const putLrp = (policyId: string, changes: Partial<LrpInput>) =>
  sendJSON<{ message: string; policy: LrpPolicy }>(`/lrp/policies/${policyId}`, "PUT", changes);

export function checkLrp(f: LrpInput): string | null {
  const filled = Object.entries(f).some(([k, v]) => k !== "endorsementType" && v.trim() !== "");
  if (!filled) return "Fill in at least one detail of the policy (for example the policy number or the floor price).";
  if (f.coverageLevelPct.trim()) {
    const n = Number(f.coverageLevelPct);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return "Coverage level must be more than 0 and at most 100 (%).";
  }
  const floor = checkMoney(f.floorPriceCwt, "Floor price", { allowZero: true, optional: true });
  if (floor) return floor;
  const prem = checkMoney(f.premiumAmount, "Premium", { allowZero: true, optional: true });
  if (prem) return prem;
  if (f.effectiveDate && f.endDate && f.endDate < f.effectiveDate) return "The end date can't be before the start date.";
  return null;
}

// ---- the sale ----------------------------------------------------------------

export const getMySales = () => getJSON<Sale[]>("/settlement/sales");
export const getSale = (saleId: string) => getJSON<SaleDetail>(`/settlement/sales/${saleId}`);
export const cancelSale = (saleId: string) =>
  sendJSON<{ message: string; sale: Sale }>(`/settlement/sales/${saleId}/cancel`, "POST");

export type FeedlotOption = { userId: string; slug: string };
// CattleCoin feedlot accounts a herd can be sold to (the buyer then accepts it on the platform).
export const getFeedlots = () =>
  getJSON<{ userId: string; slug: string; role: string }[]>("/users?role=feedlot").then((rows) =>
    rows.filter((r) => r.slug).map((r) => ({ userId: r.userId, slug: r.slug }))
  );

export type SaleInput = {
  buyerKind: "outside" | "platform";
  buyerName: string;
  buyerSlug: string;
  priceKind: "load" | "total";
  headSold: string;
  headLost: string;
  liveWeightLbs: string;
  pricePerCwt: string;
  grossAmount: string;
  lrpIndemnity: string;
  lrpNote: string;
  saleDate: string;
};

export const EMPTY_SALE: SaleInput = {
  buyerKind: "outside", buyerName: "", buyerSlug: "", priceKind: "load",
  headSold: "", headLost: "", liveWeightLbs: "", pricePerCwt: "", grossAmount: "",
  lrpIndemnity: "", lrpNote: "", saleDate: "",
};

// Sale price in cents from the load: weight (lb) x price ($/cwt) / 100,
// rounded to the cent - the same whole-number math the server does.
export function loadPriceCents(liveWeightLbs: string, pricePerCwt: string): number | null {
  const w = Number(liveWeightLbs);
  const p = Number(pricePerCwt);
  if (!liveWeightLbs.trim() || !pricePerCwt.trim() || !Number.isFinite(w) || !Number.isFinite(p) || w <= 0 || p < 0) return null;
  const cents = (BigInt(Math.round(w * 100)) * BigInt(Math.round(p * 100)) + 5000n) / 10000n;
  return Number(cents);
}

export function salePriceCents(s: SaleInput): number | null {
  if (s.priceKind === "load") return loadPriceCents(s.liveWeightLbs, s.pricePerCwt);
  const g = Number(s.grossAmount);
  if (!s.grossAmount.trim() || !Number.isFinite(g) || g < 0) return null;
  return Math.round(g * 100);
}

export function checkSale(s: SaleInput, headCount: number, hasLrp: boolean): string | null {
  if (s.buyerKind === "outside" && !s.buyerName.trim()) return "Enter who bought the cattle (for example the packer or sale barn).";
  if (s.buyerKind === "platform" && !s.buyerSlug) return "Choose the CattleCoin feedlot that bought the cattle.";
  if (s.priceKind === "load") {
    if (!/^\d+$/.test(s.headSold.trim()) || Number(s.headSold) <= 0) return "Head sold must be a whole number above 0.";
    if (s.headLost.trim() && !/^\d+$/.test(s.headLost.trim())) return "Head lost must be a whole number.";
    const total = Number(s.headSold) + Number(s.headLost || 0);
    if (total > headCount) return `Head sold plus head lost (${total}) is more than this herd's ${headCount} head.`;
    if (s.buyerKind === "platform" && Number(s.headSold) < 20) return "A sale to a CattleCoin feedlot needs at least 20 head sold.";
    const w = checkMoney(s.liveWeightLbs, "Total live weight", { allowZero: false });
    if (w) return w;
    const p = checkMoney(s.pricePerCwt, "Price per cwt", { allowZero: true });
    if (p) return p;
  } else {
    const g = checkMoney(s.grossAmount, "Sale price", { allowZero: true });
    if (g) return g;
  }
  if (s.lrpIndemnity.trim()) {
    if (!hasLrp) return "An LRP payout can only be recorded when the herd has an LRP record.";
    const l = checkMoney(s.lrpIndemnity, "LRP payout", { allowZero: true });
    if (l) return l;
  }
  return null;
}

export const postSale = (herdId: string, s: SaleInput) =>
  sendJSON<{ message: string; sale: Sale; preview: SettlementBreakdown }>(`/settlement/herds/${herdId}/sale`, "POST", compact({
    buyerName: s.buyerKind === "outside" ? s.buyerName.trim() : undefined,
    buyerSlug: s.buyerKind === "platform" ? s.buyerSlug : undefined,
    headSold: s.priceKind === "load" ? Number(s.headSold) : undefined,
    headLost: s.priceKind === "load" && s.headLost.trim() ? Number(s.headLost) : undefined,
    liveWeightLbs: s.priceKind === "load" ? Number(s.liveWeightLbs) : undefined,
    pricePerCwt: s.priceKind === "load" ? Number(s.pricePerCwt) : undefined,
    grossAmount: s.priceKind === "total" ? Number(s.grossAmount) : undefined,
    lrpIndemnity: s.lrpIndemnity.trim() ? Number(s.lrpIndemnity) : undefined,
    lrpNote: s.lrpIndemnity.trim() && s.lrpNote.trim() ? s.lrpNote.trim() : undefined,
    saleDate: s.saleDate || undefined,
  }));

export const SALE_STATUS_LABEL: Record<string, string> = {
  pending_approval: "Waiting for CattleCoin approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const BUYER_RESPONSE_LABEL: Record<string, string> = {
  waiting: "Waiting for the buyer to accept",
  accepted: "Buyer accepted",
  declined: "Buyer declined",
  not_required: "",
};

// ---- payouts -----------------------------------------------------------------

export type MyPayout = {
  payoutId: string;
  saleId: string;
  herdId: string;
  herdName: string;
  saleDate: string;
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

export const getMyPayouts = () => getJSON<MyPayout[]>("/settlement/my-payouts");

export const RECIPIENT_LABEL: Record<string, string> = {
  owner: "Your share as the owner",
  investor: "As an investor",
  provider: "For services billed",
  platform: "Platform fees",
};

// ---- shared ------------------------------------------------------------------

// A dollar amount typed by a person: a number, at most 2 decimals.
export function checkMoney(
  raw: string, label: string, opts: { allowZero: boolean; optional?: boolean }
): string | null {
  const v = raw.trim();
  if (v === "") return opts.optional ? null : `${label} is required.`;
  const n = Number(v);
  if (!Number.isFinite(n)) return `${label} must be a number.`;
  if (opts.allowZero ? n < 0 : n <= 0) return `${label} must be ${opts.allowZero ? "0 or more" : "more than 0"}.`;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return `${label} can have at most 2 decimal places.`;
  return null;
}

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function shortDate(s: string | null | undefined): string {
  if (!s) return "-";
  // date-only strings ("2026-09-23") are shown as that calendar day, never shifted by time zone
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
