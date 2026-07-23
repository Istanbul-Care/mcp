import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { post } from "../api/client.js";
import { getProject } from "../config/projects.js";
import {
  challengeStatus,
  clearSession,
  describeSessions,
  getChallenge,
  resolveCredentials,
  setChallenge,
  setSession,
  type AuthedUser,
} from "../auth/session.js";
import { ok, fail, guard, projectParam } from "./helpers.js";

interface LoginChallengeResponse {
  status: "otp_required";
  challenge_id: string;
  expires_in: number;
  delivery_method: string;
  destination: string;
  message: string;
}

interface LoginSuccessResponse {
  status: "authenticated";
  access_token: string;
  token_type: string;
  expires_in: number;
  user: AuthedUser;
}

type LoginResponse = LoginChallengeResponse | LoginSuccessResponse;

export function registerAuthTools(server: McpServer): void {
  server.registerTool(
    "login",
    {
      title: "Start login (sends OTP)",
      description:
        "Step 1 of 2. Sends a one-time code to the account's e-mail for the given brand, " +
        "and returns the challenge id. The backend requires OTP for every role, so there " +
        "is no way to skip this. Follow up with submit_otp once the human reads the code. " +
        "Credentials come from the ICMCP_EMAIL / ICMCP_PASSWORD environment variables " +
        "unless passed explicitly.",
      inputSchema: {
        project: projectParam,
        email: z.string().email().optional().describe("Overrides the env credential."),
        password: z.string().optional().describe("Overrides the env credential."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, email, password }) =>
      guard(async () => {
        const credentials = resolveCredentials(project, email, password);
        const response = await post<LoginResponse>(
          project,
          "/auth/login",
          credentials,
          false,
        );

        if (response.status === "authenticated") {
          setSession(project, response.access_token, response.expires_in, response.user);
          return ok({
            project,
            authenticated: true,
            note: "This deployment issued a token without an OTP challenge.",
            user: response.user,
          });
        }

        setChallenge(project, {
          challengeId: response.challenge_id,
          email: credentials.email,
          password: credentials.password,
          destination: response.destination,
          expiresAt: Date.now() + response.expires_in * 1000,
        });

        return ok({
          project,
          otp_required: true,
          challenge_id: response.challenge_id,
          sent_to: response.destination,
          expires_in_seconds: response.expires_in,
          next_step:
            `Ask the human for the code sent to ${response.destination}, then call ` +
            `submit_otp({ project: "${project}", otp_code: "…" }).`,
        });
      }),
  );

  server.registerTool(
    "submit_otp",
    {
      title: "Complete login with OTP",
      description:
        "Step 2 of 2. Exchanges the e-mailed one-time code for an access token. The token " +
        "is held in memory for this server process only and expires on its own; it is " +
        "never written to disk.",
      inputSchema: {
        project: projectParam,
        otp_code: z.string().min(1).describe("The code from the e-mail."),
        challenge_id: z
          .string()
          .optional()
          .describe("Defaults to the pending challenge from the last login call."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, otp_code, challenge_id }) =>
      guard(async () => {
        // Check status before getChallenge — it deletes expired entries.
        const status = challengeStatus(project);
        const pending = getChallenge(project);

        if (!pending) {
          if (status === "expired") {
            return fail(
              `The code for '${project}' expired — the one-time code is only valid for ` +
                `5 minutes. Call login({ project: "${project}" }) for a fresh code and ` +
                `submit it promptly.`,
            );
          }
          return fail(
            `No login in progress for '${project}'. Call login({ project: "${project}" }) ` +
              `first, then submit the code it e-mails.`,
          );
        }

        const challengeId = challenge_id ?? pending.challengeId;

        const response = await post<LoginResponse>(
          project,
          "/auth/login",
          {
            email: pending.email,
            password: pending.password,
            otp_code,
            otp_challenge_id: challengeId,
          },
          false,
        );

        if (response.status !== "authenticated") {
          return fail(
            `Expected a token but the backend issued another challenge for '${project}'.`,
          );
        }

        setSession(project, response.access_token, response.expires_in, response.user);
        return ok({
          project,
          authenticated: true,
          user: {
            id: response.user.id,
            email: response.user.email,
            full_name: response.user.full_name,
            role: response.user.role,
          },
          expires_in_minutes: response.expires_in,
        });
      }),
  );

  server.registerTool(
    "auth_status",
    {
      title: "Show logged-in brands",
      description:
        "Which brands currently hold a valid token, and how long each has left. " +
        "Expired sessions are dropped rather than listed.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      guard(async () => {
        const sessions = describeSessions();
        return ok(
          sessions.length === 0
            ? { authenticated_projects: [], note: "No active sessions — call login first." }
            : { authenticated_projects: sessions },
        );
      }),
  );

  server.registerTool(
    "logout",
    {
      title: "Drop a brand's session",
      description: "Forgets the in-memory token and any pending OTP challenge for a brand.",
      inputSchema: { project: projectParam },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ project }) =>
      guard(async () => {
        clearSession(project);
        return ok({ project, cleared: true, brand: getProject(project).name });
      }),
  );
}
