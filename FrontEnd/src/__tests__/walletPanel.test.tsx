import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { WalletPanel } from "@/components/common/WalletPanel";
import type { MyWallet } from "@/lib/wallet";

vi.mock("@/lib/wallet", async () => {
  const actual = await vi.importActual<typeof import("@/lib/wallet")>("@/lib/wallet");
  return { ...actual, getMyWallet: vi.fn() };
});
import { getMyWallet, WalletApiError } from "@/lib/wallet";

const ADDR = "0xf79E000000000000000000000000000000000001";
const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

function wallet(over: Partial<MyWallet> = {}): MyWallet {
  return {
    asOfIso: "2026-10-03T13:00:00Z",
    hasWallet: true,
    address: ADDR,
    addressUrl: null,
    network: { chainId: 31337, name: "Private test network (demo)", isTestNetwork: true, explorerBase: null },
    chainReachable: true,
    lots: [
      {
        poolId: "p1",
        herdId: "h1",
        herdName: "TEST-WALLET 1002",
        contractAddress: CONTRACT,
        contractUrl: null,
        tokensPurchased: 2,
        tokensDelivered: 2,
        onChainBalance: 2,
        purchases: [
          { transactionId: "t1", tokens: 2, status: "delivered", txHash: "0x06ffa4d37e9c1026beb7a16ce42fc4c02596d67c652e1ccf692203ea800c3022", txUrl: null, purchasedAt: "2026-10-02T10:00:00Z" },
        ],
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(getMyWallet).mockReset();
});

describe("WalletPanel", () => {
  test("shows the address, network and a delivered lot", async () => {
    vi.mocked(getMyWallet).mockResolvedValue(wallet());
    render(<WalletPanel />);
    expect(await screen.findByTestId("wallet-address")).toHaveTextContent(ADDR);
    expect(screen.getByText(/Private test network \(demo\)/)).toBeInTheDocument();
    expect(screen.getByText(/no public explorer page/)).toBeInTheDocument();
    const row = screen.getByTestId("wallet-lot");
    expect(within(row).getByText("TEST-WALLET 1002")).toBeInTheDocument();
    expect(within(row).getByText("In your wallet")).toBeInTheDocument();
    expect(within(row).getAllByText("2").length).toBe(2); // bought + in wallet now
    expect(within(row).getByText(/Tx 0x06ffa4d3/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull(); // private network: no explorer links
  });

  test("shows explorer links when the network has an explorer", async () => {
    const w = wallet({
      addressUrl: `https://amoy.polygonscan.com/address/${ADDR}`,
      network: { chainId: 80002, name: "Polygon Amoy (public test network)", isTestNetwork: true, explorerBase: "https://amoy.polygonscan.com" },
    });
    w.lots[0].contractUrl = `https://amoy.polygonscan.com/token/${CONTRACT}?a=${ADDR}`;
    w.lots[0].purchases[0].txUrl = "https://amoy.polygonscan.com/tx/0x06ff";
    vi.mocked(getMyWallet).mockResolvedValue(w);
    render(<WalletPanel />);
    const link = await screen.findByText("View on block explorer");
    expect(link).toHaveAttribute("href", `https://amoy.polygonscan.com/address/${ADDR}`);
    expect(screen.getByText(/Transaction 0x06ff/)).toHaveAttribute("href", "https://amoy.polygonscan.com/tx/0x06ff");
  });

  test("a lot with an unsent purchase says so, and shows a dash when the balance cannot be read", async () => {
    const w = wallet({ chainReachable: false });
    w.lots[0].onChainBalance = null;
    w.lots[0].purchases = [{ transactionId: "t2", tokens: 2, status: "retrying", txHash: null, txUrl: null, purchasedAt: "2026-10-02T10:00:00Z" }];
    vi.mocked(getMyWallet).mockResolvedValue(w);
    render(<WalletPanel />);
    expect(await screen.findByText("Will retry")).toBeInTheDocument();
    expect(screen.getByText(/could not reach the blockchain/)).toBeInTheDocument();
  });

  test("investor with no wallet yet gets a plain explanation", async () => {
    vi.mocked(getMyWallet).mockResolvedValue(wallet({ hasWallet: false, address: null, lots: [], network: null }));
    render(<WalletPanel />);
    expect(await screen.findByText(/created automatically with your first purchase/)).toBeInTheDocument();
  });

  test("wallet but no purchases yet", async () => {
    vi.mocked(getMyWallet).mockResolvedValue(wallet({ lots: [] }));
    render(<WalletPanel />);
    expect(await screen.findByText(/No tokens yet/)).toBeInTheDocument();
  });

  test("renders nothing for someone who is not an investor (403)", async () => {
    vi.mocked(getMyWallet).mockRejectedValue(new WalletApiError(403, "Forbidden: insufficient role"));
    const { container } = render(<WalletPanel />);
    await waitFor(() => expect(getMyWallet).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  test("a server problem shows a short message", async () => {
    vi.mocked(getMyWallet).mockRejectedValue(new WalletApiError(500, "Request failed."));
    render(<WalletPanel />);
    expect(await screen.findByText(/Could not load your wallet/)).toBeInTheDocument();
  });
});
