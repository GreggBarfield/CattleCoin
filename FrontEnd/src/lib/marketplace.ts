// The investor marketplace: every lot that is open to investors, described with
// real numbers only. Kept in its own file. The server works out who is asking
// from the login token.
import { getAuthToken } from "@/context/AuthContext";

export type Division = "cow-calf" | "feeder";
export type Track = "sold_outright" | "retained_ownership";

export type LotExitFee = { pct: number; paidBy: "investor" | "producer" };

export type LotLrp = {
  endorsementType: string;
  coveragePct: number | null;
  floorPriceCwt: number | null;
  endDate: string | null;
  agentVerified: boolean;
};

export type MarketLot = {
  herdId: string;
  name: string;
  division: Division;
  track: Track;
  breed: string;
  headCount: number;
  verified: boolean;
  dominantStage: string;
  listingPrice: number;
  pricePerToken: number | null;
  totalSupply: number;
  investorPct: number | null;
  tokensOffered: number;
  tokensSold: number;
  tokensRemaining: number;
  canInvest: boolean;
  myTokens: number;
  exitFee: LotExitFee | null;
  lrp: LotLrp | null;
  lastUpdateIso: string | null;
};

export class MarketApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getMarketplace(): Promise<MarketLot[]> {
  const token = getAuthToken();
  const res = await fetch("/api/marketplace", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* keep the default message */
    }
    throw new MarketApiError(res.status, msg);
  }
  const body = (await res.json()) as { lots: MarketLot[] };
  return body.lots;
}

export const DIVISION_LABELS: Record<Division, string> = {
  "cow-calf": "Cow-Calf",
  feeder: "Feeders",
};

export const TRACK_LABELS: Record<Track, string> = {
  sold_outright: "Sold outright",
  retained_ownership: "Retained ownership",
};

export const ENDORSEMENT_LABELS: Record<string, string> = {
  feeder_cattle: "Feeder cattle LRP",
  fed_cattle: "Fed cattle LRP",
  other: "LRP",
};

/** Money for a price per token or per hundredweight, always two decimals. */
export function price(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
