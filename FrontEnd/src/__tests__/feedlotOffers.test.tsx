import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, type CurrentUser } from "@/context/AuthContext";
import { MyHerds } from "@/pages/MyHerds";
import { herdBaseFor } from "@/lib/herdBase";
import { offerState } from "@/lib/rancherMoney";
import type { Sale } from "@/lib/rancherMoney";
import type { MyHerdRow } from "@/lib/rancherHerds";

// Fix #14 (tracker FD-A1 / FD-A2): a feedlot's My Herds page, with the card of
// offers to buy a herd (accept / decline) and links under /feedlot.

vi.mock("@/lib/rancherHerds", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rancherHerds")>("@/lib/rancherHerds");
  return { ...actual, getMyHerds: vi.fn(), getMyInvestments: vi.fn(), getHerdFunds: vi.fn() };
});
import { getMyHerds, getMyInvestments } from "@/lib/rancherHerds";

vi.mock("@/lib/rancherMoney", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rancherMoney")>("@/lib/rancherMoney");
  return { ...actual, getMyPayouts: vi.fn(), getMySales: vi.fn(), acceptSale: vi.fn(), declineSale: vi.fn() };
});
import { getMyPayouts, getMySales, acceptSale, declineSale } from "@/lib/rancherMoney";

const FEEDLOT: CurrentUser = { userId: "u-feedlot", slug: "feeder-test", role: "feedlot", email: "f@x.dev", token: "t" };
const RANCHER: CurrentUser = { userId: "u-rancher", slug: "rancher1", role: "rancher", email: "r@x.dev", token: "t" };

function sale(over: Partial<Sale>): Sale {
  return {
    saleId: "s1", herdId: "h1", herdName: "Angus Prime Herd A",
    sellerUserId: "u-rancher", sellerSlug: "rancher1", buyerUserId: "u-feedlot", buyerSlug: "feeder-test", buyerName: null,
    grossAmount: 90000, lrpIndemnity: 0, lrpNote: null, proceedsTotal: 90000,
    headSold: 40, headLost: 0, liveWeightLbs: 30000, pricePerCwt: 300, saleDate: "2026-09-24",
    status: "pending_approval", expensesTotal: null, netAmount: null, platformFeesTotal: null, feeTerms: null,
    submittedAt: "2026-09-24T18:00:00Z", decidedAt: null, decisionNote: null,
    buyerResponse: "waiting", buyerRespondedAt: null, buyerResponseNote: null, newHerdId: null, warnings: [],
    ...over,
  };
}

function herd(over: Partial<MyHerdRow>): MyHerdRow {
  return {
    herd_id: "aaaaaaaa-1111-0000-0000-000000000000", herd_name: "Finishing Herd", cohort_label: null, breed_code: "AN",
    season: "Fall", dominant_stage: "FEEDLOT", head_count: 40, listing_price: "90000.00",
    purchase_status: "pending", feedlot_status: "pending", investor_pct: null,
    created_at: "2026-09-24T20:00:00Z", last_updated: null, cattle_count: 40, ...over,
  };
}

function renderAs(user: CurrentUser, path: string) {
  localStorage.setItem("cattlecoin_user", JSON.stringify(user));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/feedlot" element={<MyHerds />} />
          <Route path="/rancher" element={<MyHerds />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getMyHerds).mockReset().mockResolvedValue([]);
  vi.mocked(getMyInvestments).mockReset().mockResolvedValue({ rancherId: "u-feedlot", items: [] } as never);
  vi.mocked(getMyPayouts).mockReset().mockResolvedValue([]);
  vi.mocked(getMySales).mockReset().mockResolvedValue([]);
  vi.mocked(acceptSale).mockReset();
  vi.mocked(declineSale).mockReset();
});

describe("offerState", () => {
  test("null when the sale was not sent to this person", () => {
    expect(offerState(sale({}), "u-someone-else")).toBeNull();
    expect(offerState(sale({}), null)).toBeNull();
    expect(offerState(sale({ buyerUserId: null }), "u-feedlot")).toBeNull();
  });

  test("every state a sale can be in for the buyer", () => {
    expect(offerState(sale({}), "u-feedlot")).toBe("answer");
    expect(offerState(sale({ buyerResponse: "accepted" }), "u-feedlot")).toBe("accepted");
    expect(offerState(sale({ status: "approved", buyerResponse: "accepted" }), "u-feedlot")).toBe("approved");
    expect(offerState(sale({ status: "cancelled" }), "u-feedlot")).toBe("cancelled");
    expect(offerState(sale({ status: "rejected", buyerResponse: "declined" }), "u-feedlot")).toBe("declined");
    expect(offerState(sale({ status: "rejected", buyerResponse: "accepted" }), "u-feedlot")).toBe("rejected");
  });
});

describe("herdBaseFor", () => {
  test("/feedlot for a feedlot, /rancher for everyone else", () => {
    expect(herdBaseFor("feedlot")).toBe("/feedlot");
    expect(herdBaseFor("rancher")).toBe("/rancher");
    expect(herdBaseFor(undefined)).toBe("/rancher");
    expect(herdBaseFor(null)).toBe("/rancher");
  });
});

describe("a feedlot's offers to buy a herd", () => {
  test("shows the deal and no seller-side split", async () => {
    vi.mocked(getMySales).mockResolvedValue([sale({})]);
    renderAs(FEEDLOT, "/feedlot");
    const offer = await screen.findByTestId("offer-card");
    expect(within(offer).getByText("Angus Prime Herd A")).toBeTruthy();
    expect(within(offer).getByText(/From rancher1/)).toBeTruthy();
    expect(within(offer).getByText("$90,000.00")).toBeTruthy();
    expect(within(offer).getByText("40 head")).toBeTruthy();
    expect(within(offer).getByText("30,000 lb")).toBeTruthy();
    expect(within(offer).getByText("$300.00")).toBeTruthy();
    expect(within(offer).getByText("Needs your answer")).toBeTruthy();
    expect(within(offer).queryByText(/investor/i)).toBeNull();
    expect(within(offer).queryByText(/platform fee/i)).toBeNull();
  });

  test("accept asks first, then sends the answer and reloads the list", async () => {
    vi.mocked(getMySales).mockResolvedValue([sale({})]);
    vi.mocked(acceptSale).mockResolvedValue({ message: "You accepted this sale. It now waits for admin approval.", sale: sale({ buyerResponse: "accepted" }) });
    renderAs(FEEDLOT, "/feedlot");
    fireEvent.click(await screen.findByRole("button", { name: "Accept sale" }));

    // the confirm names the herd and the price; nothing has been sent yet
    expect(screen.getByText(/Buy 40 head of Angus Prime Herd A for \$90,000\.00\?/)).toBeTruthy();
    expect(acceptSale).not.toHaveBeenCalled();

    vi.mocked(getMySales).mockResolvedValue([sale({ buyerResponse: "accepted" })]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, accept" }));
    await waitFor(() => expect(acceptSale).toHaveBeenCalledWith("s1", undefined));
    expect((await screen.findByRole("status")).textContent).toMatch(/You accepted this sale/);
    // reloaded: now shown as waiting on CattleCoin, with no buttons
    await waitFor(() => expect(screen.getByText("Accepted - waiting for CattleCoin")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Accept sale" })).toBeNull();
  });

  test("decline sends the note and closes the offer", async () => {
    vi.mocked(getMySales).mockResolvedValue([sale({})]);
    vi.mocked(declineSale).mockResolvedValue({ message: "You declined this sale. The herd is back to its previous status.", sale: sale({ status: "rejected", buyerResponse: "declined" }) });
    renderAs(FEEDLOT, "/feedlot");
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    expect(declineSale).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "  too far to haul  " } });

    vi.mocked(getMySales).mockResolvedValue([sale({ status: "rejected", buyerResponse: "declined" })]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, decline" }));
    await waitFor(() => expect(declineSale).toHaveBeenCalledWith("s1", "too far to haul"));
    await waitFor(() => expect(screen.getByText("You declined")).toBeTruthy());
  });

  test("Cancel backs out without sending anything", async () => {
    vi.mocked(getMySales).mockResolvedValue([sale({})]);
    renderAs(FEEDLOT, "/feedlot");
    fireEvent.click(await screen.findByRole("button", { name: "Accept sale" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Accept sale" })).toBeTruthy();
    expect(acceptSale).not.toHaveBeenCalled();
    expect(declineSale).not.toHaveBeenCalled();
  });

  test("a refused answer shows the server's message and leaves the buttons usable", async () => {
    vi.mocked(getMySales).mockResolvedValue([sale({})]);
    vi.mocked(acceptSale).mockRejectedValue(new Error("Sale is already cancelled."));
    renderAs(FEEDLOT, "/feedlot");
    fireEvent.click(await screen.findByRole("button", { name: "Accept sale" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, accept" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/already cancelled/);
    expect((screen.getByRole("button", { name: "Yes, accept" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("only sales sent to this feedlot show up, and an approved one says the herd is in My Herds", async () => {
    vi.mocked(getMySales).mockResolvedValue([
      sale({ saleId: "mine", herdName: "Sent To Me" }),
      sale({ saleId: "other", herdName: "Sent To Someone Else", buyerUserId: "u-other" }),
      sale({ saleId: "sold", herdName: "I Am The Seller", sellerUserId: "u-feedlot", buyerUserId: "u-packer" }),
      sale({ saleId: "done", herdName: "Bought Last Week", status: "approved", buyerResponse: "accepted", newHerdId: "n1" }),
    ]);
    renderAs(FEEDLOT, "/feedlot");
    await screen.findByText("Sent To Me");
    expect(screen.queryByText("Sent To Someone Else")).toBeNull();
    expect(screen.queryByText("I Am The Seller")).toBeNull();
    const done = screen.getByText("Bought Last Week").closest("[data-testid='offer-card']") as HTMLElement;
    expect(within(done).getByText("Approved - in My Herds")).toBeTruthy();
    expect(within(done).queryByRole("button", { name: "Accept sale" })).toBeNull();
  });

  test("with no offers the card says so", async () => {
    renderAs(FEEDLOT, "/feedlot");
    expect(await screen.findByText("No offers waiting on you right now.")).toBeTruthy();
  });
});

describe("a feedlot's herd list", () => {
  test("links stay under /feedlot", async () => {
    vi.mocked(getMyHerds).mockResolvedValue([herd({}), herd({ herd_id: "bbbbbbbb-2222-0000-0000-000000000000", herd_name: "Half Built", cattle_count: 0 })]);
    renderAs(FEEDLOT, "/feedlot");
    await screen.findByText("Finishing Herd");
    expect(screen.getByRole("link", { name: /Post a Lot/ }).getAttribute("href")).toBe("/feedlot/new");
    const stages = screen.getAllByRole("link", { name: /Herd Stages/ });
    expect(stages[0].getAttribute("href")).toBe("/feedlot/stages?herd=aaaaaaaa-1111-0000-0000-000000000000");
    expect(screen.getByRole("link", { name: "Upload cattle to finish it" }).getAttribute("href"))
      .toBe("/feedlot/new?herd=bbbbbbbb-2222-0000-0000-000000000000");
    expect(screen.getByText("Every herd you own, where it stands, and what investors have put in.")).toBeTruthy();
  });

  test("no herds yet explains how one arrives", async () => {
    renderAs(FEEDLOT, "/feedlot");
    expect(await screen.findByText(/accept an offer to buy it/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Post your first lot/ }).getAttribute("href")).toBe("/feedlot/new");
  });
});

describe("a rancher's page is unchanged", () => {
  test("no offers card, no sales call, links stay under /rancher", async () => {
    vi.mocked(getMyHerds).mockResolvedValue([herd({})]);
    renderAs(RANCHER, "/rancher");
    await screen.findByText("Finishing Herd");
    expect(screen.queryByTestId("incoming-offers")).toBeNull();
    expect(getMySales).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Post a Lot/ }).getAttribute("href")).toBe("/rancher/new");
    expect(screen.getAllByRole("link", { name: /Herd Stages/ })[0].getAttribute("href")).toMatch(/^\/rancher\/stages\?herd=/);
  });
});
