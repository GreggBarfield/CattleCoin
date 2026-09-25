import { jest } from "@jest/globals";

// requireAuth reads JWT_SECRET at module load time, so this must be set
// before investors.js (which imports requireAuth.js) is imported below.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const mockQuery = jest.fn();
jest.unstable_mockModule("../src/db.js", () => ({ default: { query: mockQuery } }));

const { default: express }         = await import("express");
const { default: request }         = await import("supertest");
const { default: jwt }             = await import("jsonwebtoken");
const { default: investorsRouter } = await import("../src/routes/investors.js");

const app = express();
app.use(express.json());
app.use("/api/investors", investorsRouter);

function tokenFor(user) {
  return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "1h" });
}

const investor1Token = tokenFor({ userId: 7, slug: "investor1", role: "investor" });
const investor2Token = tokenFor({ userId: 9, slug: "investor2", role: "investor" });
const adminToken = tokenFor({ userId: "admin-1", slug: "admin", role: "admin" });
const rancherToken = tokenFor({ userId: "r1", slug: "rancher1", role: "rancher" });

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

// Row shape returned by lib/investorMoney.js's herd query.
const moneyHerdRow = {
  herd_id: "herd-1", herd_name: "Test Herd", feedlot_status: "listed",
  head_count: "40", listing_price: "10000", owner_role: "rancher",
  total_supply: "20", tokens: "5", costs_total: "1000",
};

// Row shape returned by investors.js's attachDisplayFields() query.
const displayRow = {
  herd_id: "herd-1", rancher_id: "r1", purchase_status: "available",
  verified_flag: true, last_updated: new Date().toISOString(), cohort_label: null,
  season: "Fall", breed_code: "AN", dominant_stage: "RANCH", risk_score: 55,
  listing_price: "10000", pool_id: "pool-1", contract_address: "",
};

// ─── GET /api/investors/:slug/portfolio ─────────────────────────────────────
// Security fix 2026-09-21: now requires requireAuth + requireRole(investor,
// admin), plus a same-slug-or-admin check. Every case below sends an
// Authorization header for the investor whose own portfolio is being read
// (or an admin token), matching the :slug in the URL.
//
// Numbers fix 2026-09-21: the route now reports real ledger totals (via
// lib/investorMoney.js) instead of a fabricated position value / 30-day
// chart. Mock query order below follows the real call sequence: user lookup,
// then getInvestorMoney's herds/payments/sales/payouts queries, then (when
// there are held herds) the display-fields query and the recent-events query.
describe("GET /api/investors/:slug/portfolio", () => {
  beforeEach(() => mockQuery.mockReset());

  test("401 when no Authorization header is sent", async () => {
    const res = await request(app).get("/api/investors/investor1/portfolio");
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("403 when caller's role is rancher (not investor/admin)", async () => {
    const res = await request(app)
      .get("/api/investors/investor1/portfolio")
      .set(auth(rancherToken));
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("403 when an investor requests a different investor's slug", async () => {
    const res = await request(app)
      .get("/api/investors/investor1/portfolio")
      .set(auth(investor2Token)); // logged in as investor2, asking for investor1
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only view their own portfolio/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("404 when investor slug not found (own slug, just not in DB)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get("/api/investors/investor1/portfolio")
      .set(auth(investor1Token));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test("200 returns full portfolio when investor requests their own slug", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 7 }] })       // user lookup
      .mockResolvedValueOnce({ rows: [moneyHerdRow] })          // getInvestorMoney: herds
      .mockResolvedValueOnce({ rows: [] })                      // getInvestorMoney: payments
      .mockResolvedValueOnce({ rows: [] })                      // getInvestorMoney: sales
      .mockResolvedValueOnce({ rows: [] })                      // getInvestorMoney: payouts
      .mockResolvedValueOnce({ rows: [displayRow] })            // attachDisplayFields
      .mockResolvedValueOnce({ rows: [] });                     // recent events

    const res = await request(app)
      .get("/api/investors/investor1/portfolio")
      .set(auth(investor1Token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      investorSlug: "investor1",
      poolsHeld: 1,
    });
    expect(res.body.totals).toBeDefined();
    expect(res.body.topPools).toHaveLength(1);
  });

  test("200 lets an admin view another investor's portfolio", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 7 }] })
      .mockResolvedValueOnce({ rows: [moneyHerdRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [displayRow] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get("/api/investors/investor1/portfolio")
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.investorSlug).toBe("investor1");
  });

  test("200 returns empty portfolio when investor holds no herds", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 7 }] })  // user
      .mockResolvedValueOnce({ rows: [] })                 // getInvestorMoney: herds (none)
      .mockResolvedValueOnce({ rows: [] });                // getInvestorMoney: payouts (always queried)

    const res = await request(app)
      .get("/api/investors/investor1/portfolio")
      .set(auth(investor1Token));
    expect(res.status).toBe(200);
    expect(res.body.poolsHeld).toBe(0);
    expect(res.body.totals.paidIn).toBe(0);
  });

  test("avgRisk is null when investor holds no pools", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 7 }] })
      .mockResolvedValueOnce({ rows: [] }) // no herds → pools.length === 0
      .mockResolvedValueOnce({ rows: [] }); // payouts

    const res = await request(app)
      .get("/api/investors/investor1/portfolio")
      .set(auth(investor1Token));
    expect(res.status).toBe(200);
    expect(res.body.avgRisk).toBeNull();
  });

  test("500 on DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app)
      .get("/api/investors/investor1/portfolio")
      .set(auth(investor1Token));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch investor portfolio/i);
  });
});

// ─── GET /api/investors/:slug/holdings ──────────────────────────────────────
describe("GET /api/investors/:slug/holdings", () => {
  beforeEach(() => mockQuery.mockReset());

  test("401 when no Authorization header is sent", async () => {
    const res = await request(app).get("/api/investors/investor2/holdings");
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("403 when an investor requests a different investor's slug", async () => {
    const res = await request(app)
      .get("/api/investors/investor1/holdings")
      .set(auth(investor2Token)); // logged in as investor2, asking for investor1
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only view their own holdings/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("404 when investor not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get("/api/investors/investor2/holdings")
      .set(auth(investor2Token));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/investor not found/i);
  });

  test("200 returns held pools for the investor's own slug", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 9 }] })        // user lookup
      .mockResolvedValueOnce({ rows: [{ ...moneyHerdRow, herd_id: "h1", herd_name: "Alpha Herd", tokens: "3" }] }) // herds
      .mockResolvedValueOnce({ rows: [] })                       // payments
      .mockResolvedValueOnce({ rows: [] })                       // sales
      .mockResolvedValueOnce({ rows: [] })                       // payouts
      .mockResolvedValueOnce({ rows: [{ ...displayRow, herd_id: "h1" }] }); // attachDisplayFields

    const res = await request(app)
      .get("/api/investors/investor2/holdings")
      .set(auth(investor2Token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({
      herdId: "h1",
      name: "Alpha Herd",
      tokenAmount: 3,
    });
  });

  test("200 lets an admin view another investor's holdings", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 9 }] })
      .mockResolvedValueOnce({ rows: [] }) // no herds
      .mockResolvedValueOnce({ rows: [] }); // payouts

    const res = await request(app)
      .get("/api/investors/investor2/holdings")
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test("200 returns empty array when no holdings", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 9 }] })
      .mockResolvedValueOnce({ rows: [] }) // no herds
      .mockResolvedValueOnce({ rows: [] }); // payouts

    const res = await request(app)
      .get("/api/investors/investor2/holdings")
      .set(auth(investor2Token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test("500 on DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app)
      .get("/api/investors/investor2/holdings")
      .set(auth(investor2Token));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch holdings/i);
  });
});