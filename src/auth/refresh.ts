/**
 * Getting a new token without asking anyone.
 *
 * The backend issues tokens that live 24 hours, so a person who signs in on
 * Monday is signed out on Tuesday. For someone editing content every day that
 * is a daily interruption for no security gain — the credentials that would
 * mint the new token are the same ones that minted the old one.
 *
 * So when a call comes back 401 and credentials are configured, the client
 * signs in again on the spot and retries. Nobody sees it happen.
 *
 * This only works for an account the backend has marked `otp_exempt`, which is
 * what service accounts are. For everyone else the backend answers the refresh
 * with an OTP challenge, there is no human in the loop to read the code, and
 * the original 401 is surfaced unchanged — a silent failure would be worse
 * than an honest one.
 */

import { getProject, type ProjectId } from "../config/projects.js";
import { resolveCredentials, setSession, type AuthedUser } from "./session.js";

interface Authenticated {
  status: "authenticated";
  access_token: string;
  expires_in: number;
  user: AuthedUser;
}
interface Challenged {
  status: "otp_required";
}

/** One refresh at a time per brand: a burst of 401s must not mint a burst of logins. */
const inFlight = new Map<ProjectId, Promise<string | null>>();

export function canRefresh(project: ProjectId): boolean {
  try {
    resolveCredentials(project);
    return true;
  } catch {
    return false;
  }
}

export async function refreshToken(project: ProjectId): Promise<string | null> {
  const existing = inFlight.get(project);
  if (existing) return existing;

  const attempt = (async (): Promise<string | null> => {
    let credentials;
    try {
      credentials = resolveCredentials(project);
    } catch {
      return null; // No stored credentials — nothing to refresh with.
    }

    const { apiBaseUrl } = getProject(project);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credentials),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return null;
      const reply = (await response.json()) as Authenticated | Challenged;
      // An OTP challenge means a person has to read an e-mail. Not our call.
      if (reply.status !== "authenticated") return null;
      // expires_in is MINUTES here — the backend hands back
      // ACCESS_TOKEN_EXPIRE_MINUTES unchanged — and setSession wants minutes
      // too. Dividing by 60 once cost every session 23 of its 24 hours.
      setSession(project, reply.access_token, reply.expires_in, reply.user);
      return reply.access_token;
    } catch {
      return null;
    }
  })();

  inFlight.set(project, attempt);
  try {
    return await attempt;
  } finally {
    inFlight.delete(project);
  }
}
