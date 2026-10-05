import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminCostReview, AdminDisputes, CostReviewBanner } from "@/components/costs/AdminCostReview";
import { CostAlerts } from "@/components/costs/CostAlerts";
import { HerdOps } from "@/pages/HerdOps";
import type { CostReviewSummary, Dispute } from "@/lib/costReview";

vi.mock("@/lib/costReview", async () => {
  const actual = await vi.importActual<typeof import("@/lib/costReview")>("@/lib/costReview");
  return {
    ...actual,
    verifyCost: vi.fn(), flagCost: vi.fn(), resolveDispute: vi.fn(), getMyAlerts: vi.fn(),
    getDisputes: vi.fn(), getCostReviewSummary: vi.fn(),
  };
});
vi.mock("@/lib/feeSetup", async () => {
  const actual = await vi.importActual<typeof import("@/lib/feeSetup")>("@/lib/feeSetup");
  return { ...actual, getHerds: vi.fn() };
});
vi.mock("@/lib/herdOps", async () => {
  const actual = await vi.importActual<typeof import("@/lib/herdOps")>("@/lib/herdOps");
  return { ...actual, getSales: vi.fn(), getSaleDetail: vi.fn(), approveSale: vi.fn(), getHerdCosts: vi.fn(), getHerdLrp: vi.fn() };
});
import { verifyCost, flagCost, resolveDispute, getMyAlerts, getDisputes, getCostReviewSummary } from "@/lib/costReview";
import { getHerds } from "@/lib/feeSetup";
import { getSales, getSaleDetail, approveSale } from "@/lib/herdOps";

beforeEach(() => vi.clearAllMocks());

describe("admin verify and flag", () => {
  test("verify with no invoice needs a note", async () => {
    vi.mocked(verifyCost).mockResolvedValue({ message: "Cost verified." });
    const changed = vi.fn();
    render(<AdminCostReview expenseId="e1" hasInvoice={false} onChanged={changed} />);
    fireEvent.click(screen.getByText("Verify"));
    fireEvent.click(screen.getByText("Mark verified"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/no invoice on file/);
    expect(verifyCost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("How you checked this cost"), { target: { value: "Called Smith Feed" } });
    fireEvent.click(screen.getByText("Mark verified"));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(verifyCost).toHaveBeenCalledWith("e1", "Called Smith Feed");
  });
  test("verify with an invoice on file needs no note", async () => {
    vi.mocked(verifyCost).mockResolvedValue({ message: "Cost verified." });
    const changed = vi.fn();
    render(<AdminCostReview expenseId="e1" hasInvoice onChanged={changed} />);
    fireEvent.click(screen.getByText("Verify"));
    fireEvent.click(screen.getByText("Mark verified"));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(verifyCost).toHaveBeenCalledWith("e1", "");
  });
  test("flag needs a reason, and a server refusal is shown", async () => {
    vi.mocked(flagCost).mockRejectedValue(new Error("This herd's sale has been approved, so its costs are frozen."));
    render(<AdminCostReview expenseId="e1" hasInvoice onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText("Flag"));
    fireEvent.click(screen.getByText("Flag this cost"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/reason is required/);
    expect(flagCost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Why you are flagging this cost"), { target: { value: "Price is double" } });
    fireEvent.click(screen.getByText("Flag this cost"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/frozen/);
  });
});

describe("admin disputes", () => {
  const d = (over: Partial<Dispute> = {}): Dispute => ({
    disputeId: "d1", expenseId: "e1", cost: { category: "feed", amount: 5000, description: null }, note: "Looks doubled",
    status: "open", ownerResponse: "Two loads", ownerRespondedAt: null, resolutionNote: null, resolvedAt: null,
    createdAt: "2026-09-20T12:00:00Z", raisedByMe: false, raisedBy: "investor3", ...over,
  });
  test("shows who raised it and the owner's reply; a ruling needs a note", async () => {
    vi.mocked(resolveDispute).mockResolvedValue({ message: "Dispute upheld" });
    const changed = vi.fn();
    render(<AdminDisputes disputes={[d()]} onChanged={changed} />);
    expect(screen.getByText(/Raised by investor3/)).toBeTruthy();
    expect(screen.getByText(/Two loads/)).toBeTruthy();
    fireEvent.click(screen.getByText("Uphold (flags the cost)"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/few words/);
    expect(resolveDispute).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Your ruling"), { target: { value: "Invoice shows one load" } });
    fireEvent.click(screen.getByText("Uphold (flags the cost)"));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(resolveDispute).toHaveBeenCalledWith("d1", "upheld", "Invoice shows one load");
  });
  test("dismiss sends dismissed; ruled-on disputes have no form", async () => {
    vi.mocked(resolveDispute).mockResolvedValue({ message: "Dispute dismissed." });
    const { rerender } = render(<AdminDisputes disputes={[d()]} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Your ruling"), { target: { value: "Looks fine to me" } });
    fireEvent.click(screen.getByText("Dismiss"));
    await waitFor(() => expect(resolveDispute).toHaveBeenCalledWith("d1", "dismissed", "Looks fine to me"));
    rerender(<AdminDisputes disputes={[d({ status: "dismissed", resolutionNote: "Fine" })]} onChanged={vi.fn()} />);
    expect(screen.queryByLabelText("Your ruling")).toBeNull();
  });
});

const review = (over: Partial<CostReviewSummary> = {}): CostReviewSummary => ({
  byStatus: { unverified: 0, documented: 2, verified: 0, flagged: 0, system: 1 }, unverifiedAmount: 0, flaggedCosts: 0,
  duplicateInvoiceCosts: 0, openDisputes: 0, blocked: false, needsAcknowledgement: false, warnings: [], ...over,
});

describe("cost review banner", () => {
  test("clean, warned and blocked", () => {
    const { rerender } = render(<CostReviewBanner review={review()} />);
    expect(screen.getByText(/No open disputes, flags or duplicate invoices/)).toBeTruthy();
    rerender(<CostReviewBanner review={review({ warnings: ["1 cost(s) are flagged."] })} />);
    expect(screen.getByText("1 cost(s) are flagged.")).toBeTruthy();
    rerender(<CostReviewBanner review={review({ blocked: true, openDisputes: 2 })} />);
    expect(screen.getByText(/2 open disputes/)).toBeTruthy();
  });
});

describe("sale approval gate on Herd operations", () => {
  const sale = {
    saleId: "s1", herdId: "h1", herdName: "Test Herd", sellerUserId: "u", sellerSlug: "rancher10", buyerUserId: null,
    buyerSlug: null, buyerName: "Packer", grossAmount: 100000, lrpIndemnity: 0, lrpNote: null, proceedsTotal: 100000,
    headSold: 20, headLost: 0, liveWeightLbs: 26000, pricePerCwt: 200, saleDate: "2026-09-30", status: "pending_approval" as const,
    expensesTotal: null, netAmount: null, platformFeesTotal: null, feeTerms: null, submittedAt: "2026-09-30T12:00:00Z",
    decidedAt: null, decisionNote: null, buyerResponse: "none", buyerRespondedAt: null, buyerResponseNote: null,
    newHerdId: null, warnings: [],
  };
  async function openSale(rev: CostReviewSummary) {
    vi.mocked(getHerds).mockResolvedValue({ items: [] } as never);
    vi.mocked(getSales).mockResolvedValue([sale] as never);
    vi.mocked(getSaleDetail).mockResolvedValue({ sale, preview: { payouts: [] } } as never);
    vi.mocked(getCostReviewSummary).mockResolvedValue(rev);
    vi.mocked(getDisputes).mockResolvedValue({ herdId: "h1", disputes: [] });
    vi.mocked(approveSale).mockResolvedValue({ message: "ok", sale } as never);
    render(<MemoryRouter><HerdOps /></MemoryRouter>);
    fireEvent.click(await screen.findByText(/Test Herd - /));
    await screen.findByTestId("cost-review-banner");
  }
  const approveBtn = () => screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;

  test("open disputes block Approve", async () => {
    await openSale(review({ blocked: true, openDisputes: 1 }));
    expect(approveBtn().disabled).toBe(true);
    expect(screen.queryByText(/approve anyway/)).toBeNull();
  });
  test("warnings need the box ticked, and the tick is sent", async () => {
    await openSale(review({ needsAcknowledgement: true, flaggedCosts: 1, warnings: ["1 cost(s) are flagged."] }));
    expect(approveBtn().disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(approveBtn().disabled).toBe(false);
    fireEvent.click(approveBtn());
    await waitFor(() => expect(approveSale).toHaveBeenCalledWith("s1", undefined, true));
  });
  test("a clean review approves with no acknowledgement", async () => {
    await openSale(review());
    expect(approveBtn().disabled).toBe(false);
    fireEvent.click(approveBtn());
    await waitFor(() => expect(approveSale).toHaveBeenCalledWith("s1", undefined, false));
  });
});

describe("investor new-costs notice", () => {
  const alert = { herdId: "h1", herdName: "Test Herd", since: "2026-09-20T00:00:00Z", newCostCount: 2, newCostTotal: 3500, newWithoutInvoice: 1, myDisputesRuledOn: 1 };
  test("lists what is new with a link to the herd", async () => {
    vi.mocked(getMyAlerts).mockResolvedValue({ alerts: [alert] });
    render(<MemoryRouter><CostAlerts slug="investor1" /></MemoryRouter>);
    const box = await screen.findByTestId("cost-alerts");
    expect(box.textContent).toMatch(/2 new costs totalling \$3,500\.00/);
    expect(box.textContent).toMatch(/1 with no invoice/);
    expect(box.textContent).toMatch(/1 of your questions has been ruled on/);
    expect(screen.getByText("Review").getAttribute("href")).toBe("/investor/investor1/holdings/h1");
  });
  test("nothing shows when there is nothing new or the server refuses", async () => {
    vi.mocked(getMyAlerts).mockResolvedValue({ alerts: [] });
    const a = render(<MemoryRouter><CostAlerts slug="investor1" /></MemoryRouter>);
    await waitFor(() => expect(getMyAlerts).toHaveBeenCalled());
    expect(a.container.innerHTML).toBe("");
    a.unmount();
    vi.mocked(getMyAlerts).mockRejectedValue(new Error("403"));
    const b = render(<MemoryRouter><CostAlerts slug="investor1" /></MemoryRouter>);
    await waitFor(() => expect(getMyAlerts).toHaveBeenCalledTimes(2));
    expect(b.container.innerHTML).toBe("");
  });
});
