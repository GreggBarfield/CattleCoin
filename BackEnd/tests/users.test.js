import { jest } from "@jest/globals";

// requireAuth reads JWT_SECRET at module load time, so this must be set
// before users.js (which imports requireAuth.js) is imported below.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const mockQuery = jest.fn();
jest.unstable_mockModule("../src/db.js", () => ({ default: { query: mockQuery } }));

const { default: express }      = await import("express");
const { default: request }      = await import("supertest");
const { default: jwt }          = await import("jsonwebtoken");
const { default: usersRouter }  = await import("../src/routes/users.js");

const app = express();
app.use(express.json());
app.use("/api/users", usersRouter);

function tokenFor(user) {
  return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "1h" });
}

const rancherToken = tokenFor({ userId: "r1", slug: "rancher1", role: "rancher" });

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

describe("GET /api/users", () => {
  beforeEach(() => mockQuery.mockReset());

  // E7: this route used to need no login at all and returned everyone's
  // email address. It now requires a valid token; the email field is gone
  // from the response entirely (nothing in the app reads it).
  test("401 with no Authorization header", async () => {
    const res = await request(app).get("/api/users");
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("401 with an invalid token", async () => {
    const res = await request(app).get("/api/users").set(auth("not-a-real-token"));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("200 returns all users when no role filter, no email field", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { user_id: 1, slug: "alice", role: "investor" },
        { user_id: 2, slug: "bob",   role: "rancher" },
      ],
    });
    const res = await request(app).get("/api/users").set(auth(rancherToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toEqual({ userId: 1, slug: "alice", role: "investor" });
    expect(res.body[0].email).toBeUndefined();
  });

  test("200 filters by role query param", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 3, slug: "carol", role: "feedlot" }],
    });
    const res = await request(app).get("/api/users?role=feedlot").set(auth(rancherToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    // confirm query was parameterised with the role
    expect(mockQuery.mock.calls[0][1]).toEqual(["feedlot"]);
  });

  test("400 for invalid role", async () => {
    const res = await request(app).get("/api/users?role=superadmin").set(auth(rancherToken));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid role/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("200 with each valid role value", async () => {
    for (const role of ["investor", "rancher", "feedlot", "admin"]) {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get(`/api/users?role=${role}`).set(auth(rancherToken));
      expect(res.status).toBe(200);
    }
  });

  test("500 on DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB down"));
    const res = await request(app).get("/api/users").set(auth(rancherToken));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch users/i);
  });
});
