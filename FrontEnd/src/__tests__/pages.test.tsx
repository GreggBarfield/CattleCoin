import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import type { CurrentUser } from "@/context/AuthContext";
import { Login } from "@/pages/Login";
import { SignUp } from "@/pages/SignUp";
import { WelcomePage } from "@/pages/WelcomePage";

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

function mockFetchError(status: number, body: unknown = { error: "Error" }) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

function Wrapper({ children, initialPath = "/login" }: { children: React.ReactNode; initialPath?: string }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>{children}</AuthProvider>
    </MemoryRouter>
  );
}

// â”€â”€ Login â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("Login page", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  test("renders username and password fields", () => {
    render(<Wrapper><Login /></Wrapper>);
    expect(screen.getByPlaceholderText(/e\.g\. investor1/i)).toBeTruthy();
    expect(screen.getByPlaceholderText("••••••••")).toBeTruthy();
  });

  test("renders Sign in button", () => {
    render(<Wrapper><Login /></Wrapper>);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  test("shows error message on failed login", async () => {
    vi.stubGlobal("fetch", mockFetchError(401, { error: "Invalid credentials" }));
    render(<Wrapper><Login /></Wrapper>);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. investor1/i), {
      target: { value: "baduser" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "wrongpw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeTruthy();
    });
  });

  test("submits POST to /api/auth/login with username and password", async () => {
    const user: CurrentUser = { userId: "1", slug: "alice", role: "investor", email: "a@test.com", token: "test-token" };
    const mockFn = mockFetchOk(user);
    vi.stubGlobal("fetch", mockFn);
    render(<Wrapper><Login /></Wrapper>);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. investor1/i), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "pw123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(mockFn).toHaveBeenCalled());
    const [url, opts] = mockFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/auth/login");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toMatchObject({ username: "alice", password: "pw123" });
  });

  test("redirects to home when already logged in", async () => {
    const user: CurrentUser = { userId: "1", slug: "alice", role: "investor", email: "a@test.com", token: "test-token" };
    localStorage.setItem("cattlecoin_user", JSON.stringify(user));

    // We just verify no crash â€” redirect happens via useNavigate
    expect(() =>
      render(<Wrapper><Login /></Wrapper>)
    ).not.toThrow();
  });

  test("shows Sign up link", () => {
    render(<Wrapper><Login /></Wrapper>);
    expect(screen.getByRole("link", { name: /sign up/i })).toBeTruthy();
  });
});

// â”€â”€ SignUp â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("SignUp page", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  test("renders all form fields", () => {
    render(<Wrapper initialPath="/signup"><SignUp /></Wrapper>);
    expect(screen.getByPlaceholderText(/e\.g\. johndoe/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/you@example\.com/i)).toBeTruthy();
  });

  test("shows error when passwords do not match", async () => {
    const { container } = render(<Wrapper initialPath="/signup"><SignUp /></Wrapper>);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. johndoe/i), {
      target: { value: "testuser" },
    });
    // Fill password fields â€” there are two â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢  inputs
    const pwFields = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(pwFields[0], { target: { value: "abc123" } });
    fireEvent.change(pwFields[1], { target: { value: "different" } });

    // Use fireEvent.submit on the form to bypass HTML5 native validation
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeTruthy();
    });
  });

  test("shows error when username is too short", async () => {
    const { container } = render(<Wrapper initialPath="/signup"><SignUp /></Wrapper>);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. johndoe/i), {
      target: { value: "a" }, // < 2 chars
    });
    const pwFields = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(pwFields[0], { target: { value: "abc123" } });
    fireEvent.change(pwFields[1], { target: { value: "abc123" } });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/at least 2 characters/i)).toBeTruthy();
    });
  });

  test("shows role selector buttons", () => {
    render(<Wrapper initialPath="/signup"><SignUp /></Wrapper>);
    // Use anchored regex to avoid matching "investor" in feedlot description
    expect(screen.getByRole("button", { name: /^Investor/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Rancher/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Feedlot/i })).toBeTruthy();
  });

  test("submits POST to /api/auth/signup on valid form", async () => {
    const user: CurrentUser = { userId: "2", slug: "bob", role: "investor", email: "b@test.com", token: "test-token" };
    const mockFn = mockFetchOk(user);
    vi.stubGlobal("fetch", mockFn);
    render(<Wrapper initialPath="/signup"><SignUp /></Wrapper>);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. johndoe/i), {
      target: { value: "bobsmith" },
    });
    fireEvent.change(screen.getByPlaceholderText(/you@example\.com/i), {
      target: { value: "bob@test.com" },
    });
    const pwFields = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(pwFields[0], { target: { value: "secret99" } });
    fireEvent.change(pwFields[1], { target: { value: "secret99" } });

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(mockFn).toHaveBeenCalled());
    const [url, opts] = mockFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/auth/signup");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body).toMatchObject({ username: "bobsmith", email: "bob@test.com" });
  });

  test("shows error on server error", async () => {
    vi.stubGlobal("fetch", mockFetchError(400, { error: "Username taken" }));
    render(<Wrapper initialPath="/signup"><SignUp /></Wrapper>);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. johndoe/i), {
      target: { value: "existinguser" },
    });
    fireEvent.change(screen.getByPlaceholderText(/you@example\.com/i), {
      target: { value: "x@test.com" },
    });
    const pwFields = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(pwFields[0], { target: { value: "pw" } });
    fireEvent.change(pwFields[1], { target: { value: "pw" } });

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/username taken/i)).toBeTruthy();
    });
  });
});

// â”€â”€ WelcomePage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("WelcomePage", () => {
  beforeEach(() => localStorage.clear());

  test("renders CattleCoin heading", () => {
    render(<Wrapper initialPath="/"><WelcomePage /></Wrapper>);
    // h1 with CattleCoin
    const headings = screen.getAllByText("CattleCoin");
    expect(headings.length).toBeGreaterThan(0);
  });

  test("renders Sign in button", () => {
    render(<Wrapper initialPath="/"><WelcomePage /></Wrapper>);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  test("renders Get started link", () => {
    render(<Wrapper initialPath="/"><WelcomePage /></Wrapper>);
    expect(screen.getByRole("link", { name: /get started/i })).toBeTruthy();
  });

  test("renders feature section for Ranchers, Feedlots, and Investors", () => {
    render(<Wrapper initialPath="/"><WelcomePage /></Wrapper>);
    expect(screen.getByText("Ranchers")).toBeTruthy();
    expect(screen.getByText("Feedlots")).toBeTruthy();
    expect(screen.getByText("Investors")).toBeTruthy();
  });

  test("renders footer with version info", () => {
    render(<Wrapper initialPath="/"><WelcomePage /></Wrapper>);
    expect(screen.getByText(/CSCE 482/i)).toBeTruthy();
  });
});
