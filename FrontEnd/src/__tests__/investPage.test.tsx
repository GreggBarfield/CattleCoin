import { describe, test, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { InvestPage } from "@/pages/InvestPage";
import type { HerdInvestInfo } from "@/lib/types";

// Fix #16 (I1): the Invest page used to run per-token prices through
// formatUsd() (whole-dollar rounding, e.g. $3.51 -> "$4"), while the
// Marketplace list correctly showed 2 decimals for the same herd. These
// tests prove Price per Token / Total cost / Total charge now render with
// cents, matching the Marketplace, instead of rounding to a whole dollar.

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, getHerdForInvest: vi.fn() };
});

import { getHerdForInvest } from "@/lib/api";

const herd: HerdInvestInfo = {
  herdId: "795c41d1-9fa7-4018-8567-47e923344d17",
  herdName: "Angus Finishing D",
  purchaseStatus: "available",
  listingPrice: 175723.59,
  dominantStage: "FEEDLOT",
  breedCode: "AN",
  riskScore: 35,
  totalSupply: 50000,
  investorAllocation: 42500,
  investorPct: 85,
  tokensSold: 21500,
  tokensAvailable: 21000,
  pricePerToken: 3.51,
  contractAddress: "",
  isAvailable: true,
};

function renderInvestPage() {
  localStorage.setItem(
    "cattlecoin_user",
    JSON.stringify({ userId: "1", slug: "investor10", role: "investor", email: "i@test.com", token: "t" }),
  );
  return render(
    <MemoryRouter initialEntries={[`/invest/${herd.herdId}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/invest/:herdId" element={<InvestPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("InvestPage price display (fix #16, I1)", () => {
  test("Price per Token shows cents, not rounded to a whole dollar", async () => {
    vi.mocked(getHerdForInvest).mockResolvedValue(herd);
    renderInvestPage();
    await waitFor(() => expect(screen.getAllByText("$3.51").length).toBeGreaterThan(0));
    // The old bug rendered this as "$4" - make sure that's gone.
    expect(screen.queryByText("$4")).toBeNull();
  });

  test("Total cost for 1 token matches the per-token price, not a rounded dollar", async () => {
    vi.mocked(getHerdForInvest).mockResolvedValue(herd);
    renderInvestPage();
    await waitFor(() => expect(screen.getByText("How many tokens?")).toBeTruthy());
    // Default token count is 1, so Price per Token and Total cost both read $3.51.
    const matches = screen.getAllByText("$3.51");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test("Listing Price still shows as a whole dollar figure (unchanged)", async () => {
    vi.mocked(getHerdForInvest).mockResolvedValue(herd);
    renderInvestPage();
    await waitFor(() => expect(screen.getByText("$175,724")).toBeTruthy());
  });
});
