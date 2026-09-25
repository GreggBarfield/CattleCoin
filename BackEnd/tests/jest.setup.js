// Runs once per test file, before that file's own imports (see
// jest.config.js's setupFiles). requireAuth.js reads JWT_SECRET from
// process.env at module load time, so it has to be set before anything
// requires that module - individual test files can no longer be relied on
// to do this themselves consistently (some did, some didn't, which was the
// cause of a long-standing block of auth-gated suites failing with generic
// 401s). The `||` keeps this a no-op for any file/environment that already
// has a real value set.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
