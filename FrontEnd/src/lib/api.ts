import type {
  Pool,
  Cow,
  CowDetailData,
  PoolDetail,
  PortfolioSummary,
  HerdInvestInfo,
  InvestPayload,
  InvestResult,
} from "./types";
import { getAuthToken, type CurrentUser } from "@/context/AuthContext";

const API_BASE = "/api";

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${path} -> ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? fallback;
  } catch {
    return fallback;
  }
}

// -- Per-investor portfolio (Dashboard) --
export async function getInvestorPortfolio(slug: string): Promise<PortfolioSummary> {
  return fetchJSON(`/investors/${slug}/portfolio`);
}

// -- Per-investor holdings (Holdings page) --
export async function getInvestorHoldings(slug: string): Promise<Pool[]> {
  return fetchJSON(`/investors/${slug}/holdings`);
}

// -- Pools / Herds --
export async function getPools(): Promise<Pool[]> {
  return fetchJSON("/pools");
}

export async function getPoolById(poolId: string): Promise<PoolDetail | null> {
  try {
    return await fetchJSON(`/pools/${poolId}`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("404")) return null;
    throw err;
  }
}

export async function getPoolCows(poolId: string): Promise<Cow[]> {
  return fetchJSON(`/pools/${poolId}/cows`);
}

// -- Individual Cow --
export async function getCowById(cowId: string): Promise<CowDetailData | null> {
  try {
    return await fetchJSON(`/cows/${cowId}`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("404")) return null;
    throw err;
  }
}

// -- Invest --
export async function getHerdForInvest(herdId: string): Promise<HerdInvestInfo | null> {
  try {
    return await fetchJSON(`/invest/${herdId}`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("404")) return null;
    throw err;
  }
}

// NOTE: this posts to /invest, which does not match any route currently in
// invest.js (that file only has /invest/:herdId, /invest/create-payment-intent,
// /invest/confirm, /invest/webhook). Left as-is and untouched by the auth
// work - looks like pre-existing dead/unwired code, flagging for later, not
// fixing here since it's outside the scope of this pass.
export async function postInvestment(payload: InvestPayload): Promise<InvestResult> {
  const res = await fetch(`${API_BASE}/invest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `Investment failed: ${res.status}`);
  }
  return res.json() as Promise<InvestResult>;
}

// -- Auth --

export async function postLogin(username: string, password: string): Promise<CurrentUser> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Login failed" }));
    throw new Error(body.error ?? "Login failed");
  }
  return res.json() as Promise<CurrentUser>;
}

// -- Users --
export type UserSummary = {
  userId: string;
  slug:   string;
  role:   string;
  email:  string;
};

export async function getUsersByRole(role: string): Promise<UserSummary[]> {
  return fetchJSON(`/users?role=${encodeURIComponent(role)}`);
}

// (Fix #14: the old feedlot "claim a pending herd" calls were removed. A feedlot
// now gets herds by accepting an offer to buy - see lib/rancherMoney.ts.)

// -- Rancher --

export type RancherCreateHerdPayload = {
  name: string;
  genetics_label: string;
  breed_code: string;
  season: "Spring" | "Fall";
  listing_price: number;
  head_count: number;
  purchase_status?: "available" | "pending" | "sold";
};

export type RancherCreateHerdResult = {
  message: string;
  herd: {
    herd_id: string;
    herd_name: string;
    listing_price: string | number | null;
    purchase_status: string;
  };
};

export type RancherBulkCowPayload = {
  registration_number: string;
  official_id_suffix: string;
  breed_code: string;
  sex_code: "B" | "C" | "H" | "S";
  birth_date: string;
  weight_lbs: number;
  animal_name?: string;
  sire_registration_number?: string;
  dam_registration_number?: string;
  is_genomic_enhanced?: boolean;
};

export type RancherBulkRegisterResult = {
  message: string;
  herdId: string;
  count: number;
  items: Array<{
    cow: { animal_id: number; registration_number: string; official_id: string | null };
  }>;
};

export type RancherPublishResult = {
  message: string;
  herd: {
    herd_id: string;
    purchase_status: string;
    listing_price: string | number | null;
  };
};

// Identity is established solely by the JWT attached via authHeaders() below -
// the backend derives the rancher from the verified token (req.user.userId),
// never from a client-supplied parameter.
export async function postRancherCreateHerd(
  payload: RancherCreateHerdPayload
): Promise<RancherCreateHerdResult> {
  const res = await fetch(`${API_BASE}/herds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to create herd (${res.status}).`));
  }

  return res.json() as Promise<RancherCreateHerdResult>;
}

export async function postRancherRegisterCattleBulk(
  herdId: string,
  cattle: RancherBulkCowPayload[]
): Promise<RancherBulkRegisterResult> {
  const res = await fetch(`${API_BASE}/herds/${herdId}/cattle/bulk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ cattle }),
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to register cattle (${res.status}).`));
  }

  return res.json() as Promise<RancherBulkRegisterResult>;
}

export type RancherOpenToInvestorsResult = {
  message: string;
  herd: {
    herdId: string;
    herdName: string;
    headCount: number;
    feedlotStatus: string;
    investorPct: number;
    listingPrice: number;
  };
  offering: {
    totalSupply: number;
    investorAllocation: number;
    pricePerToken: number;
    maxRaise: number;
  };
  feeTerms: {
    raiseFeePct: number;
    exitProfitFeePct: number;
    exitFeePayer: string;
    perHeadFee: number;
    perHeadFeeTiming: string;
  } | null;
  startingValue?: { booked: boolean; amount?: number };
  warnings?: string[];
};

// Lists a herd on the investor marketplace (feedlot_status 'listed'). This is
// the route investors' queries look for - the older /publish route does not
// list the herd and also tries an on-chain token deploy.
export async function postRancherOpenToInvestors(
  herdId: string,
  investorPct: number,
  listingPrice?: number
): Promise<RancherOpenToInvestorsResult> {
  const res = await fetch(`${API_BASE}/herds/${herdId}/open-to-investors`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(
      listingPrice === undefined ? { investorPct } : { investorPct, listingPrice }
    ),
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to open herd to investors (${res.status}).`));
  }

  return res.json() as Promise<RancherOpenToInvestorsResult>;
}

export async function postRancherPublishHerd(
  herdId: string,
  listingPrice?: number
): Promise<RancherPublishResult> {
  const res = await fetch(`${API_BASE}/herds/${herdId}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(
      listingPrice === undefined ? {} : { listingPrice }
    ),
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to publish herd (${res.status}).`));
  }

  return res.json() as Promise<RancherPublishResult>;
}