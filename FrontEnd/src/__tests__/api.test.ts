import { describe, test, expect, vi, afterEach } from "vitest";

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockFetchError(status: number, body: unknown = { error: "Not Found" }) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// â”€â”€ Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import {
  getInvestorPortfolio,
  getInvestorHoldings,
  getPools,
  getPoolById,
  getPoolCows,
  getCowById,
  getHerdForInvest,
  postLogin,
  getUsersByRole,
  getFeedlotPendingHerds,
  getFeedlotDashboard,
} from "@/lib/api";

describe("getInvestorPortfolio", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("returns parsed JSON on success", async () => {
    const data = { investorSlug: "alice", totals: { paidIn: 0 } };
    vi.stubGlobal("fetch", mockFetchOk(data));
    await expect(getInvestorPortfolio("alice")).resolves.toEqual(data);
    vi.unstubAllGlobals();
  });

  test("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchError(500));
    await expect(getInvestorPortfolio("alice")).rejects.toThrow("500");
    vi.unstubAllGlobals();
  });

  test("calls correct endpoint for slug", async () => {
    const data = { investorSlug: "alice", totals: { paidIn: 0 } };
    const mockFn = mockFetchOk(data);
    vi.stubGlobal("fetch", mockFn);
    await getInvestorPortfolio("alice");
    expect(mockFn.mock.calls[0][0]).toContain("/investors/alice/portfolio");
  });
});

describe("getInvestorHoldings", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("calls correct endpoint", async () => {
    const mockFn = mockFetchOk([]);
    vi.stubGlobal("fetch", mockFn);
    await getInvestorHoldings("bob");
    expect(mockFn.mock.calls[0][0]).toContain("/investors/bob/holdings");
  });
});

describe("getPools", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("returns array of pools", async () => {
    const pools = [{ herdId: "h1", name: "Herd 1" }];
    vi.stubGlobal("fetch", mockFetchOk(pools));
    await expect(getPools()).resolves.toEqual(pools);
  });
});

describe("getPoolById", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("returns pool detail on success", async () => {
    const detail = { pool: { herdId: "h1" }, lifecycle: [] };
    vi.stubGlobal("fetch", mockFetchOk(detail));
    await expect(getPoolById("h1")).resolves.toEqual(detail);
  });

  test("returns null on 404", async () => {
    vi.stubGlobal("fetch", mockFetchError(404));
    await expect(getPoolById("missing")).resolves.toBeNull();
  });

  test("re-throws non-404 errors", async () => {
    vi.stubGlobal("fetch", mockFetchError(500));
    await expect(getPoolById("h1")).rejects.toThrow();
  });
});

describe("getPoolCows", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("calls /pools/:id/cows endpoint", async () => {
    const mockFn = mockFetchOk([]);
    vi.stubGlobal("fetch", mockFn);
    await getPoolCows("herd-42");
    expect(mockFn.mock.calls[0][0]).toContain("/pools/herd-42/cows");
  });
});

describe("getCowById", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("returns cow detail on success", async () => {
    const detail = { cow: { cowId: "5" }, weights: [], epds: [], healthRecords: [], valuations: [] };
    vi.stubGlobal("fetch", mockFetchOk(detail));
    await expect(getCowById("5")).resolves.toEqual(detail);
  });

  test("returns null on 404", async () => {
    vi.stubGlobal("fetch", mockFetchError(404));
    await expect(getCowById("999")).resolves.toBeNull();
  });
});

describe("getHerdForInvest", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("returns herd invest info on success", async () => {
    const info = { herdId: "h1", isAvailable: true };
    vi.stubGlobal("fetch", mockFetchOk(info));
    await expect(getHerdForInvest("h1")).resolves.toEqual(info);
  });

  test("returns null on 404", async () => {
    vi.stubGlobal("fetch", mockFetchError(404));
    await expect(getHerdForInvest("gone")).resolves.toBeNull();
  });
});

describe("postLogin", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("returns user on successful login", async () => {
    const user = { userId: "1", slug: "alice", role: "investor", email: "a@test.com" };
    vi.stubGlobal("fetch", mockFetchOk(user));
    await expect(postLogin("alice", "password")).resolves.toEqual(user);
  });

  test("throws error on failed login", async () => {
    vi.stubGlobal("fetch", mockFetchError(401, { error: "Invalid credentials" }));
    await expect(postLogin("alice", "wrong")).rejects.toThrow("Invalid credentials");
  });

  test("POST sent to /api/auth/login with correct body", async () => {
    const mockFn = mockFetchOk({ userId: "1", slug: "u", role: "investor", email: "x" });
    vi.stubGlobal("fetch", mockFn);
    await postLogin("bob", "pw123");
    const [url, opts] = mockFn.mock.calls[0];
    expect(url).toContain("/auth/login");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toMatchObject({ username: "bob", password: "pw123" });
  });
});

describe("getUsersByRole", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("calls /users?role=... endpoint", async () => {
    const mockFn = mockFetchOk([]);
    vi.stubGlobal("fetch", mockFn);
    await getUsersByRole("investor");
    expect(mockFn.mock.calls[0][0]).toContain("role=investor");
  });
});

describe("getFeedlotPendingHerds", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("calls /feedlot/pending endpoint", async () => {
    const mockFn = mockFetchOk([]);
    vi.stubGlobal("fetch", mockFn);
    await getFeedlotPendingHerds();
    expect(mockFn.mock.calls[0][0]).toContain("/feedlot/pending");
  });
});

describe("getFeedlotDashboard", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("calls /feedlot/:slug/dashboard endpoint", async () => {
    const mockFn = mockFetchOk({ feedlotSlug: "fl1", claimedHerds: [] });
    vi.stubGlobal("fetch", mockFn);
    await getFeedlotDashboard("fl1");
    expect(mockFn.mock.calls[0][0]).toContain("/feedlot/fl1/dashboard");
  });
});