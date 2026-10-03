import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { InvestPage } from "@/pages/InvestPage";
import type { HerdInvestInfo } from "@/lib/types";

// The Pay button used to call /api/invest/create-payment-intent and
// /api/invest/confirm WITHOUT the login token, so the server answered
// "Missing or invalid Authorization header" and nobody could pay. These
// tests prove both calls now carry the logged-in user's token.

vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(() => Promise.resolve({})) }));

const confirmCardPayment = vi.fn();
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardElement: () => <div data-testid="card-element" />,
  useStripe: () => ({ confirmCardPayment }),
  useElements: () => ({ getElement: () => ({}) }),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, getHerdForInvest: vi.fn() };
});

import { getHerdForInvest } from "@/lib/api";

const herd: HerdInvestInfo = {
  herdId: "795c41d1-9fa7-4018-8567-47e923344d17",
  herdName: "Test Herd",
  purchaseStatus: "available",
  listingPrice: 25000,
  dominantStage: "FEEDLOT",
  breedCode: "AN",
  riskScore: 35,
  totalSupply: 20,
  investorAllocation: 10,
  investorPct: 50,
  tokensSold: 0,
  tokensAvailable: 10,
  pricePerToken: 1250,
  contractAddress: "",
  isAvailable: true,
};

describe("InvestPage payment calls send the login token", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    confirmCardPayment.mockReset();
    confirmCardPayment.mockResolvedValue({ paymentIntent: { id: "pi_test_1", status: "succeeded" } });
  });

  test("create-payment-intent and confirm both include Authorization: Bearer <token>", async () => {
    vi.mocked(getHerdForInvest).mockResolvedValue(herd);
    localStorage.setItem(
      "cattlecoin_user",
      JSON.stringify({ userId: "1", slug: "walletserver1", role: "investor", email: "i@test.com", token: "tok-abc" }),
    );

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/create-payment-intent")) {
          return new Response(JSON.stringify({ clientSecret: "cs_test" }), { status: 200 });
        }
        if (url.endsWith("/confirm")) {
          return new Response(JSON.stringify({ message: "ok" }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      });

    render(
      <MemoryRouter initialEntries={[`/invest/${herd.herdId}`]}>
        <AuthProvider>
          <Routes>
            <Route path="/invest/:herdId" element={<InvestPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("How many tokens?")).toBeTruthy());
    fireEvent.click(screen.getByText("Proceed to Payment"));
    const payButton = await screen.findByRole("button", { name: /^Pay / });
    fireEvent.click(payButton);

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.endsWith("/create-payment-intent"))).toBe(true);
      expect(urls.some((u) => u.endsWith("/confirm"))).toBe(true);
    });

    for (const suffix of ["/create-payment-intent", "/confirm"]) {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith(suffix))!;
      const headers = (call[1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tok-abc");
      expect(headers["Content-Type"]).toBe("application/json");
    }
  });
});
