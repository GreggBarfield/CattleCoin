import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { MyMoney } from "@/pages/MyMoney";
import { Statement } from "@/pages/Statement";
import { usd, shortDate, costLabel } from "@/lib/money";
import type { MyMoney as MyMoneyData, Statement as StatementData } from "@/lib/money";

// the pages call these; everything else in @/lib/money (formatting) stays real
vi.mock("@/lib/money", async () => {
  const actual = await vi.importActual<typeof import("@/lib/money")>("@/lib/money");
  return { ...actual, getMyMoney: vi.fn(), getStatement: vi.fn() };
});
import { getMyMoney, getStatement } from "@/lib/money";

const money: MyMoneyData = {
  asOfIso: "2026-09-20T00:00:00Z",
  totals: { paidIn: 51000, estimatedExtra: 1500, stillInvested: 15000, receivedFromSales: 39537, owedFromSales: 0 },
  herds: [
    {
      herdId: "h-sold", herdName: "Sold Herd", producerType: "cow-calf", state: "sold", headCount: 40,
      tokens: 12, totalSupply: 40, sharePct: 30, paidIn: 36000, estimatedExtra: null, unrecordedTokens: 0,
      payments: [{ paymentId: "p1", paidAt: "2026-09-01T00:00:00Z", tokens: 12, amount: 36000 }],
      costsTotal: 127400, sale: { saleId: "sale-1", status: "approved", saleDate: "2026-09-19" },
      payout: {
        payoutId: "po1", saleId: "sale-1", amount: 39537, capitalReturned: 36000, profitShare: 3930,
        exitFee: 393, status: "paid", paidAt: "2026-09-20T00:00:00Z", paymentReference: "ACH-1", profit: 3537,
      },
    },
    {
      herdId: "h-open", herdName: "Open Herd", producerType: "feeder", state: "open", headCount: 20,
      tokens: 5, totalSupply: 20, sharePct: 25, paidIn: 15000, estimatedExtra: null, unrecordedTokens: 0,
      payments: [{ paymentId: "p2", paidAt: "2026-09-02T00:00:00Z", tokens: 5, amount: 15000 }],
      costsTotal: 0, sale: null, payout: null,
    },
    {
      herdId: "h-old", herdName: "Old Demo Herd", producerType: "cow-calf", state: "open", headCount: 30,
      tokens: 100, totalSupply: 30000, sharePct: 0.33, paidIn: 0, estimatedExtra: 1500, unrecordedTokens: 100,
      payments: [], costsTotal: 0, sale: null, payout: null,
    },
  ],
};

function Wrap({ path, route, children }: { path: string; route: string; children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path={route} element={children} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("money formatting", () => {
  test("usd shows dollars and cents", () => {
    expect(usd(39537)).toBe("$39,537.00");
    expect(usd(0.5)).toBe("$0.50");
    expect(usd(null)).toBe("-");
  });
  test("shortDate reads a plain date as that calendar day", () => {
    expect(shortDate("2026-09-20")).toBe("Sep 20, 2026");
    expect(shortDate(null)).toBe("-");
  });
  test("costLabel gives plain names and falls back to the raw category", () => {
    expect(costLabel("herd_value")).toBe("Starting value of the herd");
    expect(costLabel("mystery")).toBe("mystery");
  });
});

describe("My Money page", () => {
  beforeEach(() => {
    vi.mocked(getMyMoney).mockReset();
  });

  test("shows the totals, the real investments and the older holdings separately", async () => {
    vi.mocked(getMyMoney).mockResolvedValue(money);
    render(<Wrap path="/investor/alice/money" route="/investor/:slug/money"><MyMoney /></Wrap>);
    await waitFor(() => expect(screen.getByText("$51,000.00")).toBeInTheDocument());
    expect(screen.getByText("Paid To You")).toBeInTheDocument();
    expect(screen.getAllByText("Sold Herd").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Open Herd").length).toBeGreaterThan(0);
    expect(screen.getByText("Older holdings with no payment on record")).toBeInTheDocument();
    expect(screen.getByText("Old Demo Herd")).toBeInTheDocument();
  });

  test("a sold herd links to its statement, an open herd to its lots page", async () => {
    vi.mocked(getMyMoney).mockResolvedValue(money);
    render(<Wrap path="/investor/alice/money" route="/investor/:slug/money"><MyMoney /></Wrap>);
    await waitFor(() => expect(screen.getByText("Statement")).toBeInTheDocument());
    expect(screen.getByText("Statement").closest("a")?.getAttribute("href")).toBe("/investor/alice/statements/sale-1");
    // the herd name in the investments table (the payments list below repeats the name as plain text)
    const openLink = screen.getAllByText("Open Herd").map((e) => e.closest("a")).find((a) => a);
    expect(openLink?.getAttribute("href")).toBe("/investor/alice/holdings/h-open");
    // a sold herd's name is not a link (it no longer has a lots page)
    expect(screen.getAllByText("Sold Herd").every((e) => e.closest("a") === null)).toBe(true);
  });

  test("shows the paid payout with its gain", async () => {
    vi.mocked(getMyMoney).mockResolvedValue(money);
    render(<Wrap path="/investor/alice/money" route="/investor/:slug/money"><MyMoney /></Wrap>);
    await waitFor(() => expect(screen.getByText("$39,537.00", { selector: "span.font-medium" })).toBeInTheDocument());
    expect(screen.getByText(/Gain \$3,537\.00/)).toBeInTheDocument();
  });

  test("says so when the investor has no herds", async () => {
    vi.mocked(getMyMoney).mockResolvedValue({ ...money, totals: { ...money.totals, paidIn: 0 }, herds: [] });
    render(<Wrap path="/investor/alice/money" route="/investor/:slug/money"><MyMoney /></Wrap>);
    await waitFor(() => expect(screen.getByText(/You have not invested in a herd yet/)).toBeInTheDocument());
  });

  test("shows an error with a retry button when the call fails", async () => {
    vi.mocked(getMyMoney).mockImplementation(() => Promise.reject(new Error("Boom")));
    render(<Wrap path="/investor/alice/money" route="/investor/:slug/money"><MyMoney /></Wrap>);
    await waitFor(() => expect(screen.getByText("Boom")).toBeInTheDocument());
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });
});

const statement = (over: Partial<StatementData> = {}): StatementData => ({
  view: "investor",
  statementStatus: "final",
  sale: {
    saleId: "sale-1", herdId: "h-sold", herdName: "Sold Herd", status: "approved", saleDate: "2026-09-20",
    buyerName: null, buyerSlug: "feedlot1", headSold: 40, headLost: 0, liveWeightLbs: 50000, pricePerCwt: 280,
  },
  proceeds: { salePrice: 140000, lrpIndemnity: 500, total: 140500 },
  load: { headSold: 40, headLost: 0, liveWeightLbs: 50000, pricePerCwt: 280, avgWeightPerHead: 1250, pricePerHead: 3500 },
  costs: {
    total: 127400, selfBilled: 127400, serviceBilled: 0,
    byCategory: [{ category: "herd_value", amount: 120000 }, { category: "feed", amount: 7400 }],
  },
  netAmount: 13100, profit: 13100, platformFeesTotal: 655, warnings: [],
  you: {
    recipientType: "investor", slug: "alice", tokens: 12, sharePct: 30, grossBeforeFees: 39930, capitalReturned: 36000,
    profitShare: 3930, feeAmount: 393, amount: 39537, status: "paid", paidAt: "2026-09-21T00:00:00Z",
    paymentReference: "ACH-1", costBasis: 36000, costBasisEstimated: false, profit: 3537, returnPct: 9.83,
  },
  ...over,
});

describe("Statement page", () => {
  beforeEach(() => {
    vi.mocked(getStatement).mockReset();
  });
  const ui = () => (
    <Wrap path="/investor/alice/statements/sale-1" route="/investor/:slug/statements/:saleId"><Statement /></Wrap>
  );

  test("a final statement shows the investor's own line and the costs", async () => {
    vi.mocked(getStatement).mockResolvedValue(statement());
    render(ui());
    await waitFor(() => expect(screen.getByText("Final")).toBeInTheDocument());
    expect(screen.getByText("You receive")).toBeInTheDocument();
    expect(screen.getByText("$39,537.00")).toBeInTheDocument();
    expect(screen.getByText("Your money back")).toBeInTheDocument();
    expect(screen.getByText("Starting value of the herd")).toBeInTheDocument();
    expect(screen.getByText(/reference ACH-1/)).toBeInTheDocument();
  });

  test("a preview says it is not final and that nothing is paid yet", async () => {
    vi.mocked(getStatement).mockResolvedValue(
      statement({ statementStatus: "preview", you: { ...statement().you!, status: "not yet approved", paidAt: null, paymentReference: null } })
    );
    render(ui());
    await waitFor(() => expect(screen.getByText("Preview - not yet approved")).toBeInTheDocument());
    expect(screen.getByText("You would receive")).toBeInTheDocument();
    expect(screen.getByText(/waiting for the sale to be approved/)).toBeInTheDocument();
  });

  test("a loss is shown as a loss", async () => {
    vi.mocked(getStatement).mockResolvedValue(
      statement({
        profit: -12000,
        you: { ...statement().you!, profitShare: -6000, feeAmount: 0, amount: 24000, profit: -6000, returnPct: -20, status: "owed", paidAt: null },
      })
    );
    render(ui());
    await waitFor(() => expect(screen.getByText("Your share of the loss")).toBeInTheDocument());
    expect(screen.getByText("Your loss on this herd")).toBeInTheDocument();
    expect(screen.getByText("Loss on the herd")).toBeInTheDocument();
    expect(screen.getByText(/Approved and owed to you/)).toBeInTheDocument();
  });

  test("warns when part of the cost basis is an estimate", async () => {
    vi.mocked(getStatement).mockResolvedValue(statement({ you: { ...statement().you!, costBasisEstimated: true } }));
    render(ui());
    await waitFor(() => expect(screen.getByText(/Part of this is an estimate/)).toBeInTheDocument());
  });

  test("shows the server's message when the statement cannot be seen", async () => {
    vi.mocked(getStatement).mockImplementation(() => Promise.reject(new Error("You are not allowed to view this statement.")));
    render(ui());
    await waitFor(() => expect(screen.getByText("You are not allowed to view this statement.")).toBeInTheDocument());
    expect(screen.getByText("Statement not available")).toBeInTheDocument();
  });
});
