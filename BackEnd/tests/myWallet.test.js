import { jest } from "@jest/globals";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const mockQuery = jest.fn();
jest.unstable_mockModule("../src/db.js", () => ({ default: { query: mockQuery } }));

const mockChainId = jest.fn();
const mockBalance = jest.fn();
jest.unstable_mockModule("../src/blockchain/chainRead.js", () => {
  return {
    readChainId: mockChainId,
    readTokenBalance: mockBalance,
    describeNetwork: (id) => {
      if (id === 80002) return { chainId: id, name: "Polygon Amoy (public test network)", isTestNetwork: true, explorerBase: "https://amoy.polygonscan.com" };
      if (id === 31337) return { chainId: id, name: "Private test network (demo)", isTestNetwork: true, explorerBase: null };
      return id == null ? null : { chainId: id, name: `Network ${id}`, isTestNetwork: true, explorerBase: null };
    },
  };
});

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: jwt } = await import("jsonwebtoken");
const { default: myWalletRouter } = await import("../src/routes/myWallet.js");
const { plainStatus } = await import("../src/lib/walletView.js");

const app = express();
app.use("/api/my-wallet", myWalletRouter);

const tokenFor = (u) => jwt.sign(u, process.env.JWT_SECRET, { expiresIn: "1h" });
const investor = { Authorization: `Bearer ${tokenFor({ userId: "u-i1", slug: "investor1", role: "investor", email: "i@x.dev" })}` };
const rancher = { Authorization: `Bearer ${tokenFor({ userId: "u-r1", slug: "rancher1", role: "rancher", email: "r@x.dev" })}` };

const ADDR = "0xf79E000000000000000000000000000000000001";
const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const buy = (over = {}) => ({
  transaction_id: "t1", pool_id: "p1", amount: "2.000000", chain_status: "delivered",
  blockchain_tx_hash: "0xabc", created_at: "2026-10-02T10:00:00Z",
  contract_address: CONTRACT, herd_id: "h1", herd_name: "Lot A", ...over,
});

function db({ address = ADDR, buys = [buy()] } = {}) {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM users/.test(sql)) return { rows: address === undefined ? [] : [{ wallet_address: address }] };
    if (/FROM transactions/.test(sql)) return { rows: buys };
    throw new Error("unexpected query: " + sql);
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockChainId.mockReset().mockResolvedValue(31337);
  mockBalance.mockReset().mockResolvedValue(2);
});

describe("GET /api/my-wallet", () => {
  test("401 with no token, 403 for a rancher; database never touched", async () => {
    expect((await request(app).get("/api/my-wallet")).status).toBe(401);
    expect((await request(app).get("/api/my-wallet").set(rancher)).status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("returns the address, network, and a delivered lot with its on-chain balance", async () => {
    db();
    const res = await request(app).get("/api/my-wallet").set(investor);
    expect(res.status).toBe(200);
    expect(res.body.hasWallet).toBe(true);
    expect(res.body.address).toBe(ADDR);
    expect(res.body.network.name).toMatch(/Private test network/);
    expect(res.body.addressUrl).toBeNull(); // private network: no explorer
    expect(res.body.chainReachable).toBe(true);
    const lot = res.body.lots[0];
    expect(lot).toMatchObject({ herdName: "Lot A", tokensPurchased: 2, tokensDelivered: 2, onChainBalance: 2, contractUrl: null });
    expect(lot.purchases[0]).toMatchObject({ status: "delivered", txHash: "0xabc", txUrl: null });
    expect(mockBalance).toHaveBeenCalledWith({ contractAddress: CONTRACT, address: ADDR });
  });

  test("asks only about the logged-in user, taken from the token", async () => {
    db();
    await request(app).get("/api/my-wallet?userId=someone-else").set(investor);
    for (const call of mockQuery.mock.calls) expect(call[1]).toEqual(["u-i1"]);
  });

  test("never includes the encrypted key", async () => {
    db();
    const res = await request(app).get("/api/my-wallet").set(investor);
    expect(JSON.stringify(res.body)).not.toMatch(/key/i);
    for (const call of mockQuery.mock.calls) expect(call[0]).not.toMatch(/wallet_key_enc/);
  });

  test("explorer links appear on a public network", async () => {
    db();
    mockChainId.mockResolvedValue(80002);
    const res = await request(app).get("/api/my-wallet").set(investor);
    expect(res.body.addressUrl).toBe(`https://amoy.polygonscan.com/address/${ADDR}`);
    expect(res.body.lots[0].contractUrl).toBe(`https://amoy.polygonscan.com/token/${CONTRACT}?a=${ADDR}`);
    expect(res.body.lots[0].purchases[0].txUrl).toBe("https://amoy.polygonscan.com/tx/0xabc");
  });

  test("same lot bought twice is one row; only delivered tokens count as delivered", async () => {
    db({ buys: [buy(), buy({ transaction_id: "t2", amount: "3.000000", chain_status: "failed", blockchain_tx_hash: null })] });
    const res = await request(app).get("/api/my-wallet").set(investor);
    expect(res.body.lots).toHaveLength(1);
    expect(res.body.lots[0]).toMatchObject({ tokensPurchased: 5, tokensDelivered: 2 });
    expect(res.body.lots[0].purchases.map((p) => p.status)).toEqual(["delivered", "retrying"]);
  });

  test("blockchain unreachable: still answers, balances empty, flag false", async () => {
    db();
    mockChainId.mockResolvedValue(null);
    const res = await request(app).get("/api/my-wallet").set(investor);
    expect(res.status).toBe(200);
    expect(res.body.chainReachable).toBe(false);
    expect(res.body.network).toBeNull();
    expect(res.body.lots[0].onChainBalance).toBeNull();
    expect(mockBalance).not.toHaveBeenCalled();
  });

  test("no wallet yet: hasWallet false, no chain reads for balances", async () => {
    db({ address: null, buys: [] });
    const res = await request(app).get("/api/my-wallet").set(investor);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hasWallet: false, address: null, addressUrl: null, lots: [] });
  });

  test("database error gives a generic 500", async () => {
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValue(new Error("boom"));
    const res = await request(app).get("/api/my-wallet").set(investor);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Request failed." });
    quiet.mockRestore();
  });

  test("status words", () => {
    expect(["delivered", "pending", "sending", "failed", "skipped", null].map(plainStatus)).toEqual([
      "delivered", "sending", "sending", "retrying", "waiting", "not_on_chain",
    ]);
  });
});
