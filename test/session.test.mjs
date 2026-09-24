// Cross-brand token reuse. Runs with persistence off so nothing touches the
// real ~/.ic-content-mcp/sessions.json.
process.env.ICMCP_PERSIST_SESSIONS = "0";

import { test } from "node:test";
import assert from "node:assert/strict";

const { setSession, clearSession, getToken, tokenSource } = await import(
  "../dist/auth/session.js"
);

const USER = { id: 1, email: "seo@istanbul-care.com", full_name: "SEO", role: "admin" };

test("a token from one brand carries calls to another", () => {
  // All tenants are configured with the SAME JWT secret and the token's
  // subject is the e-mail, which each tenant resolves against its own users.
  // Making an editor collect ten one-time codes would be ceremony, not safety.
  clearSession("istanbul-care");
  clearSession("luneste-clinic");
  setSession("istanbul-care", "tok-abc", 60, USER);

  assert.equal(getToken("luneste-clinic"), "tok-abc");
  assert.equal(tokenSource("luneste-clinic"), "istanbul-care");
  clearSession("istanbul-care");
});

test("a brand's own login wins over a borrowed one", () => {
  clearSession("istanbul-care");
  clearSession("luneste-clinic");
  setSession("istanbul-care", "tok-ic", 60, USER);
  setSession("luneste-clinic", "tok-lc", 60, USER);

  assert.equal(getToken("luneste-clinic"), "tok-lc");
  assert.equal(tokenSource("luneste-clinic"), "luneste-clinic");
  clearSession("istanbul-care");
  clearSession("luneste-clinic");
});

test("no login anywhere means no token", () => {
  clearSession("istanbul-care");
  clearSession("luneste-clinic");
  assert.equal(getToken("luneste-clinic"), null);
  assert.equal(tokenSource("luneste-clinic"), null);
});

test("an expired session is not lent out", () => {
  clearSession("istanbul-care");
  clearSession("luneste-clinic");
  setSession("istanbul-care", "tok-stale", -1, USER);
  assert.equal(getToken("luneste-clinic"), null);
});

test("a signed-in session lasts the day, not the hour", async () => {
  // expires_in comes back as MINUTES (1440) and setSession takes minutes.
  // Treating it as seconds once cost every session 23 of its 24 hours, which
  // reads to the user as "it keeps logging me out".
  const { describeSessions } = await import("../dist/auth/session.js");
  clearSession("istanbul-care");
  setSession("istanbul-care", "tok", 1440, USER);
  const row = describeSessions().find((r) => r.project === "istanbul-care");
  assert.ok(
    row.minutesRemaining > 1400,
    `expected ~24h, got ${row.minutesRemaining} minutes`,
  );
  clearSession("istanbul-care");
});
