import { jest } from "@jest/globals";

const mockQuery = jest.fn();
jest.unstable_mockModule("../src/db.js", () => ({ default: { query: mockQuery } }));

const { default: express }     = await import("express");
const { default: request }     = await import("supertest");
const { default: poolsRouter } = await import("../src/routes/pools.js");

const app = express();
app.use(express.json());
app.use("/api/pools", poolsRouter);

const herdRow = {
  herd_id: "herd-1", rancher_id: "r1", herd_name: "Test Herd",
  listing_price: "10000", purchase_status: "available",
  head_count: "50", verified_flag: true,
  last_updated: new Date().toISOString(),
  cohort_label: null, season: "Fall", breed_code: "AN",
  dominant_stage: "FEEDLOT", risk_score: 55, investor_pct: "60",
  tokens_sold: "5",
  pool_id: "pool-1", total_supply: "20", contract_address: "0xABC",
  total_raised: "6000", total_costs: "1500",
};

// ─── GET /api/pools ───────────────────────────────────────────────────────────
describe("GET /api/pools", () => {
  beforeEach(() => mockQuery.mockReset());

  test("200 returns all listed pools", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [herdRow] })                                 // herds list
      .mockResolvedValueOnce({ rows: [{ herd_id: "herd-1", total_tokens: 5 }] }); // token amounts

    const res = await request(app).get("/api/pools");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({
      herdId: "herd-1",
      name: "Test Herd",
      dominantStage: "FEEDLOT",
    });
  });

  test("200 returns empty array when no listed pools", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/pools");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test("purchaseStatus is 'sold' when all investor-allocated tokens gone", async () => {
    const soldRow = { ...herdRow, tokens_sold: "12", investor_pct: "60", total_supply: "20" };
    // investorAllocation = floor(20 * 60/100) = 12; tokensSold = 12 → sold
    mockQuery
      .mockResolvedValueOnce({ rows: [soldRow] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get("/api/pools");
    expect(res.status).toBe(200);
    expect(res.body[0].purchaseStatus).toBe("sold");
  });

  test("500 on DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app).get("/api/pools");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch pools/i);
  });
});

// ─── GET /api/pools/:id ───────────────────────────────────────────────────────
describe("GET /api/pools/:id", () => {
  beforeEach(() => mockQuery.mockReset());

  test("404 with reason not_found when the herd never existed", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })   // main POOL_QUERY miss
      .mockResolvedValueOnce({ rows: [] });  // fallback status lookup also misses
    const res = await request(app).get("/api/pools/herd-999");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/pool not found/i);
    expect(res.body.reason).toBe("not_found");
  });

  // A herd disappears from POOL_QUERY (feedlot_status = 'listed' only) once
  // it's sold/settled or still pending feedlot review - the fallback status
  // lookup lets the response say which, instead of a bare 404.
  test("404 with reason sold when the herd was sold and settled", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ feedlot_status: "sold", herd_name: "Test Herd" }] });
    const res = await request(app).get("/api/pools/herd-1");
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("sold");
    expect(res.body.herdName).toBe("Test Herd");
  });

  test("404 with reason pending when the herd awaits feedlot review", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ feedlot_status: "pending", herd_name: "Test Herd" }] });
    const res = await request(app).get("/api/pools/herd-1");
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("pending");
  });

  test("200 returns pool detail with lifecycle events", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [herdRow] })                   // herd row
      .mockResolvedValueOnce({ rows: [{ total_tokens: 5 }] })       // token amount
      .mockResolvedValueOnce({                                       // lifecycle events
        rows: [{
          id: "ev-1", pool_id: "herd-1", cow_id: "42",
          stage: "FEEDLOT", verified: true,
          timestamp_iso: new Date().toISOString(),
          note: "BRD Shield administered",
        }],
      })
      .mockResolvedValueOnce({                                       // cost breakdown
        rows: [{ category: "feed", amount: "1500" }],
      });

    const res = await request(app).get("/api/pools/herd-1");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("pool");
    expect(res.body).toHaveProperty("lifecycle");
    expect(res.body).toHaveProperty("costBreakdown");
    expect(res.body.pool).toMatchObject({ totalRaised: 6000, costsTotal: 1500 });
    expect(res.body.lifecycle).toHaveLength(1);
  });

  test("200 uses fallback lifecycle event when none exist", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [herdRow] })
      .mockResolvedValueOnce({ rows: [{ total_tokens: 0 }] })
      .mockResolvedValueOnce({ rows: [] })   // no events
      .mockResolvedValueOnce({ rows: [] });  // no costs

    const res = await request(app).get("/api/pools/herd-1");
    expect(res.status).toBe(200);
    expect(res.body.lifecycle).toHaveLength(1);
    expect(res.body.lifecycle[0].id).toMatch(/ev-herd/);
  });

  test("costBreakdown maps categories to real labels", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [herdRow] })
      .mockResolvedValueOnce({ rows: [{ total_tokens: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { category: "feed", amount: "1000" },
          { category: "vet", amount: "500" },
        ],
      });

    const res = await request(app).get("/api/pools/herd-1");
    expect(res.status).toBe(200);
    expect(res.body.costBreakdown).toEqual([
      { label: "Feed", amountUsd: 1000 },
      { label: "Vet and health", amountUsd: 500 },
    ]);
  });

  test("500 on DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app).get("/api/pools/herd-1");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch pool detail/i);
  });
});

// ─── GET /api/pools/:id/cows ──────────────────────────────────────────────────
describe("GET /api/pools/:id/cows", () => {
  beforeEach(() => mockQuery.mockReset());

  test("404 when herd not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/pools/herd-999/cows");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/herd not found/i);
  });

  test("200 returns shaped cow list", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ herd_id: "h1", dominant_stage: "RANCH", verified_flag: false, listing_price: "5000", head_count: "25" }],
      })
      .mockResolvedValueOnce({
        rows: [{
          animal_id: 42, herd_id: "h1", registration_number: "REG1",
          official_id: "TAG1", animal_name: "Bessie", breed_code: "AN",
          sex_code: "C", birth_date: "2022-01-01", sire_registration_number: null,
          dam_registration_number: null, is_genomic_enhanced: false,
          created_at: new Date(), weight_lbs: "700", fair_value: "1200", verified: false,
        }],
      });

    const res = await request(app).get("/api/pools/h1/cows");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({ cowId: "42", breedCode: "AN" });
  });

  test("200 returns empty array when herd has no animals", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ herd_id: "h1", dominant_stage: "RANCH", verified_flag: false, listing_price: "5000", head_count: "20" }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get("/api/pools/h1/cows");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test("500 on DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app).get("/api/pools/h1/cows");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch cows/i);
  });
});