// Cost verification and producer track record (backend: /api/cost-review and
// /api/producers). Same fetch/auth pattern as rancherMoney.ts. The server
// decides who may do what and says why in its error message when it refuses.
import { getAuthToken } from "@/context/AuthContext";

const API_BASE = "/api";

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class CostReviewError extends Error {
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
  if (!res.ok) throw new CostReviewError(res.status, await readError(res));
  return res.json() as Promise<T>;
}

async function sendJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new CostReviewError(res.status, await readError(res));
  return res.json() as Promise<T>;
}

// ---- shapes ----------------------------------------------------------------

export type VerificationStatus = "unverified" | "documented" | "verified" | "flagged" | "system";

export type CostDocument = {
  docId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
};

export type CostSignal = { code: string; label: string; note?: string | null };

export type Dispute = {
  disputeId: string;
  expenseId: string;
  cost: { category: string; amount: number; description: string | null };
  note: string;
  status: "open" | "upheld" | "dismissed";
  ownerResponse: string | null;
  ownerRespondedAt: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  raisedByMe: boolean;
  raisedBy?: string | null; // admin only
};

export type TrackRecord = {
  producer: { slug: string; division: "feeder" | "cow-calf"; memberSince: string };
  label: "new" | "limited" | "established";
  herds: { completedWithInvestors: number; openToInvestorsNow: number };
  investorOutcomes: {
    capitalRaised: number;
    capitalReturned: number;
    weightedOutcomePct: number | null;
    herdsMadeWhole: number;
    herdsNotMadeWhole: number;
    bestOutcomePct: number | null;
    worstOutcomePct: number | null;
  };
  costs: { manualCosts: number; withInvoice: number; withInvoicePct: number | null; everFlagged: number };
  disputes: { raised: number; upheld: number; dismissed: number; open: number };
  history: {
    herdName: string;
    saleDate: string;
    investors: number;
    paidIn: number;
    paidOut: number;
    outcomePct: number | null;
    madeWhole: boolean;
  }[];
  notice: string;
};

// ---- labels and small helpers -------------------------------------------------

export const STATUS_LABEL: Record<VerificationStatus, string> = {
  unverified: "No invoice yet",
  documented: "Invoice attached",
  verified: "Checked by CattleCoin",
  flagged: "Flagged",
  system: "Booked by the system",
};

export const MAX_INVOICE_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"];

/** Returns a plain-English problem with the chosen file, or null if it looks fine. */
export function checkInvoiceFile(f: { name: string; size: number; type: string }): string | null {
  if (f.size <= 0) return "That file is empty.";
  if (f.size > MAX_INVOICE_BYTES) return "That file is too large. The limit is 5 MB.";
  // The server checks the real contents; this only catches the obvious mistakes early.
  if (f.type && !ACCEPTED.includes(f.type)) return "Please choose a PDF, JPEG or PNG file.";
  return null;
}

export function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function pctText(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// ---- calls ----------------------------------------------------------------------

export async function uploadInvoice(expenseId: string, file: File): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/cost-review/expenses/${expenseId}/documents`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Filename": encodeURIComponent(file.name),
      ...authHeaders(),
    },
    body: file,
  });
  if (!res.ok) throw new CostReviewError(res.status, await readError(res));
  return res.json() as Promise<{ message: string }>;
}

/** Opens an invoice in a new tab. The file needs the login token, so a plain link will not do. */
export async function openInvoice(docId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/cost-review/documents/${docId}?inline=1`, { headers: authHeaders() });
  if (!res.ok) throw new CostReviewError(res.status, await readError(res));
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const disputeCost = (expenseId: string, note: string) =>
  sendJSON<{ message: string }>(`/cost-review/expenses/${expenseId}/dispute`, { note: note.trim() });

export const respondToDispute = (disputeId: string, response: string) =>
  sendJSON<{ message: string }>(`/cost-review/disputes/${disputeId}/respond`, { note: response.trim() });

export const getDisputes = (herdId: string) =>
  getJSON<{ herdId: string; disputes: Dispute[] }>(`/cost-review/herds/${herdId}/disputes`);

export const markCostsSeen = (herdId: string) => sendJSON<{ message: string }>(`/cost-review/herds/${herdId}/seen`, {});

export const getTrackRecordByHerd = (herdId: string) => getJSON<TrackRecord>(`/producers/by-herd/${herdId}/track-record`);

// ---- admin review, sale approval gate, investor alerts -------------------------

export type CostReviewSummary = {
  byStatus: Record<VerificationStatus, number>;
  unverifiedAmount: number;
  flaggedCosts: number;
  duplicateInvoiceCosts: number;
  openDisputes: number;
  blocked: boolean;
  needsAcknowledgement: boolean;
  warnings: string[];
};

export type CostAlert = {
  herdId: string;
  herdName: string;
  since: string;
  newCostCount: number;
  newCostTotal: number;
  newWithoutInvoice: number;
  myDisputesRuledOn: number;
};

export const getCostReviewSummary = (herdId: string) =>
  getJSON<CostReviewSummary>(`/cost-review/herds/${herdId}/summary`);

export const verifyCost = (expenseId: string, note: string) =>
  sendJSON<{ message: string }>(`/cost-review/expenses/${expenseId}/verify`, { note: note.trim() });

export const flagCost = (expenseId: string, reason: string) =>
  sendJSON<{ message: string }>(`/cost-review/expenses/${expenseId}/flag`, { reason: reason.trim() });

export const resolveDispute = (disputeId: string, outcome: "upheld" | "dismissed", note: string) =>
  sendJSON<{ message: string }>(`/cost-review/disputes/${disputeId}/resolve`, { outcome, note: note.trim() });

export const getMyAlerts = () => getJSON<{ alerts: CostAlert[] }>("/cost-review/my-alerts");
