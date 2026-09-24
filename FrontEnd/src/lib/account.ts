// Account page (punch list fix #10, D8). Same fetch/auth pattern as
// rancherHerds.ts. The server works out whose account it is from the login
// token only - nothing the page sends can point at another account.
import { getAuthToken } from "@/context/AuthContext";

const API_BASE = "/api";

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class AccountApiError extends Error {
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

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...authHeaders(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new AccountApiError(res.status, await readError(res));
  return res.json() as Promise<T>;
}

// The contact fields a user can edit. Email, role and username are
// view-only on this page.
export type ContactInfo = {
  fullName: string | null;
  businessName: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export type Account = ContactInfo & {
  userId: string;
  username: string;
  role: "investor" | "rancher" | "feedlot" | "admin";
  email: string;
  memberSince: string | null;
  profileUpdatedAt: string | null;
};

export const CONTACT_KEYS: (keyof ContactInfo)[] = [
  "fullName",
  "businessName",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
];

// GET /api/account/me
export function getMyAccount(): Promise<Account> {
  return send<Account>("GET", "/account/me");
}

// PUT /api/account/me - an empty string clears a field.
export function updateMyContactInfo(changes: Partial<Record<keyof ContactInfo, string>>): Promise<Account> {
  return send<Account>("PUT", "/account/me", changes);
}

// POST /api/account/password
export function changeMyPassword(currentPassword: string, newPassword: string): Promise<{ ok: true }> {
  return send<{ ok: true }>("POST", "/account/password", { currentPassword, newPassword });
}

// Same limits the server enforces (routes/account.js). Checked here too so
// the person gets the message without a round trip.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72;

export function passwordProblem(current: string, next: string, confirm: string): string | null {
  if (current === "") return "Enter your current password.";
  if (next.length < PASSWORD_MIN) return `New password must be at least ${PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(next).length > PASSWORD_MAX_BYTES) {
    return `New password can be at most ${PASSWORD_MAX_BYTES} characters.`;
  }
  if (next === current) return "New password must be different from your current password.";
  if (next !== confirm) return "The two new passwords don't match.";
  return null;
}
