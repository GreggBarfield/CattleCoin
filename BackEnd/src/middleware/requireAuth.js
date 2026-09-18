import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

// Verifies the Authorization: Bearer <token> header and attaches the
// decoded payload (userId, slug, role, email) to req.user.
// Any route using this can trust req.user - it is no longer something
// the client can just claim via a header or body field.
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Use after requireAuth to restrict a route to specific roles, e.g.
// router.post("/herds", requireAuth, requireRole("rancher"), handler)
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: insufficient role" });
    }
    next();
  };
}
