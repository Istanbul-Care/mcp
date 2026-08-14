/**
 * Cards — the reusable content blocks that make up a service's (and page's) body.
 *
 * The backend has full card CRUD; the MCP only ever translated cards. These
 * tools let the agent create, edit and delete them, then attach them to a
 * service (via create_service's card_ids) or a page.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post, put, del } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { ok, fail, guard, projectParam, ensureWritable } from "./helpers.js";

interface CreatedCard {
  id: number;
}

/** One card as the admin list returns it — translations are filtered to the requested language. */
interface CardListRow {
  id: number;
  translations?: Array<{
    language?: { code?: string } | null;
    title?: string | null;
    description?: string | null;
    button_text?: string | null;
    button_url?: string | null;
  }>;
}

interface CardListData {
  cards?: CardListRow[];
  total?: number;
  total_pages?: number;
  page?: number;
}

export function registerCardTools(server: McpServer): void {
  server.registerTool(
    "list_cards",
    {
      title: "List cards (paginated, for translation)",
      description:
        "Pages through every card, returning each card's id and its text in ONE language (the " +
        "source). Use this to translate cards: the admin card list filters translations to a " +
        "single language, so the coverage/worklist tools cannot tell which cards already have a " +
        "given language — page through with this instead and translate each card once via " +
        "save_translations. Returns total_pages so you know when to stop. Requires login.",
      inputSchema: {
        project: projectParam,
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(50),
        language_id: z
          .number()
          .int()
          .optional()
          .describe("Which language's text to return; omit for the brand default (the source)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, page, limit, language_id }) =>
      guard(async () => {
        const response = await get<Envelope<CardListData>>(project, "/admin/cards", {
          page,
          limit,
          language_id,
        });
        const data = response.data;
        const cards = (data.cards ?? []).map((card) => {
          const tr = card.translations?.[0];
          const fields: Record<string, string> = {};
          if (tr?.title) fields.title = tr.title;
          if (tr?.description) fields.description = tr.description;
          if (tr?.button_text) fields.button_text = tr.button_text;
          if (tr?.button_url) fields.button_url = tr.button_url;
          return { id: card.id, fields };
        });
        return ok({
          project,
          page: data.page ?? page,
          total: data.total,
          total_pages: data.total_pages,
          returned: cards.length,
          cards,
        });
      }),
  );

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
