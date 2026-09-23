// The sign-in page is the one surface a non-technical person touches, and the
// only place a password is ever typed. These check it is reachable, bound to
// loopback, and closed to anything without the one-time nonce.
process.env.ICMCP_PERSIST_SESSIONS = "0";

import { test } from "node:test";
import assert from "node:assert/strict";

const { startBrowserLogin } = await import("../dist/auth/browser-login.js");

test("the sign-in page is served on loopback and asks for a password", async () => {
  const flow = await startBrowserLogin("istanbul-care");
  try {
    assert.match(flow.url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=[A-Za-z0-9_-]{20,}$/);
    const html = await (await fetch(flow.url)).text();
    assert.match(html, /type="password"/);
    assert.match(html, /Nothing you type here reaches the chat/);
    // The brand being verified against is named, so nobody signs in blind.
    assert.match(html, /Istanbul Care/);
  } finally {
    flow.close();
  }
});

test("a post without the nonce is refused", async () => {
  const flow = await startBrowserLogin("istanbul-care");
  try {
    const base = flow.url.split("?")[0];
    const res = await fetch(`${base}signin`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "a@b.com", password: "x", nonce: "wrong" }),
    });
    assert.equal(res.status, 403);
  } finally {
    flow.close();
  }
});

test("a second login reuses the flow already waiting", async () => {
  const first = await startBrowserLogin("istanbul-care");
  try {
    assert.equal((await startBrowserLogin("luneste-clinic")).url, first.url);
  } finally {
    first.close();
  }
});
