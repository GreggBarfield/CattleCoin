export default {
  testEnvironment: "node",
  transform: {},          // no Babel — Jest handles ESM via --experimental-vm-modules
  testMatch: ["**/tests/**/*.test.js"],
  // requireAuth.js reads JWT_SECRET from process.env at module load time.
  // Some test files set it themselves before their own imports, but not all
  // of them did, so any suite that hit an auth-gated route without its own
  // fallback got JWT_SECRET as undefined and every request 401'd. Setting it
  // here runs before any test file's imports, so it's a single fix for all
  // of them - see tests/jest.setup.js.
  setupFiles: ["<rootDir>/tests/jest.setup.js"],
};
