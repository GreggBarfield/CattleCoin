import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Account } from "@/pages/Account";
import { AppShell } from "@/components/layout/AppShell";
import { AuthProvider, type CurrentUser } from "@/context/AuthContext";
import { passwordProblem, AccountApiError, type Account as AccountData } from "@/lib/account";

// Fix #10 (D8): the page calls these three; the password check helper stays real.
vi.mock("@/lib/account", async () => {
  const actual = await vi.importActual<typeof import("@/lib/account")>("@/lib/account");
  return {
    ...actual,
    getMyAccount: vi.fn(),
    updateMyContactInfo: vi.fn(),
    changeMyPassword: vi.fn(),
  };
});
import { getMyAccount, updateMyContactInfo, changeMyPassword } from "@/lib/account";

const base: AccountData = {
  userId: "u-r1",
  username: "rancher10",
  role: "rancher",
  email: "rancher10@example.com",
  memberSince: "2026-09-01T12:00:00Z",
  profileUpdatedAt: null,
  fullName: "Gregg B",
  businessName: null,
  phone: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: "TX",
  postalCode: null,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/account"]}>
      <Account />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(getMyAccount).mockReset().mockResolvedValue({ ...base });
  vi.mocked(updateMyContactInfo).mockReset();
  vi.mocked(changeMyPassword).mockReset();
});

describe("Account page - view", () => {
  test("shows username, account type, email (view only) and fills the contact form", async () => {
    renderPage();
    expect(await screen.findByText("rancher10")).toBeTruthy();
    expect(screen.getByText("Rancher")).toBeTruthy();
    expect(screen.getByText("rancher10@example.com")).toBeTruthy();
    expect(screen.getByText(/To change your email, contact CattleCoin/)).toBeTruthy();
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("Gregg B");
    expect((screen.getByLabelText("State") as HTMLInputElement).value).toBe("TX");
    // no email box to type in
    expect(screen.queryByLabelText(/^Email$/)).toBeNull();
  });

  test("shows a load error instead of the form", async () => {
    vi.mocked(getMyAccount).mockRejectedValueOnce(new AccountApiError(500, "Could not load your account. Please try again."));
    renderPage();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not load your account/);
    expect(screen.queryByLabelText("Full name")).toBeNull();
  });
});

describe("Account page - contact info", () => {
  test("Save is off until something changes, then sends only the changed fields", async () => {
    vi.mocked(updateMyContactInfo).mockResolvedValueOnce({ ...base, phone: "979-555-0100", fullName: null, profileUpdatedAt: "2026-09-24T12:00:00Z" });
    renderPage();
    const save = (await screen.findByRole("button", { name: "Save contact information" })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "979-555-0100" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(updateMyContactInfo).toHaveBeenCalledTimes(1));
    expect(updateMyContactInfo).toHaveBeenCalledWith({ phone: "979-555-0100", fullName: "" });
    expect((await screen.findByRole("status")).textContent).toBe("Contact information saved.");
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("");
  });

  test("a server refusal is shown and clears as soon as the field is edited", async () => {
    vi.mocked(updateMyContactInfo).mockRejectedValueOnce(
      new AccountApiError(400, "Phone can only have digits, spaces and + ( ) - . characters.")
    );
    renderPage();
    const phone = await screen.findByLabelText("Phone");
    fireEvent.change(phone, { target: { value: "call me" } });
    fireEvent.click(screen.getByRole("button", { name: "Save contact information" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Phone can only have digits/);
    fireEvent.change(phone, { target: { value: "979" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Account page - change password", () => {
  test("mismatched new passwords are caught on the page, nothing sent", async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText("Current password"), { target: { value: "oldpass12" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpass123" } });
    fireEvent.change(screen.getByLabelText("New password again"), { target: { value: "newpass124" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The two new passwords don't match.");
    expect(changeMyPassword).not.toHaveBeenCalled();
  });

  test("a wrong current password from the server is shown", async () => {
    vi.mocked(changeMyPassword).mockRejectedValueOnce(new AccountApiError(400, "Your current password is not correct."));
    renderPage();
    fireEvent.change(await screen.findByLabelText("Current password"), { target: { value: "wrongpw12" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpass123" } });
    fireEvent.change(screen.getByLabelText("New password again"), { target: { value: "newpass123" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Your current password is not correct.");
  });

  test("success clears all three boxes and says so", async () => {
    vi.mocked(changeMyPassword).mockResolvedValueOnce({ ok: true });
    renderPage();
    fireEvent.change(await screen.findByLabelText("Current password"), { target: { value: "oldpass12" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpass123" } });
    fireEvent.change(screen.getByLabelText("New password again"), { target: { value: "newpass123" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(changeMyPassword).toHaveBeenCalledWith("oldpass12", "newpass123"));
    expect((await screen.findByRole("status")).textContent).toMatch(/Your password was changed/);
    for (const label of ["Current password", "New password", "New password again"]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("");
    }
  });
});

describe("passwordProblem", () => {
  test("checks in the same order and with the same limits as the server", () => {
    expect(passwordProblem("", "newpass123", "newpass123")).toMatch(/current password/);
    expect(passwordProblem("old12345", "short", "short")).toMatch(/at least 8/);
    expect(passwordProblem("old12345", "a".repeat(73), "a".repeat(73))).toMatch(/at most 72/);
    // 72 bytes but only 24 characters (3-byte characters) is still fine; 25 is too many
    expect(passwordProblem("old12345", "€".repeat(24), "€".repeat(24))).toBeNull();
    expect(passwordProblem("old12345", "€".repeat(25), "€".repeat(25))).toMatch(/at most 72/);
    expect(passwordProblem("same1234", "same1234", "same1234")).toMatch(/different/);
    expect(passwordProblem("old12345", "newpass123", "newpass12")).toMatch(/don't match/);
    expect(passwordProblem("old12345", "newpass123", "newpass123")).toBeNull();
  });
});

describe("AppShell - My Account link (D8)", () => {
  beforeEach(() => localStorage.clear());

  function renderShell(user: CurrentUser | null, path: string) {
    if (user) localStorage.setItem("cattlecoin_user", JSON.stringify(user));
    return render(
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="*" element={<div>page content</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
  }

  test.each(["rancher", "investor", "feedlot", "admin"] as const)("%s sees a My Account link to /account", (role) => {
    renderShell({ userId: "1", slug: "someone", role, email: "s@test.com", token: "t" }, "/FAQ");
    const link = screen.getByRole("link", { name: "My Account" });
    expect(link.getAttribute("href")).toBe("/account");
  });

  test("no My Account link when signed out", () => {
    renderShell(null, "/FAQ");
    expect(screen.queryByRole("link", { name: "My Account" })).toBeNull();
  });

  test("header keeps the portal name on the account page", () => {
    renderShell({ userId: "2", slug: "bob", role: "rancher", email: "b@test.com", token: "t" }, "/account");
    expect(screen.getByText("Rancher Portal - My Account")).toBeTruthy();
  });
});
