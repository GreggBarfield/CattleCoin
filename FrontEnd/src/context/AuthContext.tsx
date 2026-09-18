import * as React from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type UserRole = "investor" | "rancher" | "feedlot" | "admin";

export type CurrentUser = {
  userId: string;
  slug:   string;
  role:   UserRole;
  email:  string;
  token:  string;
};

type AuthContextValue = {
  currentUser: CurrentUser | null;
  login:  (user: CurrentUser) => void;
  logout: () => void;
};

// ── Context ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "cattlecoin_user";

const AuthContext = React.createContext<AuthContextValue>({
  currentUser: null,
  login:  () => {},
  logout: () => {},
});

// ── Storage helpers (usable outside the React tree, e.g. from api.ts) ─────────

function readStoredUser(): CurrentUser | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as CurrentUser) : null;
  } catch {
    return null;
  }
}

/** The current JWT, or null if no one is logged in. Safe to call outside React (e.g. api.ts). */
export function getAuthToken(): string | null {
  return readStoredUser()?.token ?? null;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = React.useState<CurrentUser | null>(() => readStoredUser());

  function login(user: CurrentUser) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    setCurrentUser(user);
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    setCurrentUser(null);
  }

  return (
    <AuthContext.Provider value={{ currentUser, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  return React.useContext(AuthContext);
}

// ── Role-based redirect helper ────────────────────────────────────────────────

export function homePathForRole(user: CurrentUser): string {
  switch (user.role) {
    case "investor": return `/investor/${user.slug}/dashboard`;
    case "rancher":  return "/rancher";
    case "feedlot":  return "/feedlot";
    case "admin":    return "/admin";
    default:         return "/login";
  }
}
