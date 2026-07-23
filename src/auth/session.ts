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
}

export function getSession(project: ProjectId): Session | undefined {
  const session = sessions.get(project);
  if (!session) return undefined;
  if (session.expiresAt - EXPIRY_SKEW_MS <= Date.now()) {
    sessions.delete(project);
    return undefined;
  }
  return session;
}

export function clearSession(project: ProjectId): void {
  sessions.delete(project);
  challenges.delete(project);
}

export function getToken(project: ProjectId): string | null {
  return getSession(project)?.token ?? null;
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
