import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { HerdMoneyPanel } from "@/components/rancher/HerdMoneyPanel";
import { MyPayouts } from "@/components/rancher/MyPayouts";
import {
  loadPriceCents, salePriceCents, checkSale, checkLrp, checkCost, lrpChanges, shortDate, EMPTY_SALE, EMPTY_LRP,
} from "@/lib/rancherMoney";
import type { HerdCosts, Expense, Sale, SaleDetail, MyPayout } from "@/lib/rancherMoney";

// the panel calls these; the helpers (checks, price math, labels) stay real
vi.mock("@/lib/rancherMoney", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rancherMoney")>("@/lib/rancherMoney");
  return {
    ...actual,
    getCosts: vi.fn(), postCost: vi.fn(), patchCost: vi.fn(), voidCost: vi.fn(),
    getLrp: vi.fn(), postLrp: vi.fn(), putLrp: vi.fn(),
    getMySales: vi.fn(), getSale: vi.fn(), postSale: vi.fn(), cancelSale: vi.fn(), getFeedlots: vi.fn(),
    getMyPayouts: vi.fn(),
  };
});
vi.mock("@/lib/rancherHerds", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rancherHerds")>("@/lib/rancherHerds");
  return { ...actual, getHerdFunds: vi.fn() };
});
import {
  getCosts, postCost, voidCost, getLrp, getMySales, getSale, postSale, cancelSale, getMyPayouts,
} from "@/lib/rancherMoney";
import { getHerdFunds } from "@/lib/rancherHerds";

const HERD = { herd_id: "h1", herd_name: "Test Herd", head_count: 20 };

function expense(over: Partial<Expense>): Expense {
  return {
    expenseId: "e1", herdId: "h1", category: "feed", description: "hay", amount: 1250, accruedDate: "2026-09-20",
    billingDirection: "self", source: "manual", status: "active", lrpPolicyId: null, createdBy: "rancher10",
    createdAt: "2026-09-20T12:00:00Z", voidedAt: null, voidReason: null, canChange: true, changeNeedsReason: false, ...over,
  };
}

function costs(over: Partial<HerdCosts["herd"]> = {}, rows: Expense[] = [expense({})]): HerdCosts {
  return {
    herd: { herdId: "h1", herdName: "Test Herd", investorsHaveBought: false, saleState: null, ...over },
    viewer: "owner", total: rows.filter((r) => r.status === "active").reduce((s, r) => s + r.amount, 0),
    byCategory: { feed: 1250 }, expenses: rows,
  };
}

function sale(over: Partial<Sale> = {}): Sale {
  return {
    saleId: "s1", herdId: "h1", herdName: "Test Herd", sellerUserId: "r", sellerSlug: "rancher10", buyerUserId: null,
    buyerSlug: null, buyerName: "Packer Co", grossAmount: 52000, lrpIndemnity: 0, lrpNote: null, proceedsTotal: 52000,
    headSold: 20, headLost: 0, liveWeightLbs: 26000, pricePerCwt: 200, saleDate: "2026-09-23", status: "pending_approval",
    expensesTotal: null, netAmount: null, platformFeesTotal: null, feeTerms: null, submittedAt: "2026-09-23T12:00:00Z",
    decidedAt: null, decisionNote: null, buyerResponse: "not_required", buyerRespondedAt: null, buyerResponseNote: null,
    newHerdId: null, warnings: [], ...over,
  };
}

const PREVIEW: SaleDetail = {
  sale: sale(),
  preview: {
    grossAmount: 52000, salePrice: 52000, lrpIndemnity: 0, selfBilledExpenses: 43000, serviceBilledExpenses: 0,
    expensesTotal: 43000, netAmount: 9000, profit: 9000, investorCapitalReturned: 8000, totalSupply: 20, investorTokens: 4,
    feeTermsApplied: true, platformFeesTotal: 0, warnings: [],
    payouts: [
      { recipientType: "owner", userId: "r", slug: "rancher10", tokens: 0, sharePct: null, amount: 42200 },
      { recipientType: "investor", userId: "i", slug: "investor9", tokens: 4, sharePct: 20, amount: 9800 },
    ],
  },
};

function funds(available = 0) {
  return { herdId: "h1", funds: { raised: 0, released: 0, available, paymentCount: 0, releaseCount: 0 } };
}

function setup(opts: { c?: HerdCosts; sales?: Sale[]; available?: number } = {}) {
  vi.mocked(getCosts).mockResolvedValue(opts.c ?? costs());
  vi.mocked(getLrp).mockResolvedValue({ herd: { herdId: "h1", herdName: "Test Herd" }, note: "", policies: [] });
  vi.mocked(getMySales).mockResolvedValue(opts.sales ?? []);
  vi.mocked(getHerdFunds).mockResolvedValue(funds(opts.available ?? 0));
  vi.mocked(getSale).mockResolvedValue(PREVIEW);
}

const onHerdChanged = vi.fn();
const panel = () => render(<HerdMoneyPanel herd={HERD} onHerdChanged={onHerdChanged} />);

describe("rancher money helpers", () => {
  test("load price uses whole-cent math like the server", () => {
    expect(loadPriceCents("27500", "245.50")).toBe(6751250);
    expect(loadPriceCents("26000", "200")).toBe(5200000);
    expect(loadPriceCents("1.01", "0.5")).toBe(1); // 0.505 cents rounds to 1
    expect(loadPriceCents("", "200")).toBeNull();
    expect(salePriceCents({ ...EMPTY_SALE, priceKind: "total", grossAmount: "52000.10" })).toBe(5200010);
  });

  test("sale checks", () => {
    const base = { ...EMPTY_SALE, buyerName: "Packer", headSold: "20", liveWeightLbs: "26000", pricePerCwt: "200" };
    expect(checkSale({ ...EMPTY_SALE }, 20, false)).toMatch(/who bought/);
    expect(checkSale(base, 20, false)).toBeNull();
    expect(checkSale({ ...base, headLost: "1" }, 20, false)).toMatch(/more than this herd's 20 head/);
    expect(checkSale({ ...base, buyerKind: "platform", buyerSlug: "feedyard1", headSold: "19" }, 20, false)).toMatch(/at least 20/);
    expect(checkSale({ ...base, lrpIndemnity: "500" }, 20, false)).toMatch(/LRP record/);
    expect(checkSale({ ...base, lrpIndemnity: "500" }, 20, true)).toBeNull();
  });

  test("LRP and cost checks", () => {
    expect(checkLrp(EMPTY_LRP)).toMatch(/at least one detail/);
    expect(checkLrp({ ...EMPTY_LRP, policyNumber: "P1", effectiveDate: "2026-09-01", endDate: "2026-08-01" })).toMatch(/end date/);
    expect(checkLrp({ ...EMPTY_LRP, coverageLevelPct: "120" })).toMatch(/Coverage/);
    expect(checkLrp({ ...EMPTY_LRP, floorPriceCwt: "240" })).toBeNull();
    expect(lrpChanges({ ...EMPTY_LRP, premiumAmount: "850" }, { ...EMPTY_LRP, premiumAmount: "900" })).toEqual({ premiumAmount: "900" });
    expect(lrpChanges({ ...EMPTY_LRP, policyNumber: "P1" }, { ...EMPTY_LRP })).toEqual({ policyNumber: "" });
    expect(checkCost({ category: "feed", amount: "", description: "", accruedDate: "" })).toMatch(/required/);
    expect(checkCost({ category: "feed", amount: "10.555", description: "", accruedDate: "" })).toMatch(/2 decimal/);
  });

  test("date-only values are not shifted by time zone", () => {
    expect(shortDate("2026-09-01")).toBe("Sep 1, 2026");
  });
});

describe("herd money panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("costs: owner can edit and void their own cost before investors buy in", async () => {
    setup({ c: costs({}, [expense({}), expense({ expenseId: "e2", category: "herd_value", source: "value", amount: 40000, canChange: false })]) });
    panel();
    await waitFor(() => expect(screen.getAllByTestId("cost-row")).toHaveLength(2));
    const own = screen.getAllByTestId("cost-row").find((r) => r.textContent?.includes("Feed"))!;
    const sys = screen.getAllByTestId("cost-row").find((r) => r.textContent?.includes("Herd starting value"))!;
    expect(within(own).getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(within(sys).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(sys).getByText("Booked when opened to investors")).toBeTruthy();
  });

  test("costs: log a cost checks the amount first, then sends it", async () => {
    setup();
    vi.mocked(postCost).mockResolvedValue({ message: "Cost logged.", expense: expense({ expenseId: "e9" }) });
    panel();
    await waitFor(() => expect(screen.getByRole("button", { name: "Log cost" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Log cost" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Amount is required/);
    expect(postCost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Amount ($)"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Log cost" }));
    await waitFor(() => expect(postCost).toHaveBeenCalledWith("h1", { category: "feed", amount: "500", description: "", accruedDate: "" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Cost logged."));
    expect(getCosts).toHaveBeenCalledTimes(2); // reloaded
  });

  test("costs: void asks first", async () => {
    setup();
    vi.mocked(voidCost).mockResolvedValue({ message: "Cost voided.", expense: expense({ status: "voided" }) });
    panel();
    await waitFor(() => expect(screen.getByRole("button", { name: "Void" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Void" }));
    expect(voidCost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "twice" } });
    fireEvent.click(screen.getByRole("button", { name: /Yes, void/ }));
    await waitFor(() => expect(voidCost).toHaveBeenCalledWith("e1", "twice"));
  });

  test("costs: locked while a sale is pending", async () => {
    setup({ c: costs({ saleState: "pending_approval" }, [expense({ canChange: false })]) });
    panel();
    await waitFor(() => expect(screen.getByText(/costs are locked/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Log cost" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  test("sale: blocked until investor money is released", async () => {
    setup({ available: 8000 });
    panel();
    await waitFor(() => expect(getHerdFunds).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("tab", { name: "Sale" }));
    await waitFor(() => expect(screen.getByText(/\$8,000.00 for this herd that hasn't been released/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Review sale" })).toBeNull();
  });

  test("sale: review, then submit sends the load", async () => {
    setup();
    vi.mocked(postSale).mockResolvedValue({ message: "Sale submitted for admin approval.", sale: sale(), preview: PREVIEW.preview! });
    panel();
    await waitFor(() => expect(getMySales).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("tab", { name: "Sale" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Review sale" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Buyer name"), { target: { value: "Packer Co" } });
    fireEvent.change(screen.getByLabelText(/Head sold/), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText(/Total live weight/), { target: { value: "26000" } });
    fireEvent.change(screen.getByLabelText(/Price \(\$\/cwt\)/), { target: { value: "200" } });
    expect(screen.getByText("$52,000.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review sale" }));
    expect(postSale).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Submit sale for approval" }));
    await waitFor(() => expect(postSale).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postSale).mock.calls[0][1]).toMatchObject({ buyerName: "Packer Co", headSold: "20", liveWeightLbs: "26000", pricePerCwt: "200" });
    await waitFor(() => expect(onHerdChanged).toHaveBeenCalled());
  });

  test("sale: a pending sale shows the split and can be cancelled after a confirm", async () => {
    setup({ sales: [sale()] });
    vi.mocked(cancelSale).mockResolvedValue({ message: "Sale cancelled.", sale: sale({ status: "cancelled" }) });
    panel();
    await waitFor(() => expect(getMySales).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("tab", { name: "Sale" }));
    await waitFor(() => expect(screen.getByTestId("split")).toBeTruthy());
    expect(within(screen.getByTestId("split")).getByText("$42,200.00")).toBeTruthy();
    expect(within(screen.getByTestId("split")).getByText("$9,800.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel this sale" }));
    expect(cancelSale).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Yes, cancel/ }));
    await waitFor(() => expect(cancelSale).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(onHerdChanged).toHaveBeenCalledWith("Sale cancelled."));
  });
});

describe("my payouts", () => {
  test("lists owed and paid payouts with totals", async () => {
    const p = (over: Partial<MyPayout>): MyPayout => ({
      payoutId: "p1", saleId: "s1", herdId: "h1", herdName: "Test Herd", saleDate: "2026-09-23", recipientType: "owner",
      tokens: 0, sharePct: null, grossBeforeFees: null, feeAmount: 0, costBasis: null, amount: 42200, status: "owed",
      paidAt: null, paymentReference: null, ...over,
    });
    vi.mocked(getMyPayouts).mockResolvedValue([
      p({}), p({ payoutId: "p2", amount: 1000, status: "paid", paidAt: "2026-09-24T15:00:00Z", paymentReference: "ACH-1" }),
    ]);
    render(<MyPayouts refreshKey={0} />);
    await waitFor(() => expect(screen.getAllByTestId("payout-row")).toHaveLength(2));
    // once as the "owed to you" total, once on its row
    expect(screen.getAllByText("$42,200.00")).toHaveLength(2);
    expect(screen.getAllByText("$1,000.00")).toHaveLength(2);
    expect(screen.getByText(/ref ACH-1/)).toBeTruthy();
    expect(screen.getByText("Owed")).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
  });

  test("empty", async () => {
    vi.mocked(getMyPayouts).mockResolvedValue([]);
    render(<MyPayouts refreshKey={0} />);
    await waitFor(() => expect(screen.getByText(/No payouts yet/)).toBeTruthy());
  });
});
