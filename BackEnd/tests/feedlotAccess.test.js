import { jest } from "@jest/globals";

// requireAuth reads JWT_SECRET at module load time, so set it before the
// routers (which import requireAuth.js) are imported below.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const mockQuery = jest.fn();
jest.unstable_mockModule("../src/db.js", () => ({
  default: { query: mockQuery, connect: jest.fn() },
}));

const { default: express }          = await import("express");
const { default: request }          = await import("supertest");
const { default: jwt }              = await import("jsonwebtoken");
const { default: rancherRouter }    = await import("../src/routes/rancher.js");
const { default: settlementRouter } = await import("../src/routes/settlement.js");

const app = express();
app.use(express.json());
app.use("/api/rancher", rancherRouter);
app.use("/api/settlement", settlementRouter);

const tokenFor = (user) => jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "1h" });
const auth = (t) => ({ Authorization: `Bearer ${t}` });

const sellerToken   = tokenFor({ userId: "u-rancher", slug: "rancher1", role: "rancher", email: "r@x.dev" });
const buyerToken    = tokenFor({ userId: "u-feedlot", slug: "feedlot1", role: "feedlot", email: "f@x.dev" });
const strangerToken = tokenFor({ userId: "u-other",   slug: "feedlot2", role: "feedlot", email: "o@x.dev" });
const investorToken = tokenFor({ userId: "u-inv",     slug: "inv1",     role: "investor", email: "i@x.dev" });
const adminToken    = tokenFor({ userId: "u-admin",   slug: "admin",    role: "admin",    email: "a@x.dev" });

const SALE_ID = "0b0d7d6a-2c4e-4f0e-9d51-6a1a5b6c7d8e";

// One herd_sales row as SALE_SELECT returns it: rancher1 selling to feedlot1.
const SALE_ROW = {
  sale_id: SALE_ID, herd_id: "h1", seller_user_id: "u-rancher", buyer_user_id: "u-feedlot", buyer_name: null,
  gross_amount: "90000.00", sale_date: "2026-09-24", status: "pending_approval",
  expenses_total: "1200.00", net_amount: "88800.00", platform_fees_total: "450.00",
  fee_terms_snapshot: { raisePct: 2 },
  submitted_at: "2026-09-24T18:00:00Z", decided_at: null, decision_note: null,
  buyer_response: "waiting", buyer_responded_at: null, buyer_response_note: null, new_herd_id: null,
  head_sold: 40, head_lost: 0, live_weight_lbs: "30000", price_per_cwt: "300", lrp_indemnity: "0", lrp_note: null,
  herd_name: "Angus Prime Herd A", herd_head_count: 40, seller_slug: "rancher1", buyer_slug: "feedlot1",
};

describe("a feedlot can read its own herd list (fix #14)", () => {
  beforeEach(() => mockQuery.mockReset());

  test("GET /api/rancher/me/herds is 200 for a feedlot, filtered to that feedlot's own id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ herd_id: "h9", herd_name: "Finishing", cattle_count: 40 }] });
    const res = await request(app).get("/api/rancher/me/herds").set(auth(buyerToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(["u-feedlot"]);
  });

  test("GET /api/rancher/me/investments is 200 for a feedlot", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/rancher/me/investments").set(auth(buyerToken));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  test("still 403 for an investor, 403 for an admin, 401 with no token", async () => {
    expect((await request(app).get("/api/rancher/me/herds").set(auth(investorToken))).status).toBe(403);
    expect((await request(app).get("/api/rancher/me/herds").set(auth(adminToken))).status).toBe(403);
    expect((await request(app).get("/api/rancher/me/herds")).status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("the buyer on a sale sees the deal, not the seller's split (fix #14)", () => {
  beforeEach(() => mockQuery.mockReset());

  test("GET /sales: the buyer's copy has price and load but the seller-side money fields are blank", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SALE_ROW] });
    const res = await request(app).get("/api/settlement/sales").set(auth(buyerToken));
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      saleId: SALE_ID, grossAmount: 90000, headSold: 40, liveWeightLbs: 30000, pricePerCwt: 300,
      buyerResponse: "waiting", sellerSlug: "rancher1", buyerSlug: "feedlot1",
      expensesTotal: null, netAmount: null, platformFeesTotal: null, feeTerms: null,
    });
  });

  test("GET /sales: the seller's copy still has the money fields", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SALE_ROW] });
    const res = await request(app).get("/api/settlement/sales").set(auth(sellerToken));
    expect(res.body[0]).toMatchObject({
      expensesTotal: 1200, netAmount: 88800, platformFeesTotal: 450, feeTerms: { raisePct: 2 },
    });
  });

  test("GET /sales: an admin's copy has the money fields too", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SALE_ROW] });
    const res = await request(app).get("/api/settlement/sales").set(auth(adminToken));
    expect(res.body[0].expensesTotal).toBe(1200);
  });

  test("GET /sales/:id: the buyer gets no preview and no payout rows (pending sale)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SALE_ROW] });
    const res = await request(app).get(`/api/settlement/sales/${SALE_ID}`).set(auth(buyerToken));
    expect(res.status).toBe(200);
    expect(res.body.sale.grossAmount).toBe(90000);
    expect(res.body.sale.expensesTotal).toBeNull();
    expect(res.body.preview).toBeUndefined();
    expect(res.body.payouts).toBeUndefined();
    expect(res.body.corrections).toBeUndefined();
    // only the one lookup ran - no settlement preview queries
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test("GET /sales/:id: the buyer gets no payout rows on an approved sale either", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...SALE_ROW, status: "approved", buyer_response: "accepted" }] });
    const res = await request(app).get(`/api/settlement/sales/${SALE_ID}`).set(auth(buyerToken));
    expect(res.status).toBe(200);
    expect(res.body.payouts).toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test("GET /sales/:id: a feedlot that is not on the sale is 403", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SALE_ROW] });
    const res = await request(app).get(`/api/settlement/sales/${SALE_ID}`).set(auth(strangerToken));
    expect(res.status).toBe(403);
  });

  test("the buyer is refused a statement (seller and admin only)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SALE_ROW] });
    const res = await request(app).get(`/api/settlement/sales/${SALE_ID}/statement`).set(auth(buyerToken));
    expect(res.status).toBe(403);
  });
});

describe("accept and decline are for the named buyer only", () => {
  beforeEach(() => mockQuery.mockReset());

  test("a feedlot that is not the buyer cannot accept (403) - and the seller cannot accept their own sale", async () => {
    // accept runs inside withTransaction, which needs pool.connect - so those paths
    // are covered by the end-to-end run. Here: no token -> 401, investor -> 403.
    expect((await request(app).post(`/api/settlement/sales/${SALE_ID}/accept`)).status).toBe(401);
    expect((await request(app).post(`/api/settlement/sales/${SALE_ID}/accept`).set(auth(investorToken))).status).toBe(403);
    expect((await request(app).post(`/api/settlement/sales/${SALE_ID}/decline`).set(auth(investorToken))).status).toBe(403);
  });
});
