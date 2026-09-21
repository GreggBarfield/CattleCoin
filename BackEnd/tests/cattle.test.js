import { jest } from "@jest/globals";

// requireAuth reads JWT_SECRET at module load time, so this must be set
// before cattle.js (which imports requireAuth.js) is imported below.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

// â”€â”€ Mock pool BEFORE importing the router â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const mockQuery = jest.fn();
jest.unstable_mockModule("../src/db.js", () => ({ default: { query: mockQuery } }));

const { default: express }       = await import("express");
const { default: request }       = await import("supertest");
const { default: jwt }           = await import("jsonwebtoken");
const { default: cattleRouter }  = await import("../src/routes/cattle.js");

const app = express();
app.use(express.json());
app.use("/api/cattle", cattleRouter);

function tokenFor(user) {
  return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "1h" });
}

const RANCHER_ID = "r1";
const OTHER_RANCHER_ID = "r2";
const rancherToken = tokenFor({ userId: RANCHER_ID, slug: "rancher1", role: "rancher" });
const otherRancherToken = tokenFor({ userId: OTHER_RANCHER_ID, slug: "rancher2", role: "rancher" });
const adminToken = tokenFor({ userId: "admin-1", slug: "admin", role: "admin" });
const investorToken = tokenFor({ userId: "i1", slug: "investor1", role: "investor" });

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/cattle/:cowId/weights
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("GET /api/cattle/:cowId/weights", () => {
  beforeEach(() => mockQuery.mockReset());

  test("400 for non-numeric cowId", async () => {
    const res = await request(app).get("/api/cattle/abc/weights");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid cowid/i);
  });

  test("200 returns weights array", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 2,
      rows: [
        { weight_id: 1, cow_id: 5, weight_date: "2024-01-01", weight_lbs: 700, weight_type: "arrival", location_code: "LOT1", created_at: new Date() },
        { weight_id: 2, cow_id: 5, weight_date: "2024-02-01", weight_lbs: 780, weight_type: "sale", location_code: "LOT1", created_at: new Date() },
      ],
    });
    const res = await request(app).get("/api/cattle/5/weights");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.cowId).toBe("5");
  });

  test("200 returns empty array when cow has no weights", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(app).get("/api/cattle/99/weights");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  test("500 on db error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB error"));
    const res = await request(app).get("/api/cattle/5/weights");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch cow weights/i);
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/cattle/:cowId/health
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("GET /api/cattle/:cowId/health", () => {
  beforeEach(() => mockQuery.mockReset());

  test("400 for non-numeric cowId", async () => {
    const res = await request(app).get("/api/cattle/xyz/health");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid cowid/i);
  });

  test("200 returns health records", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        health_record_id: 10,
        cow_id: 5,
        vaccine_name: "BRD Shield",
        administration_date: "2024-03-01",
        health_program_name: "Premium",
        certification_number: "CERT-001",
        verified_flag: true,
        created_at: new Date(),
      }],
    });
    const res = await request(app).get("/api/cattle/5/health");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.items[0].vaccine_name).toBe("BRD Shield");
  });

  test("500 on db error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB error"));
    const res = await request(app).get("/api/cattle/5/health");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch cow health/i);
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/cattle/:cowId
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("GET /api/cattle/:cowId", () => {
  beforeEach(() => mockQuery.mockReset());

  test("400 for non-numeric cowId", async () => {
    const res = await request(app).get("/api/cattle/bad-id");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid cowid/i);
  });

  test("404 when cow not found", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(app).get("/api/cattle/999");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/cow not found/i);
  });

  test("200 returns cow details", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        animal_id: 5,
        herd_id: 2,
        registration_number: "REG-001",
        official_id: "TAG-001",
        animal_name: "Bessie",
        breed_code: "AN",
        sex_code: "C",
        birth_date: "2022-01-15",
        sire_registration_number: null,
        dam_registration_number: null,
        is_genomic_enhanced: false,
        created_at: new Date(),
        updated_at: new Date(),
        herd_name: "Test Herd",
        rancher_id: 1,
        latest_weight_lbs: 750,
        latest_weight_date: "2024-01-01",
        latest_health_verified: true,
        latest_vaccine_name: "BRD Shield",
        latest_health_program_name: "Premium",
        latest_health_date: "2024-01-01",
        latest_listing_value: 1500,
        latest_fair_value: 1600,
        latest_valuation_date: "2024-01-01",
      }],
    });
    const res = await request(app).get("/api/cattle/5");
    expect(res.status).toBe(200);
    expect(res.body.animal_name).toBe("Bessie");
  });

  test("500 on db error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB error"));
    const res = await request(app).get("/api/cattle/5");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch cow details/i);
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PATCH /api/cattle/:cowId
// Security fix 2026-09-21: now requires requireAuth + requireRole(rancher,
// feedlot, admin), plus an ownership check (the cow's herd.rancher_id must
// match the caller, unless the caller is an admin). Every case below now
// sends an Authorization header, and the ownership-lookup query is always
// the FIRST mockQuery call in a handler run (before the UPDATE).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("PATCH /api/cattle/:cowId", () => {
  beforeEach(() => mockQuery.mockReset());

  test("401 when no Authorization header is sent", async () => {
    const res = await request(app).patch("/api/cattle/5").send({ animalName: "Daisy" });
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("401 with an invalid/garbage token", async () => {
    const res = await request(app)
      .patch("/api/cattle/5")
      .set("Authorization", "Bearer not-a-real-token")
      .send({ animalName: "Daisy" });
    expect(res.status).toBe(401);
  });

  test("403 when caller's role is investor (not rancher/feedlot/admin)", async () => {
    const res = await request(app)
      .patch("/api/cattle/5")
      .set(auth(investorToken))
      .send({ animalName: "Daisy" });
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("400 for non-numeric cowId", async () => {
    const res = await request(app)
      .patch("/api/cattle/bad")
      .set(auth(rancherToken))
      .send({ animalName: "Daisy" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid cowid/i);
  });

  test("404 when cow does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // owner lookup: no such cow
    const res = await request(app)
      .patch("/api/cattle/999")
      .set(auth(rancherToken))
      .send({ animalName: "Ghost" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/cow not found/i);
  });

  test("403 when the cow's herd belongs to a different rancher", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ animal_id: 5, rancher_id: OTHER_RANCHER_ID }],
    });
    const res = await request(app)
      .patch("/api/cattle/5")
      .set(auth(rancherToken)) // logged in as RANCHER_ID, cow belongs to OTHER_RANCHER_ID
      .send({ animalName: "Daisy" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not allowed to edit this cow/i);
    expect(mockQuery).toHaveBeenCalledTimes(1); // never reached the UPDATE
  });

  test("400 when no valid fields provided (owner, after ownership passes)", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ animal_id: 5, rancher_id: RANCHER_ID }],
    });
    const res = await request(app)
      .patch("/api/cattle/5")
      .set(auth(rancherToken))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no valid fields/i);
  });

  test("400 for invalid sexCode (owner, after ownership passes)", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ animal_id: 5, rancher_id: RANCHER_ID }],
    });
    const res = await request(app)
      .patch("/api/cattle/5")
      .set(auth(rancherToken))
      .send({ sexCode: "Z" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid sexcode/i);
  });

  test("200 updates animalName successfully when caller owns the herd", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ animal_id: 5, rancher_id: RANCHER_ID }] }) // owner lookup
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ animal_id: 5, animal_name: "Daisy" }] });    // UPDATE
    const res = await request(app)
      .patch("/api/cattle/5")
      .set(auth(rancherToken))
      .send({ animalName: "Daisy" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/updated successfully/i);
    expect(res.body.cow.animal_name).toBe("Daisy");
  });

  test("200 updates sexCode with valid uppercase value", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ animal_id: 5, rancher_id: RANCHER_ID }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ animal_id: 5, sex_code: "B" }] });
    const res = await request(app)
      .patch("/api/cattle/5")
      .set(auth(rancherToken))
      .send({ sexCode: "b" }); // lowercase input
    expect(res.status).toBe(200);
    // Verify the UPDATE query (2nd call) received the uppercased value
    const queryArgs = mockQuery.mock.calls[1][1];
    expect(queryArgs[0]).toBe("B");
  });

  test("200 lets an admin edit a cow it does not own", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ animal_id: 5, rancher_id: OTHER_RANCHER_ID }] }) // owner lookup
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ animal_id: 5, animal_name: "Daisy" }] });          // UPDATE
    const res = await request(app)
      .patch("/api/cattle/5")
      .set(auth(adminToken))
      .send({ animalName: "Daisy" });
    expect(res.status).toBe(200);
    expect(res.body.cow.animal_name).toBe("Daisy");
  });

  test("500 on db error during update", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ animal_id: 5, rancher_id: RANCHER_ID }] }) // owner lookup ok
      .mockRejectedValueOnce(new Error("DB error"));                                            // UPDATE fails
    const res = await request(app)
      .patch("/api/cattle/5")
      .set(auth(rancherToken))
      .send({ animalName: "Daisy" });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to update cow/i);
  });

  test("500 when the ownership lookup itself fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB error"));
    const res = await request(app)
      .patch("/api/cattle/5")
      .set(auth(rancherToken))
      .send({ animalName: "Daisy" });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to verify cow ownership/i);
  });
});