/**
 * The "/login <brand>" command.
 *
 * Registered as an MCP prompt so the two-step OTP dance (login mails a code,
 * submit_otp exchanges it) surfaces as one slash command in the client. The
 * ordering and the failure paths — expired codes, missing credentials — live
 * here so every client walks the same road.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { PROJECT_IDS } from "../config/projects.js";

export function registerLoginPrompt(server: McpServer): void {
  server.registerPrompt(
    "login",
    {
      title: "Log in to a brand (OTP)",
      description:
        "Walk through the full OTP login for one brand: ask the human for the " +
        "admin e-mail and password, send the one-time code, ask for it, exchange " +
        "it for a session token.",
      argsSchema: {
        project: z
          .string()
          .describe(`Brand id. One of: ${PROJECT_IDS.join(", ")}.`),
        email: z
          .string()
          .optional()
          .describe("Admin e-mail. If omitted, the agent asks for it in chat."),
        password: z
          .string()
          .optional()
          .describe("Admin password. If omitted, the agent asks for it in chat."),
      },
    },
    ({ project, email, password }) => {
      const credentialStep =
        email && password
          ? `2. login({ project: "${project}", email: "${email}", password: "${password}" }).`
          : email
            ? [
                `2. Ask me in chat for the admin password (ICMCP_PASSWORD) for`,
                `   '${project}' — one question, wait for my answer, do not guess. Then`,
                `   login({ project: "${project}", email: "${email}", password: "<what I gave you>" }).`,
              ].join("\n")
            : [
                `2. Ask me in chat for the admin credentials for '${project}': the e-mail`,
                "   (ICMCP_EMAIL) and the password (ICMCP_PASSWORD). One message, both",
                "   fields, then wait for my answer — do not guess and do not read them",
                "   from anywhere else. Then call",
                `   login({ project: "${project}", email: "<e-mail I gave you>", password: "<password I gave you>" }).`,
              ].join("\n");
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Log me in to the '${project}' brand.`,
                "",
                "Follow these steps exactly:",
                "",
                `1. auth_status. If '${project}' already holds a valid token, tell me how`,
                "   long it has left and stop — no need to log in again.",
                "",
                credentialStep,
                "",
                "3. The backend mails a one-time code on every login. Tell me the address",
                "   the code was sent to and ask me to paste it. Do not call submit_otp",
                "   until I hand you the code, and never invent one.",
                "",
                `4. submit_otp({ project: "${project}", otp_code: "<code I give you>" }).`,
                "   The code expires after 5 minutes — if the tool says it expired, start",
                "   over from step 2 for a fresh code and tell me to answer faster.",
                "",
                "5. Confirm the result: who I am logged in as (name, role) and how many",
                "   minutes the session lasts. The token lives only in the MCP server's",
                "   memory, so it is gone when the server restarts.",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
