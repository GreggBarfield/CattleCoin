import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { Holdings } from "@/pages/Holdings";
import type { MarketLot } from "@/lib/marketplace";

// Mock the marketplace call (keep the labels and formatters real)
vi.mock("@/lib/marketplace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/marketplace")>();
  return { ...actual, getMarketplace: vi.fn() };
});

import { getMarketplace } from "@/lib/marketplace";

const makeLot = (overrides: Partial<MarketLot> = {}): MarketLot => ({
  herdId: "herd-1",
  name: "Alpha Herd",
  division: "cow-calf",
  track: "sold_outright",
  breed: "Angus AI Select",
  headCount: 40,
  verified: true,
  dominantStage: "RANCH",
  listingPrice: 60000,
  pricePerToken: 3000,
  totalSupply: 20,
  investorPct: 50,
  tokensOffered: 10,
  tokensSold: 4,
  tokensRemaining: 6,
  canInvest: true,
  myTokens: 0,
  exitFee: null,
  lrp: null,
  lastUpdateIso: "2026-09-20T00:00:00Z",
  ...overrides,
});

const feederLot = (overrides: Partial<MarketLot> = {}) =>
  makeLot({ herdId: "herd-2", name: "Beta Feeders", division: "feeder", ...overrides });

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/investor/alice/holdings"]}>
      <AuthProvider>
        <Routes>
          <Route path="/investor/:slug/holdings" element={children} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

async function load(lots: MarketLot[]) {
  vi.mocked(getMarketplace).mockResolvedValue(lots);
  render(<Wrapper><Holdings /></Wrapper>);
  await waitFor(() => expect(screen.queryByText(/failed to load/i)).toBeNull());
}

describe("Marketplace page", () => {
  beforeEach(() => {
    vi.mocked(getMarketplace).mockReset();
  });

  test("renders the Marketplace heading", async () => {
    await load([]);
    await waitFor(() => expect(screen.getByText("Marketplace")).toBeTruthy());
  });

  test("shows lot names after load", async () => {
    await load([makeLot()]);
    await waitFor(() => expect(screen.getByText("Alpha Herd")).toBeTruthy());
  });

  test("shows the lot count", async () => {
    await load([makeLot(), feederLot()]);
    await waitFor(() => expect(screen.getByText(/2 of 2 lots/i)).toBeTruthy());
  });

  test("shows a badge for the division and the track on each lot", async () => {
    await load([makeLot(), feederLot()]);
    await waitFor(() => screen.getByText("Alpha Herd"));
    const rows = screen.getAllByRole("row");
    const alpha = rows.find((r) => within(r).queryByText("Alpha Herd"))!;
    const beta = rows.find((r) => within(r).queryByText("Beta Feeders"))!;
    expect(within(alpha).getByText("Cow-Calf")).toBeTruthy();
    expect(within(beta).getByText("Feeders")).toBeTruthy();
    expect(within(alpha).getByText("Sold outright")).toBeTruthy();
  });

  test("the division tabs show how many lots each has", async () => {
    await load([makeLot(), feederLot(), feederLot({ herdId: "herd-3", name: "Gamma Feeders" })]);
    await waitFor(() => screen.getByText("Alpha Herd"));
    expect(screen.getByRole("tab", { name: /all lots \(3\)/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /cow-calf \(1\)/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /feeders \(2\)/i })).toBeTruthy();
  });

  test("choosing Feeders shows only feeder lots and the feeder explanation", async () => {
    await load([makeLot(), feederLot()]);
    await waitFor(() => screen.getByText("Alpha Herd"));
    expect(screen.getByText(/backing the rancher who raised the calves/i)).toBeTruthy();
    expect(screen.getByText(/backing a feedyard that bought the cattle/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /feeders/i }));

    await waitFor(() => expect(screen.queryByText("Alpha Herd")).toBeNull());
    expect(screen.getByText("Beta Feeders")).toBeTruthy();
    expect(screen.queryByText(/backing the rancher who raised the calves/i)).toBeNull();
    expect(screen.getByText(/backing a feedyard that bought the cattle/i)).toBeTruthy();
    expect(screen.getByText(/1 of 2 lots/i)).toBeTruthy();
  });

  test("choosing Cow-Calf shows only cow-calf lots", async () => {
    await load([makeLot(), feederLot()]);
    await waitFor(() => screen.getByText("Alpha Herd"));
    fireEvent.click(screen.getByRole("tab", { name: /cow-calf/i }));
    await waitFor(() => expect(screen.queryByText("Beta Feeders")).toBeNull());
    expect(screen.getByText("Alpha Herd")).toBeTruthy();
  });

  test("shows price per token and tokens left", async () => {
    await load([makeLot()]);
    await waitFor(() => screen.getByText("Alpha Herd"));
    expect(screen.getByText("$3,000.00")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText(/of 10/)).toBeTruthy();
  });

  test("shows the price protection on file, and says so when there is none", async () => {
    await load([
      makeLot({
        lrp: { endorsementType: "fed_cattle", coveragePct: 95, floorPriceCwt: 185.5, endDate: null, agentVerified: false },
      }),
      feederLot(),
    ]);
    await waitFor(() => screen.getByText("Alpha Herd"));
    expect(screen.getByText(/floor \$185\.50\/cwt, 95% coverage/i)).toBeTruthy();
    expect(screen.getByText(/not yet verified/i)).toBeTruthy();
    expect(screen.getByText("None on file", { selector: "p" })).toBeTruthy();
  });

  test("shows an agent-verified policy as verified", async () => {
    await load([
      makeLot({
        lrp: { endorsementType: "feeder_cattle", coveragePct: null, floorPriceCwt: 210, endDate: null, agentVerified: true },
      }),
    ]);
    await waitFor(() => screen.getByText("Alpha Herd"));
    expect(screen.getByText(/verified by an insurance agent/i)).toBeTruthy();
  });

  test("shows the exit fee, including when the producer pays it", async () => {
    await load([
      makeLot({ exitFee: { pct: 10, paidBy: "investor" } }),
      feederLot({ exitFee: { pct: 5, paidBy: "producer" } }),
    ]);
    await waitFor(() => screen.getByText("Alpha Herd"));
    expect(screen.getByText("10% of your profit")).toBeTruthy();
    expect(screen.getByText("5% paid by the producer")).toBeTruthy();
  });

  test("an open lot has an Invest link, a fully subscribed lot does not", async () => {
    await load([
      makeLot(),
      feederLot({ tokensRemaining: 0, tokensSold: 10, canInvest: false }),
    ]);
    // fully subscribed lots are hidden until asked for
    await waitFor(() => screen.getByText("Alpha Herd"));
    expect(screen.queryByText("Beta Feeders")).toBeNull();
    const link = screen.getByRole("link", { name: "Invest" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/invest/herd-1");

    fireEvent.change(screen.getByLabelText("Availability"), { target: { value: "all" } });
    await waitFor(() => screen.getByText("Beta Feeders"));
    expect(screen.getByText("Fully subscribed")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Invest" })).toHaveLength(1);
  });

  test("shows what the investor already holds", async () => {
    await load([makeLot({ myTokens: 5 })]);
    await waitFor(() => screen.getByText("Alpha Herd"));
    expect(screen.getByText("5 tokens")).toBeTruthy();
  });

  test("filters by verified status", async () => {
    await load([makeLot({ name: "Verified Herd", verified: true }), feederLot({ name: "Plain Herd", verified: false })]);
    await waitFor(() => screen.getByText("Verified Herd"));
    fireEvent.change(screen.getByLabelText("Verified"), { target: { value: "VERIFIED" } });
    await waitFor(() => expect(screen.queryByText("Plain Herd")).toBeNull());
    expect(screen.getByText("Verified Herd")).toBeTruthy();
  });

  test("sorts by price per token, low to high", async () => {
    await load([
      makeLot({ name: "Pricey", pricePerToken: 5000 }),
      feederLot({ name: "Cheap", pricePerToken: 1000 }),
    ]);
    await waitFor(() => screen.getByText("Pricey"));
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "price_low" } });
    await waitFor(() => {
      const names = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
      expect(names[0]).toContain("Cheap");
      expect(names[1]).toContain("Pricey");
    });
  });

  test("shows 'No lots match' when search has no match, and Clear filters resets it", async () => {
    await load([makeLot()]);
    await waitFor(() => screen.getByText("Alpha Herd"));
    const search = screen.getByPlaceholderText(/search lots/i) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "zzz-no-match" } });
    await waitFor(() => expect(screen.getByText(/no lots match/i)).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: /clear filters/i })[0]);
    await waitFor(() => expect(search.value).toBe(""));
    expect(screen.getByText("Alpha Herd")).toBeTruthy();
  });

  test("says so when no lots are open at all", async () => {
    await load([]);
    await waitFor(() => expect(screen.getByText(/no lots are open to investors/i)).toBeTruthy());
  });

  test("always shows the retained ownership track as coming soon, with no lots in it", async () => {
    await load([makeLot()]);
    await waitFor(() => screen.getByText("Alpha Herd"));
    expect(screen.getByText(/coming soon: retained ownership/i)).toBeTruthy();
    expect(screen.getByText(/not open yet/i)).toBeTruthy();
  });

  test("shows an error state when the marketplace cannot load", async () => {
    vi.mocked(getMarketplace).mockRejectedValue(new Error("network"));
    render(<Wrapper><Holdings /></Wrapper>);
    await waitFor(() => expect(screen.getByText(/failed to load lots/i)).toBeTruthy());
  });
});
