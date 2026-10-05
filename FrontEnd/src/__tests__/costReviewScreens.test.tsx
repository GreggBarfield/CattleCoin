import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HerdMoneyCards } from "@/components/pool/HerdMoneyCards";
import { HerdMoneyPanel } from "@/components/rancher/HerdMoneyPanel";
import type { Expense } from "@/lib/rancherMoney";

vi.mock("@/lib/money", async () => {
  const actual = await vi.importActual<typeof import("@/lib/money")>("@/lib/money");
  return { ...actual, getMyMoney: vi.fn(), getHerdCosts: vi.fn(), getHerdLrp: vi.fn() };
});
vi.mock("@/lib/costReview", async () => {
  const actual = await vi.importActual<typeof import("@/lib/costReview")>("@/lib/costReview");
  return { ...actual, getDisputes: vi.fn(), markCostsSeen: vi.fn(), disputeCost: vi.fn() };
});
vi.mock("@/lib/rancherMoney", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rancherMoney")>("@/lib/rancherMoney");
  return { ...actual, getCosts: vi.fn(), getLrp: vi.fn(), getMySales: vi.fn(), getFeedlots: vi.fn() };
});
vi.mock("@/lib/rancherHerds", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rancherHerds")>("@/lib/rancherHerds");
  return { ...actual, getHerdFunds: vi.fn() };
});
import { getMyMoney, getHerdCosts, getHerdLrp } from "@/lib/money";
import { getDisputes, markCostsSeen } from "@/lib/costReview";
import { getCosts, getLrp, getMySales } from "@/lib/rancherMoney";
import { getHerdFunds } from "@/lib/rancherHerds";

const exp = (over: Partial<Expense> = {}): Expense => ({
  expenseId: "e1", herdId: "h1", category: "feed", description: "hay", amount: 1250, accruedDate: "2026-09-20",
  billingDirection: "self", source: "manual", status: "active", lrpPolicyId: null, createdBy: "rancher10",
  createdAt: "2026-09-20T12:00:00Z", voidedAt: null, voidReason: null, canChange: true, changeNeedsReason: false,
  vendorName: "Smith Feed", invoiceNumber: "10442", verificationStatus: "documented",
  documents: [{ docId: "d1", filename: "inv.pdf", contentType: "application/pdf", sizeBytes: 2048, uploadedAt: "2026-09-20T12:00:00Z" }],
  signals: [{ code: "duplicate_invoice_number", label: "The same vendor and invoice number appear on another cost" }],
  openDisputes: 0, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDisputes).mockResolvedValue({ herdId: "h1", disputes: [] });
  vi.mocked(markCostsSeen).mockResolvedValue({ message: "ok" });
  vi.mocked(getHerdLrp).mockResolvedValue({ policies: [] });
});

describe("investor herd costs", () => {
  const mine = (sale: unknown = null) => ({ herds: [{ herdId: "h1", paidIn: 5000, state: "open", sale, payout: null }] });
  function show() {
    return render(<MemoryRouter><HerdMoneyCards herdId="h1" slug="inv1" /></MemoryRouter>);
  }
  const costsResp = (rows: Expense[]) => ({ total: 1250, byCategory: { feed: 1250 }, expenses: rows });

  test("an investor sees the badge, vendor, invoice and warnings, can question it, and the alert is cleared", async () => {
    vi.mocked(getMyMoney).mockResolvedValue(mine() as never);
    vi.mocked(getHerdCosts).mockResolvedValue(costsResp([exp()]) as never);
    show();
    fireEvent.click(await screen.findByText("Every cost, by date"));
    expect(screen.getByTestId("verification-badge").textContent).toBe("Invoice attached");
    expect(screen.getByText(/Smith Feed, invoice 10442/)).toBeTruthy();
    expect(screen.getByText("inv.pdf (2 KB)")).toBeTruthy();
    expect(screen.getByText(/same vendor and invoice number/)).toBeTruthy();
    expect(screen.getByText("Question this cost")).toBeTruthy();
    await waitFor(() => expect(markCostsSeen).toHaveBeenCalledWith("h1"));
  });

  test("system-booked costs show no badge or question link", async () => {
    vi.mocked(getMyMoney).mockResolvedValue(mine() as never);
    vi.mocked(getHerdCosts).mockResolvedValue(costsResp([exp({ source: "purchase", verificationStatus: "system", documents: [], signals: [] })]) as never);
    show();
    fireEvent.click(await screen.findByText("Every cost, by date"));
    expect(screen.queryByTestId("verification-badge")).toBeNull();
    expect(screen.queryByText("Question this cost")).toBeNull();
  });

  test("no question link once the sale is approved", async () => {
    vi.mocked(getMyMoney).mockResolvedValue(mine({ saleId: "s1", status: "approved" }) as never);
    vi.mocked(getHerdCosts).mockResolvedValue(costsResp([exp()]) as never);
    show();
    fireEvent.click(await screen.findByText("Every cost, by date"));
    expect(screen.queryByText("Question this cost")).toBeNull();
  });

  test("a visitor who holds no stake sees evidence but cannot question or mark seen", async () => {
    vi.mocked(getMyMoney).mockResolvedValue({ herds: [] } as never);
    vi.mocked(getHerdCosts).mockResolvedValue(costsResp([exp()]) as never);
    show();
    fireEvent.click(await screen.findByText("Every cost, by date"));
    expect(screen.getByTestId("verification-badge")).toBeTruthy();
    expect(screen.queryByText("Question this cost")).toBeNull();
    expect(markCostsSeen).not.toHaveBeenCalled();
  });

  test("my own questions and their status are listed", async () => {
    vi.mocked(getMyMoney).mockResolvedValue(mine() as never);
    vi.mocked(getHerdCosts).mockResolvedValue(costsResp([exp()]) as never);
    vi.mocked(getDisputes).mockResolvedValue({ herdId: "h1", disputes: [{
      disputeId: "d1", expenseId: "e1", cost: { category: "feed", amount: 1250, description: null }, note: "x y z w v",
      status: "upheld", ownerResponse: null, ownerRespondedAt: null, resolutionNote: "Cost was doubled", resolvedAt: null,
      createdAt: "2026-09-21T00:00:00Z", raisedByMe: true,
    }] });
    show();
    const box = await screen.findByTestId("my-disputes");
    expect(box.textContent).toMatch(/CattleCoin agreed/);
    expect(box.textContent).toMatch(/Cost was doubled/);
  });
});

describe("rancher costs tab", () => {
  const costs = (rows: Expense[], saleState: string | null = null) => ({
    herd: { herdId: "h1", herdName: "Test Herd", investorsHaveBought: true, saleState },
    viewer: "owner" as const, total: 1250, byCategory: { feed: 1250 }, expenses: rows,
  });
  function open() {
    vi.mocked(getHerdFunds).mockResolvedValue({ herdId: "h1", funds: { raised: 0, released: 0, available: 0, paymentCount: 0, releaseCount: 0 } });
    vi.mocked(getLrp).mockResolvedValue({ herd: { herdId: "h1", herdName: "T" }, note: "", policies: [] });
    vi.mocked(getMySales).mockResolvedValue([]);
    return render(<HerdMoneyPanel herd={{ herd_id: "h1", herd_name: "Test Herd", head_count: 20 }} onHerdChanged={vi.fn()} />);
  }

  test("shows the status, evidence and an attach button on a manual cost", async () => {
    vi.mocked(getCosts).mockResolvedValue(costs([exp({ verificationStatus: "unverified", documents: [], signals: [{ code: "no_invoice", label: "No invoice or receipt on file" }] })]));
    open();
    await waitFor(() => expect(screen.getByTestId("cost-row")).toBeTruthy());
    expect(screen.getByTestId("verification-badge").textContent).toBe("No invoice yet");
    expect(screen.getByText("Attach invoice")).toBeTruthy();
    expect(screen.getByText(/Paid to Smith Feed, invoice 10442/)).toBeTruthy();
  });

  test("no attach button once the sale is approved, and none on system costs", async () => {
    vi.mocked(getCosts).mockResolvedValue(costs([exp(), exp({ expenseId: "e2", source: "purchase", verificationStatus: "system" })], "approved"));
    open();
    await waitFor(() => expect(screen.getAllByTestId("cost-row").length).toBe(2));
    expect(screen.queryByText("Attach invoice")).toBeNull();
  });

  test("the owner sees investors' questions on this herd", async () => {
    vi.mocked(getCosts).mockResolvedValue(costs([exp()]));
    vi.mocked(getDisputes).mockResolvedValue({ herdId: "h1", disputes: [{
      disputeId: "d1", expenseId: "e1", cost: { category: "feed", amount: 1250, description: null }, note: "Looks doubled",
      status: "open", ownerResponse: null, ownerRespondedAt: null, resolutionNote: null, resolvedAt: null,
      createdAt: "2026-09-21T00:00:00Z", raisedByMe: false,
    }] });
    open();
    expect(await screen.findByTestId("owner-disputes")).toBeTruthy();
    expect(screen.getByText(/Looks doubled/)).toBeTruthy();
  });
});
