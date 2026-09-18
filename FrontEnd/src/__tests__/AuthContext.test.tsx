import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import * as React from "react";
import { AuthProvider, useAuth, homePathForRole } from "@/context/AuthContext";
import type { CurrentUser } from "@/context/AuthContext";

const mockUser: CurrentUser = {
  userId: "42",
  slug:   "alice",
  role:   "investor",
  email:  "alice@test.com",
  token:  "test-token",
};

// â”€â”€ Wrapper to read context values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function TestConsumer({ onValue }: { onValue: (v: ReturnType<typeof useAuth>) => void }) {
  const ctx = useAuth();
  React.useEffect(() => { onValue(ctx); }, [ctx, onValue]);
  return null;
}

// â”€â”€â”€ AuthProvider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("AuthProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test("starts with null user when localStorage is empty", () => {
    let ctx: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <TestConsumer onValue={(v) => { ctx = v; }} />
      </AuthProvider>
    );
    expect(ctx!.currentUser).toBeNull();
  });

  test("hydrates from localStorage on mount", () => {
    localStorage.setItem("cattlecoin_user", JSON.stringify(mockUser));
    let ctx: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <TestConsumer onValue={(v) => { ctx = v; }} />
      </AuthProvider>
    );
    expect(ctx!.currentUser).toMatchObject({ slug: "alice", role: "investor" });
  });

  test("login sets user and persists to localStorage", () => {
    let ctx: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <TestConsumer onValue={(v) => { ctx = v; }} />
      </AuthProvider>
    );
    act(() => { ctx!.login(mockUser); });
    expect(ctx!.currentUser).toMatchObject(mockUser);
    expect(JSON.parse(localStorage.getItem("cattlecoin_user")!)).toMatchObject(mockUser);
  });

  test("logout clears user and removes from localStorage", () => {
    localStorage.setItem("cattlecoin_user", JSON.stringify(mockUser));
    let ctx: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <TestConsumer onValue={(v) => { ctx = v; }} />
      </AuthProvider>
    );
    act(() => { ctx!.logout(); });
    expect(ctx!.currentUser).toBeNull();
    expect(localStorage.getItem("cattlecoin_user")).toBeNull();
  });

  test("survives corrupt localStorage without throwing", () => {
    localStorage.setItem("cattlecoin_user", "not-valid-json{{{");
    expect(() =>
      render(
        <AuthProvider>
          <TestConsumer onValue={() => {}} />
        </AuthProvider>
      )
    ).not.toThrow();
  });
});

// â”€â”€â”€ homePathForRole â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("homePathForRole", () => {
  test("investor â†’ /investor/:slug/dashboard", () => {
    const user: CurrentUser = { ...mockUser, role: "investor", slug: "alice" };
    expect(homePathForRole(user)).toBe("/investor/alice/dashboard");
  });

  test("rancher â†’ /rancher", () => {
    expect(homePathForRole({ ...mockUser, role: "rancher" })).toBe("/rancher");
  });

  test("feedlot â†’ /feedlot", () => {
    expect(homePathForRole({ ...mockUser, role: "feedlot" })).toBe("/feedlot");
  });

  test("admin â†’ /admin", () => {
    expect(homePathForRole({ ...mockUser, role: "admin" })).toBe("/admin");
  });
});
