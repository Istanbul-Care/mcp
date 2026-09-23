import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ProjectId } from "../config/projects.js";

export interface AuthedUser {
  id: number;
  email: string;
  full_name: string;
  role: string;
}

interface Session {
  token: string;
  /** Epoch ms when the JWT stops being accepted. */
  expiresAt: number;
  user: AuthedUser;
}

interface PendingChallenge {
  challengeId: string;
  email: string;
  password: string;
  destination: string;
  expiresAt: number;
}

const sessions = new Map<ProjectId, Session>();
const challenges = new Map<ProjectId, PendingChallenge>();

const EXPIRY_SKEW_MS = 30_000;

/**
 * Where authenticated sessions are cached so they survive an MCP server
 * restart (an external redeploy would otherwise drop the in-memory JWT and
 * force a fresh OTP login mid-operation). Override with ICMCP_SESSION_FILE.
 * Holds bearer tokens at rest — written 0600 — so it trades a little of the
 * OTP-per-login guarantee for restart resilience. Set ICMCP_PERSIST_SESSIONS=0
 * to disable entirely.
 */
// Read env lazily (not at module load) so tests can toggle persistence off
// after import without the fake token leaking to the real session file.
const persistEnabled = (): boolean => process.env.ICMCP_PERSIST_SESSIONS !== "0";
const sessionFile = (): string =>
  process.env.ICMCP_SESSION_FILE ||
  join(homedir(), ".ic-content-mcp", "sessions.json");

/** Reload persisted, still-valid sessions on startup. Best-effort. */
function loadSessions(): void {
  const SESSION_FILE = sessionFile();
  if (!persistEnabled() || !existsSync(SESSION_FILE)) return;
  try {
    const raw = readFileSync(SESSION_FILE, "utf8");
    const data = JSON.parse(raw) as Record<string, Session>;
    const now = Date.now();
    for (const [project, session] of Object.entries(data)) {
      if (session?.token && session.expiresAt - EXPIRY_SKEW_MS > now) {
        sessions.set(project as ProjectId, session);
      }
    }
  } catch {
    // Corrupt / unreadable cache is non-fatal — start with no sessions.
  }
}

/** Persist the current (non-expired) sessions to disk. Best-effort, never throws. */
function persistSessions(): void {
  if (!persistEnabled()) return;
  try {
    const SESSION_FILE = sessionFile();
    const now = Date.now();
    const out: Record<string, Session> = {};
    for (const [project, session] of sessions) {
      if (session.expiresAt - EXPIRY_SKEW_MS > now) out[project] = session;
    }
    const dir = dirname(SESSION_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(SESSION_FILE, JSON.stringify(out), { mode: 0o600 });
  } catch {
    // Disk unavailable / read-only — persistence is a bonus, not a requirement.
  }
}

loadSessions();

export function setChallenge(project: ProjectId, challenge: PendingChallenge): void {
  challenges.set(project, challenge);
}

export function getChallenge(project: ProjectId): PendingChallenge | undefined {
  const pending = challenges.get(project);
  if (!pending) return undefined;
  if (pending.expiresAt <= Date.now()) {
    challenges.delete(project);
    return undefined;
  }
  return pending;
}

export function clearChallenge(project: ProjectId): void {
  challenges.delete(project);
}

export function challengeStatus(
  project: ProjectId,
): "active" | "expired" | "none" {
  const pending = challenges.get(project);
  if (!pending) return "none";
  return pending.expiresAt <= Date.now() ? "expired" : "active";
}

export function setSession(
  project: ProjectId,
  token: string,
  expiresInMinutes: number,
  user: AuthedUser,
): void {
  sessions.set(project, {
    token,
    expiresAt: Date.now() + expiresInMinutes * 60_000,
    user,
  });
  challenges.delete(project);
  persistSessions();
}

export function getSession(project: ProjectId): Session | undefined {
  const session = sessions.get(project);
  if (!session) return undefined;
  if (session.expiresAt - EXPIRY_SKEW_MS <= Date.now()) {
    sessions.delete(project);
    persistSessions();
    return undefined;
  }
  return session;
}

export function clearSession(project: ProjectId): void {
  sessions.delete(project);
  challenges.delete(project);
  persistSessions();
}

/**
 * A token for this brand — or, failing that, anyone else's.
 *
 * Every tenant is configured with the SAME JWT secret, and the token carries
 * the user's e-mail as its subject, which each tenant then looks up in its own
 * users table. So a token minted by one brand authenticates against all of
 * them, for a person whose account exists there. Without this fallback the
 * server would send an editor to collect ten separate one-time codes out of
 * their inbox to do one afternoon's work.
 *
 * It is a borrow, not an escalation: the receiving brand still resolves the
 * e-mail against its own users and applies its own role. A person with no
 * account on that brand gets a 403 there, exactly as they should.
 */
export function getToken(project: ProjectId): string | null {
  const own = getSession(project);
  if (own) return own.token;
  for (const other of sessions.keys()) {
    const borrowed = getSession(other);
    if (borrowed) return borrowed.token;
  }
  return null;
}

/** Which brand's login is actually carrying this call, for auth_status. */
export function tokenSource(project: ProjectId): ProjectId | null {
  if (getSession(project)) return project;
  for (const other of sessions.keys()) {
    if (getSession(other)) return other;
  }
  return null;
}

export function describeSessions(): Array<{
  project: ProjectId;
  email: string;
  role: string;
  expiresAt: string;
  minutesRemaining: number;
}> {
  const now = Date.now();
  const rows: ReturnType<typeof describeSessions> = [];
  for (const project of sessions.keys()) {
    const session = getSession(project);
    if (!session) continue;
    rows.push({
      project,
      email: session.user.email,
      role: session.user.role,
      expiresAt: new Date(session.expiresAt).toISOString(),
      minutesRemaining: Math.max(0, Math.round((session.expiresAt - now) / 60_000)),
    });
  }
  return rows;
}

export function resolveCredentials(
  project: ProjectId,
  email?: string,
  password?: string,
): { email: string; password: string } {
  const suffix = project.toUpperCase().replace(/-/g, "_");
  const resolvedEmail =
    email ?? process.env[`ICMCP_EMAIL_${suffix}`] ?? process.env.ICMCP_EMAIL;
  const resolvedPassword =
    password ?? process.env[`ICMCP_PASSWORD_${suffix}`] ?? process.env.ICMCP_PASSWORD;

  if (!resolvedEmail || !resolvedPassword) {
    throw new Error(
      `No credentials for '${project}'. Pass email/password to the login tool, ` +
      `or set ICMCP_EMAIL_${suffix} / ICMCP_PASSWORD_${suffix} (or the shared ` +
      `ICMCP_EMAIL / ICMCP_PASSWORD) in the MCP server environment.`,
    );
  }
  return { email: resolvedEmail, password: resolvedPassword };
}
