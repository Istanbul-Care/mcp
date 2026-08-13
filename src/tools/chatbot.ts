/**
 * Chatbot — the site's AI chat widget settings.
 *
 * Backend exposes read + update of the settings (and read of conversations).
 * These tools let the agent inspect and adjust the chatbot: enable/disable,
 * pick the model, tune the extra prompt, set the knowledge feed.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, put } from "../api/client.js";
import { ok, fail, guard, projectParam, ensureWritable } from "./helpers.js";

/** The settings response is flat — not wrapped in the usual {status, data} envelope. */
interface ChatbotSettings {
  is_enabled?: boolean;
  chat_model?: string | null;
  additional_prompt?: string | null;
  feed?: string | null;
  openai_api_key_masked?: string | null;
  has_openai_api_key?: boolean;
}

export function registerChatbotTools(server: McpServer): void {
  server.registerTool(
    "get_chatbot_settings",
    {
      title: "Read the chatbot settings",
      description:
        "The site chat widget's configuration: whether it's on, which model it uses, the " +
        "extra prompt and knowledge feed. The API key is never returned. Requires login.",
      inputSchema: { project: projectParam },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project }) =>
      guard(async () => {
        const settings = await get<ChatbotSettings>(project, "/admin/chatbot/settings");
        // The knowledge feed can be hundreds of KB — return its size and a short
        // preview rather than the whole thing, which would blow the token budget.
        const feed = settings.feed ?? "";
        return ok({
          project,
          is_enabled: settings.is_enabled,
          chat_model: settings.chat_model,
          additional_prompt: settings.additional_prompt,
          feed_length: feed.length,
          feed_preview: feed.length > 800 ? feed.slice(0, 800) + "…" : feed,
          has_openai_api_key: settings.has_openai_api_key,
          openai_api_key_masked: settings.openai_api_key_masked,
        });
      }),
  );

  server.registerTool(
    "update_chatbot_settings",
    {
      title: "Update the chatbot settings",
      description:
        "Changes the chat widget's configuration. Only pass what changes. Set the OpenAI key " +
        "only when rotating it — it is write-only and never read back. Requires login and a " +
        "write-enabled brand.",
      inputSchema: {
        project: projectParam,
        is_enabled: z.boolean().optional(),
        chat_model: z.string().optional(),
        additional_prompt: z.string().optional().describe("Extra system prompt for the bot."),
        feed: z.string().optional().describe("Knowledge feed / source content."),
        openai_api_key: z.string().optional().describe("Write-only; set only to rotate."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        await put(project, "/admin/chatbot/settings", body);
        return ok({ project, updated: true });
      }),
  );
}
