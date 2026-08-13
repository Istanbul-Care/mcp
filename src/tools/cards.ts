/**
 * Cards — the reusable content blocks that make up a service's (and page's) body.
 *
 * The backend has full card CRUD; the MCP only ever translated cards. These
 * tools let the agent create, edit and delete them, then attach them to a
 * service (via create_service's card_ids) or a page.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { post, put, del } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { ok, fail, guard, projectParam, ensureWritable } from "./helpers.js";

interface CreatedCard {
  id: number;
}

export function registerCardTools(server: McpServer): void {
  server.registerTool(
    "create_card",
    {
      title: "Create a card",
      description:
        "Creates a content card in ONE language. Cards are the body blocks of services and " +
        "pages — attach the returned id via create_service's card_ids or the page tools. " +
        "Non-prose fields (icon, image, dimensions) are shared across languages; text is " +
        "per-language. Add other languages with the translation tools. Requires login and a " +
        "write-enabled brand.",
      inputSchema: {
        project: projectParam,
        language_id: z.number().int().describe("Language of this first translation."),
        title: z.string().optional(),
        description: z.string().optional().describe("Card body — HTML allowed."),
        button_text: z.string().optional(),
        button_url: z.string().optional(),
        button_icon: z.string().optional().describe("Icon key (shared across languages)."),
        type: z.string().optional().describe("Card style/type; see existing cards for values."),
        image_id: z.number().int().optional(),
        media_ids: z.array(z.number().int()).optional(),
        sort_order: z.number().int().optional(),
        dark_mode: z.boolean().optional(),
        text_position: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        const response = await post<Envelope<CreatedCard>>(project, "/admin/cards", body);
        return ok({
          project,
          created: true,
          card_id: response.data.id,
          note: "Attach it to a service (card_ids) or page. Add languages with the translation tools.",
        });
      }),
  );

  server.registerTool(
    "update_card",
    {
      title: "Edit a card",
      description:
        "Updates a card's shared fields (icon, image, dimensions, style) and/or its text in " +
        "one language via translation_update. Only pass what changes. Requires login and a " +
        "write-enabled brand.",
      inputSchema: {
        project: projectParam,
        card_id: z.number().int(),
        type: z.string().optional(),
        image_id: z.number().int().optional(),
        media_ids: z.array(z.number().int()).optional(),
        sort_order: z.number().int().optional(),
        dark_mode: z.boolean().optional(),
        text_position: z.string().optional(),
        translation_update: z
          .object({
            language_id: z.number().int(),
            title: z.string().optional(),
            description: z.string().optional(),
            button_text: z.string().optional(),
            button_url: z.string().optional(),
            button_icon: z.string().optional(),
          })
          .optional()
          .describe("Text for one language. Omit to touch only shared fields."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, card_id, ...body }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        await put(project, `/admin/cards/${card_id}`, body);
        return ok({ project, card_id, updated: true });
      }),
  );

  server.registerTool(
    "delete_card",
    {
      title: "Delete a card",
      description:
        "Permanently deletes a card (and its translations). It is also removed from any " +
        "service/page that used it. Requires login and a write-enabled brand.",
      inputSchema: { project: projectParam, card_id: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ project, card_id }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        await del(project, `/admin/cards/${card_id}`);
        return ok({ project, card_id, deleted: true });
      }),
  );
}
