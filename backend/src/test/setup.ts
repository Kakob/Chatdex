// Test-wide defaults. Individual tests override with vi.stubEnv when they
// need to prove boot-time guards (e.g. the JWT_SECRET length check).
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-chars-long';
process.env.WEBAUTHN_RP_ID ??= 'localhost';
process.env.WEBAUTHN_ORIGIN ??= 'http://localhost:4000';
