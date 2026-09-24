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
import { startBrowserLogin, recheckAccess } from "../auth/browser-login.js";
import type { ProjectId } from "../config/projects.js";

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
      title: "Sign in",
      description:
        "Opens a sign-in page in the browser and returns its URL. Give that URL to the " +
        "person and wait — they type their e-mail, password and the e-mailed code into the " +
        "page, not into this chat, so no secret ever enters the conversation or its " +
        "transcript. One sign-in covers EVERY brand their account exists on; the result " +
        "lists which ones. Brands they have no account on are reported as such, and calls " +
        "against those will say so rather than failing obscurely.",
      inputSchema: {
        project: projectParam
          .optional()
          .describe(
            "Which brand to verify the password against. Any brand the person has an " +
              "account on works — the token covers the rest. Defaults to istanbul-care.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project }) =>
      guard(async () => {
        const anchor = (project ?? "istanbul-care") as ProjectId;
        const flow = await startBrowserLogin(anchor);

        // Wait for the browser, but not forever: hand the URL back quickly if
        // the person has not finished, so the agent can show it rather than
        // sitting silent on a tool call.
        const outcome = await Promise.race([
          flow.done.then((result) => ({ kind: "done" as const, result })),
          new Promise<{ kind: "waiting" }>((resolve) =>
            setTimeout(() => resolve({ kind: "waiting" }), 120_000),
          ),
        ]).catch((error: unknown) => ({
          kind: "failed" as const,
          message: error instanceof Error ? error.message : String(error),
        }));

        if (outcome.kind === "waiting") {
          return ok({
            open_this_url: flow.url,
            status: "waiting for the browser",
            tell_the_user:
              `Open ${flow.url} and sign in there. Do not type your password or the code ` +
              `here. Call auth_status when you are done.`,
          });
        }
        if (outcome.kind === "failed") return fail(outcome.message);

        const by = (state: string) =>
          outcome.result.access.filter((a) => a.access === state).map((a) => a.project);
        const unknown = outcome.result.access.filter((a) => a.access === "unknown");
        return ok({
          signed_in_as: outcome.result.user.email,
          brands_you_can_work_on: by("yes"),
          brands_without_an_account: by("no"),
          brands_we_could_not_check: unknown.map((a) => `${a.project} (${a.detail})`),
          note:
            unknown.length > 0
              ? "The brands under brands_we_could_not_check were NOT refused — the check " +
                "itself failed. Tell the user that, and offer recheck_access; do not report " +
                "them as missing access."
              : by("no").length > 0
                ? "Those brands have no user with this e-mail. An admin has to add one."
                : "Every brand accepted this account.",
        });
      }),
  );

  server.registerTool(
    "recheck_access",
    {
      title: "Re-check which brands this login reaches",
      description:
        "Runs the per-brand access check again using the token already held, without another " +
        "sign-in. Use it when login reported brands it could not check, or after an admin " +
        "adds the account to a brand.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () =>
      guard(async () => {
        const access = await recheckAccess();
        if (!access) return fail("Not signed in — call login first.");
        const by = (state: string) =>
          access.filter((a) => a.access === state).map((a) => a.project);
        return ok({
          brands_you_can_work_on: by("yes"),
          brands_without_an_account: by("no"),
          brands_we_could_not_check: access
            .filter((a) => a.access === "unknown")
            .map((a) => `${a.project} (${a.detail})`),
        });
      }),
  );

  server.registerTool(
    "login_with_password",
    {
      title: "Start login from stored credentials (fallback)",
      description:
        "The headless fallback for when a browser is not available — a CI job, a server " +
        "with no display. Prefer `login`, which opens a sign-in page so no password or " +
        "one-time code ever passes through this conversation. Credentials come from the " +
        "ICMCP_EMAIL / ICMCP_PASSWORD environment variables unless passed explicitly; " +
        "follow up with submit_otp.",
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
