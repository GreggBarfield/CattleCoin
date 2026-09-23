// Rancher "My Herds" page (punch list #3, pass 1). Same fetch/auth pattern as
// herdLifecycle.ts - kept in its own file so api.ts stays as it is.
// Every call sends the login token; the server works out which rancher is
// asking from the token, never from anything the page sends.
import { getAuthToken } from "@/context/AuthContext";

const API_BASE = "/api";

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class RancherApiError extends Error {
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
  if (!res.ok) throw new RancherApiError(res.status, await readError(res));
  return res.json() as Promise<T>;
}

async function postJSON<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new RancherApiError(res.status, await readError(res));
  return res.json() as Promise<T>;
}

// ---- GET /api/rancher/me/herds ----------------------------------------------
// One row per herd the logged-in rancher owns, newest first.
export type MyHerdRow = {
  herd_id: string;
  herd_name: string;
  cohort_label: string | null;
  breed_code: string | null;
  season: string | null;
  dominant_stage: string | null;
  head_count: number | null;
  listing_price: string | number | null;
  purchase_status: string | null; // available / pending / sold (sold = every offered share bought)
  feedlot_status: string | null;  // pending (not open) / listed (open to investors) / sold (sale in progress or done)
  investor_pct: string | number | null;
  created_at: string | null;
  last_updated: string | null;
  cattle_count: number; // animals actually registered to the herd
};

export const getMyHerds = () => getJSON<MyHerdRow[]>("/rancher/me/herds");

// ---- GET /api/rancher/me/investments ----------------------------------------
// Shares sold and investor count per herd (from the share ledger).
export type MyHerdInvestment = {
  herdId: string;
  herdName: string;
  listingPrice: number;
  headCount: number | null;
  poolId: string | null;
  totalSupply: number | null;
  tokensSold: number;
  investorCount: number;
  estimatedCapitalRaised: number;
};

export type MyInvestmentsResult = {
  rancherId: string;
  items: MyHerdInvestment[];
};

export const getMyInvestments = () => getJSON<MyInvestmentsResult>("/rancher/me/investments");

// ---- GET /api/funds/herds/:herdId -------------------------------------------
// The exact money investors have paid in (raised) and what has been released.
export type HerdFunds = {
  herdId: string;
  funds: { raised: number; released: number; available: number; paymentCount: number; releaseCount: number };
};

export const getHerdFunds = (herdId: string) => getJSON<HerdFunds>(`/funds/herds/${herdId}`);

// ---- open / close to investors ------------------------------------------------
export type OpenHerdResult = {
  message: string;
  herd: { herdId: string; herdName: string; investorPct: number; listingPrice: number };
  offering: { totalSupply: number; investorAllocation: number; pricePerToken: number; maxRaise: number };
  warnings?: string[];
};

export const postOpenHerd = (herdId: string, investorPct: number, listingPrice: number) =>
  postJSON<OpenHerdResult>(`/herds/${herdId}/open-to-investors`, { investorPct, listingPrice });

export const postCloseHerd = (herdId: string) =>
  postJSON<{ message: string; herdId: string }>(`/herds/${herdId}/close-to-investors`);

// ---- helpers used by the page (and its tests) -----------------------------

export type HerdStatus = "not_open" | "open" | "fully_funded" | "sold";

export function herdStatus(h: Pick<MyHerdRow, "feedlot_status" | "purchase_status">): HerdStatus {
  if (h.feedlot_status === "sold") return "sold";
  if (h.feedlot_status === "listed") return h.purchase_status === "sold" ? "fully_funded" : "open";
  return "not_open";
}

export const STATUS_LABEL: Record<HerdStatus, string> = {
  not_open: "Not open to investors",
  open: "Open to investors",
  fully_funded: "Fully funded",
  sold: "Sold or sale pending",
};

// Returns an error message, or null if the percentage is OK (same rules as the server).
export function checkInvestorPct(raw: string): string | null {
  if (raw.trim() === "") return "Enter the percent of the herd to offer to investors.";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Investor percent must be a number.";
  if (n <= 0 || n > 100) return "Investor percent must be more than 0 and at most 100.";
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-7) return "Investor percent can have at most 2 decimal places.";
  return null;
}

export function checkPrice(raw: string): string | null {
  if (raw.trim() === "") return "Enter the herd's value (asking price).";
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "The herd's value must be a number greater than 0.";
  return null;
}

// Same math the server uses when it opens the herd, so the preview matches
// what the rancher will see afterwards (price per share rounded to the cent,
// most you can raise rounded down to the cent).
export function offerPreview(listingPrice: number, totalShares: number, pct: number) {
  if (!(listingPrice > 0) || !(totalShares > 0) || !(pct > 0) || pct > 100) return null;
  const cents = Math.round(listingPrice * 100);
  const allocation = Math.floor((totalShares * pct) / 100);
  return {
    totalShares,
    allocation,
    pricePerShare: Math.round(cents / totalShares) / 100,
    maxRaise: Math.floor((cents * allocation) / totalShares) / 100,
  };
}
