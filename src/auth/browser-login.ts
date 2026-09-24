/**
 * Signing in through the browser, so no secret ever passes through the chat.
 *
 * The old flow asked the agent for an e-mail, a password and then a one-time
 * code, which meant all three were typed into a conversation, stored in its
 * transcript, and repeated for every brand. This replaces it with the shape
 * people already know: a link, a login page, done.
 *
 * `login` starts a one-shot HTTP server bound to 127.0.0.1 on a random port
 * and hands back a URL carrying a nonce. The page it serves posts the
 * credentials straight from the browser to this process, which forwards them
 * to the brand's API and keeps the token. The agent sees a URL and, later, a
 * list of brands — never a credential.
 *
 * After the token is issued it is tried against every brand. They share a JWT
 * secret but not a users table, so the token is genuine everywhere and
 * resolves to a person only where that e-mail has an account. Probing once,
 * here, is what lets the agent say "you don't have access to that brand"
 * instead of discovering it halfway through an edit.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

import { PROJECT_IDS, getProject, type ProjectId } from "../config/projects.js";
import { setSession, getSession, getToken, type AuthedUser } from "./session.js";

const FLOW_TIMEOUT_MS = 10 * 60_000;

interface LoginOk {
  status: "authenticated";
  access_token: string;
  expires_in: number;
  user: AuthedUser;
}
interface LoginChallenge {
  status: "otp_required";
  challenge_id: string;
  expires_in: number;
  destination: string;
}
type LoginReply = LoginOk | LoginChallenge;

export interface BrandAccess {
  project: ProjectId;
  /** "yes" — usable. "no" — the account does not exist here. "unknown" — the
   *  check itself failed, which is NOT the same thing and must not be shown
   *  as a refusal. */
  access: "yes" | "no" | "unknown";
  role?: string;
  /** Why, when access is "no" or "unknown". */
  detail?: string;
}

export interface FlowResult {
  user: AuthedUser;
  access: BrandAccess[];
}

interface Flow {
  nonce: string;
  anchor: ProjectId;
  url: string;
  /** Resolves when the browser completes the sign-in. */
  done: Promise<FlowResult>;
  close: () => void;
}

let current: Flow | null = null;

/** The live flow, if one is still waiting for the browser. */
export function pendingFlow(): Flow | null {
  return current;
}

async function callLogin(project: ProjectId, body: unknown): Promise<LoginReply> {
  const { apiBaseUrl } = getProject(project);
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { detail?: unknown };
      if (typeof parsed.detail === "string") detail = parsed.detail;
    } catch {
      // Not JSON — the raw body is the best message available.
    }
    throw new Error(detail || `Sign-in failed (${response.status}).`);
  }
  return JSON.parse(text) as LoginReply;
}

/**
 * Try the token on every brand. A 200 means that brand has this e-mail in its
 * own users table; a 403 means it does not, and no amount of retrying changes
 * that.
 */
async function probeBrands(
  token: string,
  expiresIn: number,
  user: AuthedUser,
): Promise<BrandAccess[]> {
  return Promise.all(
    PROJECT_IDS.map((project) => probeOne(project, token, expiresIn, user)),
  );
}

/**
 * Ask one brand whether this token works there.
 *
 * Deliberately NOT /auth/me: that endpoint loads the avatar with its
 * translations and builds the whole permission matrix, so it can fail for
 * reasons that have nothing to do with access — and the first version of this
 * code reported every such failure as "no account", which told an editor with
 * five brands that they had three.
 *
 * /admin/languages is the cheapest authenticated read there is, and it is
 * exactly the kind of call the rest of the server makes, so a brand that
 * passes here is a brand the tools can actually use.
 */
async function probeOne(
  project: ProjectId,
  token: string,
  expiresIn: number,
  user: AuthedUser,
  attempt = 1,
): Promise<BrandAccess> {
  const { apiBaseUrl } = getProject(project);
  const base = apiBaseUrl.replace(/\/+$/, "");
  try {
    const response = await fetch(`${base}/admin/languages?limit=1`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });

    if (response.ok) {
      setSession(project, token, expiresIn / 60, user);
      const role = await roleOn(base, token);
      return { project, access: "yes", ...(role ? { role } : {}) };
    }

    // 401/403 are the real answer: this brand has no user with that e-mail.
    if (response.status === 401 || response.status === 403) {
      return { project, access: "no", detail: "no user with this e-mail here" };
    }

    // Anything else is the check failing, not permission being refused.
    if (attempt === 1) return probeOne(project, token, expiresIn, user, 2);
    return { project, access: "unknown", detail: `the brand answered ${response.status}` };
  } catch (error) {
    if (attempt === 1) return probeOne(project, token, expiresIn, user, 2);
    const reason = error instanceof Error ? error.message : String(error);
    return { project, access: "unknown", detail: `could not reach it (${reason})` };
  }
}

/** The role, if the profile endpoint feels like answering. Never load-bearing. */
async function roleOn(base: string, token: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${base}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { data?: { role?: string }; role?: string };
    return body.data?.role ?? body.role;
  } catch {
    return undefined;
  }
}

function send(res: ServerResponse, status: number, body: string, type = "text/html; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return Object.fromEntries(new URLSearchParams(raw));
}

/**
 * Start (or reuse) the browser sign-in. Returns immediately with the URL to
 * open; `done` settles once the person finishes in the browser.
 */
export async function startBrowserLogin(anchor: ProjectId): Promise<Flow> {
  if (current) return current;

  const nonce = randomBytes(24).toString("base64url");
  let settle: (result: FlowResult) => void;
  let reject: (error: Error) => void;
  const done = new Promise<FlowResult>((resolveFn, rejectFn) => {
    settle = resolveFn;
    reject = rejectFn;
  });

  // Credentials live here only between the two steps of one sign-in.
  let pending: { email: string; password: string; challengeId: string } | null = null;

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.searchParams.get("t") !== nonce && req.method !== "POST") {
        return send(res, 404, page.notFound());
      }

      if (req.method === "GET" && url.pathname === "/") {
        return send(res, 200, page.form(nonce, anchor));
      }

      if (req.method === "POST" && url.pathname === "/signin") {
        const form = await readBody(req);
        if (form.nonce !== nonce) return send(res, 403, page.notFound());
        try {
          const email = form.email ?? "";
          const password = form.password ?? "";
          const reply = await callLogin(anchor, { email, password });
          if (reply.status === "authenticated") {
            const access = await probeBrands(reply.access_token, reply.expires_in, reply.user);
            settle({ user: reply.user, access });
            setTimeout(close, 1500);
            return send(res, 200, page.done(reply.user, access));
          }
          pending = { email, password, challengeId: reply.challenge_id };
          return send(res, 200, page.otp(nonce, reply.destination));
        } catch (error) {
          return send(res, 200, page.form(nonce, anchor, (error as Error).message));
        }
      }

      if (req.method === "POST" && url.pathname === "/otp") {
        const form = await readBody(req);
        if (form.nonce !== nonce || !pending) return send(res, 403, page.notFound());
        try {
          const reply = await callLogin(anchor, {
            email: pending.email,
            password: pending.password,
            otp_code: form.otp_code,
            otp_challenge_id: pending.challengeId,
          });
          if (reply.status !== "authenticated") {
            return send(res, 200, page.otp(nonce, "your inbox", "That code was not accepted."));
          }
          const access = await probeBrands(reply.access_token, reply.expires_in, reply.user);
          pending = null;
          settle({ user: reply.user, access });
          setTimeout(close, 1500);
          return send(res, 200, page.done(reply.user, access));
        } catch (error) {
          return send(res, 200, page.otp(nonce, "your inbox", (error as Error).message));
        }
      }

      return send(res, 404, page.notFound());
    })();
  });

  const timer = setTimeout(() => {
    reject(new Error("The sign-in page timed out after 10 minutes. Call login again."));
    close();
  }, FLOW_TIMEOUT_MS);

  function close(): void {
    clearTimeout(timer);
    pending = null;
    current = null;
    server.close();
  }

  // Bind before building the URL. Reading address() straight after listen()
  // hands back null, and the URL then carries port 0 — a link that cannot
  // connect, which is the worst possible thing to show someone signing in.
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });
  const port = (server.address() as AddressInfo).port;
  const flow: Flow = {
    nonce,
    anchor,
    url: `http://127.0.0.1:${port}/?t=${nonce}`,
    done,
    close,
  };
  current = flow;
  return flow;
}

/* ---------------------------------------------------------------- *
 * The pages. Plain HTML, no build step, no network fetches — the
 * browser must be able to render them with the machine offline.
 * ---------------------------------------------------------------- */

const SHELL = (title: string, body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>
:root{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--ink:#16171a;--mute:#6b6f76;--line:#e2e2df;--accent:#1f6f5c}
@media (prefers-color-scheme:dark){:root{--bg:#141517;--card:#1c1e21;--ink:#f0f0ee;--mute:#9aa0a6;--line:#2c2f33}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;width:100%;max-width:400px}
h1{font-size:19px;margin:0 0 4px;letter-spacing:-.01em}
p.sub{margin:0 0 20px;color:var(--mute);font-size:13.5px}
label{display:block;font-size:12.5px;font-weight:600;margin:14px 0 5px;letter-spacing:.02em}
input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font-size:15px}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{width:100%;margin-top:20px;padding:11px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-size:15px;font-weight:600;cursor:pointer}
.err{margin-top:16px;padding:10px 12px;border-radius:8px;background:#fdecec;color:#8c1d18;font-size:13.5px}
@media (prefers-color-scheme:dark){.err{background:#3a1d1c;color:#f5b1ac}}
ul{list-style:none;padding:0;margin:16px 0 0}
li{display:flex;gap:9px;padding:7px 0;border-bottom:1px solid var(--line);font-size:14px}
li:last-child{border-bottom:0}
.no{color:var(--mute)}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);padding:1px 5px;border-radius:4px}
</style></head><body><div class="card">${body}</div></body></html>`;

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

const page = {
  form: (nonce: string, anchor: ProjectId, error?: string): string =>
    SHELL(
      "Sign in",
      `<h1>Sign in to the content admin</h1>
<p class="sub">Signing in once covers every brand your account exists on. Nothing you type here reaches the chat.</p>
<form method="post" action="/signin">
<input type="hidden" name="nonce" value="${esc(nonce)}">
<label for="email">Work e-mail</label>
<input id="email" name="email" type="email" autocomplete="username" required autofocus>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Continue</button>
</form>
${error ? `<div class="err">${esc(error)}</div>` : ""}
<p class="sub" style="margin:18px 0 0">Verifying against <code>${esc(getProject(anchor).name)}</code>.</p>`,
    ),

  otp: (nonce: string, destination: string, error?: string): string =>
    SHELL(
      "Enter your code",
      `<h1>Check your e-mail</h1>
<p class="sub">A one-time code went to ${esc(destination)}. It is good for a few minutes.</p>
<form method="post" action="/otp">
<input type="hidden" name="nonce" value="${esc(nonce)}">
<label for="otp">Code</label>
<input id="otp" name="otp_code" inputmode="numeric" autocomplete="one-time-code" required autofocus>
<button type="submit">Finish signing in</button>
</form>
${error ? `<div class="err">${esc(error)}</div>` : ""}`,
    ),

  done: (user: AuthedUser, access: BrandAccess[]): string => {
    const yes = access.filter((a) => a.access === "yes");
    const no = access.filter((a) => a.access === "no");
    const unknown = access.filter((a) => a.access === "unknown");
    const row = (a: BrandAccess, mark: string, dim: boolean): string =>
      `<li${dim ? ' class="no"' : ""}>${mark} ${esc(getProject(a.project).name)}${
        a.role ? ` <span class="no">· ${esc(a.role)}</span>` : ""
      }</li>`;
    return SHELL(
      "Signed in",
      `<h1>Signed in as ${esc(user.full_name || user.email)}</h1>
<p class="sub">You can close this tab and go back to the chat.</p>
<ul>${yes.map((a) => row(a, "✓", false)).join("")}</ul>
${
  unknown.length
    ? `<div class="err">Could not check ${unknown
        .map((a) => esc(getProject(a.project).name))
        .join(", ")} — that is a failed check, not a refusal. Ask Claude to run
        recheck_access.</div>`
    : ""
}
${
  no.length
    ? `<p class="sub" style="margin:18px 0 0">No account on ${no
        .map((a) => esc(getProject(a.project).name))
        .join(", ")} — ask an admin if you need one.</p>`
    : ""
}`,
    );
  },

  notFound: (): string => SHELL("Not found", `<h1>Nothing here</h1><p class="sub">This sign-in link is not valid any more. Ask Claude to start the login again.</p>`),
};

/** Re-run the access probe with the token already held. */
export async function recheckAccess(): Promise<BrandAccess[] | null> {
  for (const project of PROJECT_IDS) {
    const token = getToken(project);
    if (token) {
      const session = getSession(project);
      if (!session) continue;
      const remainingSeconds = Math.max(60, (session.expiresAt - Date.now()) / 1000);
      return probeBrands(token, remainingSeconds, session.user);
    }
  }
  return null;
}
