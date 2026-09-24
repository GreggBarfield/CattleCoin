import { jest } from "@jest/globals";

// requireAuth reads JWT_SECRET at module load time, so set it before the
// router (which imports requireAuth.js) is imported below.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const mockQuery = jest.fn();
jest.unstable_mockModule("../src/db.js", () => ({ default: { query: mockQuery } }));

const { default: express }       = await import("express");
const { default: request }       = await import("supertest");
const { default: jwt }           = await import("jsonwebtoken");
const { default: bcrypt }        = await import("bcryptjs");
const { default: accountRouter } = await import("../src/routes/account.js");

const app = express();
app.use(express.json());
app.use("/api/account", accountRouter);

function tokenFor(user) {
  return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "1h" });
}
const rancherToken = tokenFor({ userId: "u-r1", slug: "rancher1", role: "rancher", email: "r1@x.dev" });
const auth = (t) => ({ Authorization: `Bearer ${t}` });

const ROW = {
  user_id: "u-r1", slug: "rancher1", role: "rancher", email: "r1@x.dev",
  created_at: "2026-09-01T12:00:00Z", profile_updated_at: null,
  full_name: null, business_name: null, phone: null,
  address_line1: null, address_line2: null, city: null, state: null, postal_code: null,
};

describe("account routes need a login", () => {
  beforeEach(() => mockQuery.mockReset());

  test.each([
    ["get", "/api/account/me"],
    ["put", "/api/account/me"],
    ["post", "/api/account/password"],
  ])("%s %s is 401 with no token", async (method, path) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("401 with a bad token", async () => {
    const res = await request(app).get("/api/account/me").set(auth("nope"));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("GET /api/account/me", () => {
  beforeEach(() => mockQuery.mockReset());

  test("returns the logged-in user's own account, looked up by token userId", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...ROW, full_name: "Gregg B", phone: "979-555-0100" }] });
    const res = await request(app).get("/api/account/me").set(auth(rancherToken));
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(["u-r1"]);
    expect(res.body).toMatchObject({
      userId: "u-r1", username: "rancher1", role: "rancher", email: "r1@x.dev",
      fullName: "Gregg B", phone: "979-555-0100", businessName: null,
    });
    expect(res.body.password_hash).toBeUndefined();
    expect(res.body.passwordHash).toBeUndefined();
  });

  test("404 when the account row is gone", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/account/me").set(auth(rancherToken));
    expect(res.status).toBe(404);
  });

  test("500 does not leak the database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("secret db detail"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(app).get("/api/account/me").set(auth(rancherToken));
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/secret db detail/);
  });
});

describe("PUT /api/account/me", () => {
  beforeEach(() => mockQuery.mockReset());

  test("saves only the fields sent, trims them, clears empty ones", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "u-r1" }] })
      .mockResolvedValueOnce({ rows: [{ ...ROW, full_name: "Gregg B" }] });
    const res = await request(app).put("/api/account/me").set(auth(rancherToken))
      .send({ fullName: "  Gregg B  ", businessName: "", city: null });
    expect(res.status).toBe(200);
    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/full_name = \$1, business_name = \$2, city = \$3, profile_updated_at/);
    expect(values).toEqual(["Gregg B", null, null, "u-r1"]);
    expect(res.body.fullName).toBe("Gregg B");
  });

  test("ignores email, role and username - they can't be changed here", async () => {
    const res = await request(app).put("/api/account/me").set(auth(rancherToken))
      .send({ email: "evil@x.dev", role: "admin", username: "admin" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Nothing to save.");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("400 on a too-long value, naming the field", async () => {
    const res = await request(app).put("/api/account/me").set(auth(rancherToken))
      .send({ postalCode: "1".repeat(21) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ZIP \/ postal code can be at most 20/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("400 on a junk phone number, accepts a normal one with an extension", async () => {
    let res = await request(app).put("/api/account/me").set(auth(rancherToken)).send({ phone: "call me maybe" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Phone/);

    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "u-r1" }] })
      .mockResolvedValueOnce({ rows: [{ ...ROW, phone: "(979) 555-0100 x12" }] });
    res = await request(app).put("/api/account/me").set(auth(rancherToken)).send({ phone: "(979) 555-0100 x12" });
    expect(res.status).toBe(200);
  });

  test("400 when a field isn't text", async () => {
    const res = await request(app).put("/api/account/me").set(auth(rancherToken)).send({ city: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/City must be text/);
  });
});

describe("POST /api/account/password", () => {
  beforeEach(() => mockQuery.mockReset());

  test("400 when the current password is missing", async () => {
    const res = await request(app).post("/api/account/password").set(auth(rancherToken))
      .send({ newPassword: "longenough1" });
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("400 when the new password is too short", async () => {
    const res = await request(app).post("/api/account/password").set(auth(rancherToken))
      .send({ currentPassword: "oldpass12", newPassword: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 8/);
  });

  test("400 when the new password is over 72 bytes", async () => {
    const res = await request(app).post("/api/account/password").set(auth(rancherToken))
      .send({ currentPassword: "oldpass12", newPassword: "a".repeat(73) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 72/);
  });

  test("400 when new equals current", async () => {
    const res = await request(app).post("/api/account/password").set(auth(rancherToken))
      .send({ currentPassword: "samepass12", newPassword: "samepass12" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different/);
  });

  test("400 (not 401) when the current password is wrong, and nothing is written", async () => {
    const hash = await bcrypt.hash("rightpass12", 4);
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: hash }] });
    const res = await request(app).post("/api/account/password").set(auth(rancherToken))
      .send({ currentPassword: "wrongpass12", newPassword: "brandnew123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/current password is not correct/);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test("changes the password for the token's own user only", async () => {
    const hash = await bcrypt.hash("rightpass12", 4);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ password_hash: hash }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post("/api/account/password").set(auth(rancherToken))
      .send({ currentPassword: "rightpass12", newPassword: "brandnew123" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const [sql, values] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/UPDATE users SET password_hash = \$1 WHERE user_id = \$2/);
    expect(values[1]).toBe("u-r1");
    expect(await bcrypt.compare("brandnew123", values[0])).toBe(true);
  });
});
