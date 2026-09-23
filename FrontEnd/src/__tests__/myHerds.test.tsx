import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MyHerds } from "@/pages/MyHerds";
import { herdStatus, checkInvestorPct, checkPrice, offerPreview } from "@/lib/rancherHerds";
import type { MyHerdRow, MyInvestmentsResult } from "@/lib/rancherHerds";

// the page calls these; the helpers (status, checks, preview math) stay real
vi.mock("@/lib/rancherHerds", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rancherHerds")>("@/lib/rancherHerds");
  return {
    ...actual,
    getMyHerds: vi.fn(),
    getMyInvestments: vi.fn(),
    getHerdFunds: vi.fn(),
    postOpenHerd: vi.fn(),
    postCloseHerd: vi.fn(),
  };
});
import { getMyHerds, getMyInvestments, getHerdFunds, postOpenHerd, postCloseHerd } from "@/lib/rancherHerds";
// the page also shows "My payouts" (pass 2); keep that from calling the network too
vi.mock("@/lib/rancherMoney", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rancherMoney")>("@/lib/rancherMoney");
  return { ...actual, getMyPayouts: vi.fn() };
});
import { getMyPayouts } from "@/lib/rancherMoney";

function herd(over: Partial<MyHerdRow>): MyHerdRow {
  return {
    herd_id: "00000000-0000-0000-0000-000000000000", herd_name: "Herd", cohort_label: null, breed_code: "AN",
    season: "Fall", dominant_stage: "RANCH", head_count: 20, listing_price: "40000.00",
    purchase_status: "pending", feedlot_status: "pending", investor_pct: null,
    created_at: "2026-09-22T20:12:20Z", last_updated: null, cattle_count: 20, ...over,
  };
}

const rows: MyHerdRow[] = [
  herd({ herd_id: "aaaaaaaa-1111-0000-0000-000000000000", herd_name: "Not Open Herd" }),
  herd({
    herd_id: "bbbbbbbb-2222-0000-0000-000000000000", herd_name: "Open No Buyers",
    feedlot_status: "listed", purchase_status: "available", investor_pct: "50.00", dominant_stage: "FEEDLOT",
  }),
  herd({
    herd_id: "cccccccc-3333-0000-0000-000000000000", herd_name: "Open With Buyers",
    feedlot_status: "listed", purchase_status: "available", investor_pct: "50.00",
  }),
  herd({ herd_id: "dddddddd-4444-0000-0000-000000000000", herd_name: "Half Built", cattle_count: 0 }),
];

const invs: MyInvestmentsResult = {
  rancherId: "r1",
  items: [
    { herdId: rows[1].herd_id, herdName: "", listingPrice: 40000, headCount: 20, poolId: "p2", totalSupply: 20, tokensSold: 0, investorCount: 0, estimatedCapitalRaised: 0 },
    { herdId: rows[2].herd_id, herdName: "", listingPrice: 40000, headCount: 20, poolId: "p3", totalSupply: 20, tokensSold: 3, investorCount: 2, estimatedCapitalRaised: 6000 },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/rancher"]}>
      <Routes>
        <Route path="/rancher" element={<MyHerds />} />
      </Routes>
    </MemoryRouter>
  );
}

function card(name: string) {
  const title = screen.getByText(name);
  return title.closest("[data-testid='herd-card']") as HTMLElement;
}

describe("My Herds helpers", () => {
  test("status from the two herd flags", () => {
    expect(herdStatus({ feedlot_status: "pending", purchase_status: "pending" })).toBe("not_open");
    expect(herdStatus({ feedlot_status: "listed", purchase_status: "available" })).toBe("open");
    expect(herdStatus({ feedlot_status: "listed", purchase_status: "sold" })).toBe("fully_funded");
    expect(herdStatus({ feedlot_status: "sold", purchase_status: "sold" })).toBe("sold");
  });

  test("percent and price checks", () => {
    expect(checkInvestorPct("")).toMatch(/enter/i);
    expect(checkInvestorPct("150")).toMatch(/at most 100/);
    expect(checkInvestorPct("12.345")).toMatch(/2 decimal/);
    expect(checkInvestorPct("50")).toBeNull();
    expect(checkPrice("0")).toMatch(/greater than 0/);
    expect(checkPrice("40000")).toBeNull();
  });

  test("preview uses the server's rounding", () => {
    expect(offerPreview(40000, 20, 50)).toEqual({ totalShares: 20, allocation: 10, pricePerShare: 2000, maxRaise: 20000 });
    // $100 over 3 head: $33.33 a share, most you can raise rounds down
    expect(offerPreview(100, 3, 100)).toEqual({ totalShares: 3, allocation: 3, pricePerShare: 33.33, maxRaise: 100 });
    expect(offerPreview(100, 3, 50)).toEqual({ totalShares: 3, allocation: 1, pricePerShare: 33.33, maxRaise: 33.33 });
  });
});

describe("My Herds page", () => {
  beforeEach(() => {
    vi.mocked(getMyHerds).mockReset().mockResolvedValue(rows);
    vi.mocked(getMyInvestments).mockReset().mockResolvedValue(invs);
    vi.mocked(getHerdFunds).mockReset().mockResolvedValue({
      herdId: rows[2].herd_id,
      funds: { raised: 6000, released: 1000, available: 5000, paymentCount: 2, releaseCount: 1 },
    });
    vi.mocked(postOpenHerd).mockReset();
    vi.mocked(postCloseHerd).mockReset();
    vi.mocked(getMyPayouts).mockReset().mockResolvedValue([]);
  });

  test("lists every herd with its status and numbers", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Not Open Herd")).toBeTruthy());
    expect(within(card("Not Open Herd")).getByText("Not open to investors")).toBeTruthy();
    expect(within(card("Open No Buyers")).getByText("Open to investors")).toBeTruthy();
    expect(within(card("Open No Buyers")).getByText("Feedlot")).toBeTruthy();
    const buyers = card("Open With Buyers");
    expect(within(buyers).getByText("3 of 10")).toBeTruthy();
    expect(within(buyers).getByText(/2 investors/)).toBeTruthy();
    expect(within(buyers).getByText(/\$1,000\.00 released/)).toBeTruthy();
    // funds are only fetched for the herd that has buyers
    expect(getHerdFunds).toHaveBeenCalledTimes(1);
    expect(getHerdFunds).toHaveBeenCalledWith(rows[2].herd_id);
    // pass 2: the payouts card is on the page
    await waitFor(() => expect(screen.getByText(/No payouts yet/)).toBeTruthy());
    expect(getMyPayouts).toHaveBeenCalled();
  });

  test("buttons match what each herd allows", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Not Open Herd")).toBeTruthy());
    expect(within(card("Not Open Herd")).getByRole("button", { name: "Open to Investors" })).toBeTruthy();
    expect(within(card("Open No Buyers")).getByRole("button", { name: "Close to Investors" })).toBeTruthy();
    expect(within(card("Open With Buyers")).queryByRole("button", { name: "Close to Investors" })).toBeNull();
    expect(within(card("Open With Buyers")).getByText(/can't be closed/)).toBeTruthy();
    expect(within(card("Half Built")).queryByRole("button", { name: "Open to Investors" })).toBeNull();
    expect(within(card("Half Built")).getByText(/No cattle uploaded/)).toBeTruthy();
    const stages = within(card("Open No Buyers")).getByRole("link", { name: /Herd Stages/ });
    expect(stages.getAttribute("href")).toBe(`/rancher/stages?herd=${rows[1].herd_id}`);
  });

  test("open to investors: checks, preview, then sends percent and price", async () => {
    vi.mocked(postOpenHerd).mockResolvedValue({
      message: 'Herd "Not Open Herd" is open to investors: 50% offered.',
      herd: { herdId: rows[0].herd_id, herdName: "Not Open Herd", investorPct: 50, listingPrice: 40000 },
      offering: { totalSupply: 20, investorAllocation: 10, pricePerToken: 2000, maxRaise: 20000 },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Not Open Herd")).toBeTruthy());
    const c = card("Not Open Herd");
    fireEvent.click(within(c).getByRole("button", { name: "Open to Investors" }));
    // empty percent -> error, nothing sent
    fireEvent.click(within(c).getByRole("button", { name: "Open to Investors" }));
    expect(within(c).getByRole("alert").textContent).toMatch(/Enter the percent/);
    expect(postOpenHerd).not.toHaveBeenCalled();
    // typing clears the error and shows the preview
    fireEvent.change(within(c).getByLabelText(/Percent offered/), { target: { value: "50" } });
    expect(within(c).queryByRole("alert")).toBeNull();
    expect(within(c).getByText("10 of 20")).toBeTruthy();
    expect(within(c).getByText("$20,000.00")).toBeTruthy();
    fireEvent.click(within(c).getByRole("button", { name: "Open to Investors" }));
    await waitFor(() => expect(postOpenHerd).toHaveBeenCalledWith(rows[0].herd_id, 50, 40000));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/open to investors: 50%/));
    expect(getMyHerds).toHaveBeenCalledTimes(2); // reloaded after the change
  });

  test("open to investors: a server error shows on the herd", async () => {
    vi.mocked(postOpenHerd).mockRejectedValue(new Error("This herd is already open to investors."));
    renderPage();
    await waitFor(() => expect(screen.getByText("Not Open Herd")).toBeTruthy());
    const c = card("Not Open Herd");
    fireEvent.click(within(c).getByRole("button", { name: "Open to Investors" }));
    fireEvent.change(within(c).getByLabelText(/Percent offered/), { target: { value: "50" } });
    fireEvent.click(within(c).getByRole("button", { name: "Open to Investors" }));
    await waitFor(() => expect(within(c).getByRole("alert").textContent).toMatch(/already open/));
  });

  test("close to investors asks first", async () => {
    vi.mocked(postCloseHerd).mockResolvedValue({ message: 'Herd "Open No Buyers" is closed to investors.', herdId: rows[1].herd_id });
    renderPage();
    await waitFor(() => expect(screen.getByText("Open No Buyers")).toBeTruthy());
    const c = card("Open No Buyers");
    fireEvent.click(within(c).getByRole("button", { name: "Close to Investors" }));
    expect(postCloseHerd).not.toHaveBeenCalled();
    fireEvent.click(within(c).getByRole("button", { name: /Yes, close/ }));
    await waitFor(() => expect(postCloseHerd).toHaveBeenCalledWith(rows[1].herd_id));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/closed to investors/));
  });

  test("no herds yet shows a Post a Lot link", async () => {
    vi.mocked(getMyHerds).mockResolvedValue([]);
    vi.mocked(getMyInvestments).mockResolvedValue({ rancherId: "r1", items: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText(/haven't posted any lots/)).toBeTruthy());
    expect(screen.getByRole("link", { name: /Post your first lot/ }).getAttribute("href")).toBe("/rancher/new");
  });

  test("a load failure is shown", async () => {
    vi.mocked(getMyHerds).mockRejectedValue(new Error("Failed to fetch rancher herds."));
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Failed to fetch rancher herds/));
  });
});
