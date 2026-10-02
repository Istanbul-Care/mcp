/**
 * Header / navbar — the top navigation menu.
 *
 * Backend has full header + item CRUD; the MCP could translate menu items but
 * not add/remove them. These tools list the headers and manage their items.
 * Item text (label/url) is translatable — set other languages via the
 * translation tools (type "header_item"); this file handles structure.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post, put, del } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { ok, fail, guard, projectParam, ensureVocabulary } from "./helpers.js";

interface HeaderListItem {
  id: number;
  name?: string | null;
  is_default?: boolean;
  items_count?: number | null;
}

interface HeaderListData {
  headers: HeaderListItem[];
  total: number;
}

interface CreatedItem {
  id: number;
}

/**
 * A menu item's icon is a media row the site draws beside its label, in the
 * header bar and in the dropdowns. On an update, null clears it and leaving
 * the key out keeps it; an omitted key is undefined, which the JSON body
 * drops, so it never reaches the API.
 */
const ICON_TEXT =
  "Icon shown next to this item in the site header and its menus: a media id from " +
  "upload_media (an SVG or PNG; square works best).";

const CATEGORY_MENU_ICONS =
  "In a category menu (item_type service_category or post_category) each listed category " +
  "shows its own icon — set those with update_service_category / update_post_category.";

export function registerHeaderTools(server: McpServer): void {
  server.registerTool(
    "list_headers",
    {
      title: "List headers (navbars)",
      description:
        "The brand's header menus, with which one is the default (the live navbar) and how " +
        "many items each has. Use it to get the header id before adding menu items. " +
        "Requires login.",
      inputSchema: { project: projectParam },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project }) =>
      guard(async () => {
        const response = await get<Envelope<HeaderListData>>(project, "/admin/headers", {
          limit: 100,
        });
        return ok({
          project,
          headers: response.data.headers.map((h) => ({
            id: h.id,
            name: h.name,
            is_default: h.is_default,
            items: h.items_count,
          })),
        });
      }),
  );

  server.registerTool(
    "add_header_item",
    {
      title: "Add a navbar menu item",
      description:
        "Adds a menu item to a header, with its label and link in ONE language. Nest under " +
        "another item with parent_id (for dropdowns). Add other languages with the " +
        "translation tools (type 'header_item'). " +
        CATEGORY_MENU_ICONS +
        " Requires login.",
      inputSchema: {
        project: projectParam,
        header_id: z.number().int().describe("From list_headers."),
        language_id: z.number().int(),
        label: z.string().describe("Menu text."),
        url: z
          .string()
          .describe(
            "Where it links. For internal pages pass a bare slug path " +
              "('hair-transplant/dhi') — no domain, no locale prefix; the frontend " +
              "prepends the current locale itself, so absolute URLs escape the language.",
          ),
        item_type: z
          .string()
          .default("custom_button")
          .describe(
            "custom_button (a normal item, and the only type whose children render as a " +
              "submenu), service_category or post_category. The site treats every other " +
              "value as a category menu, so a plain item typed anything else loses its " +
              "submenu silently.",
          ),
        parent_id: z.number().int().optional().describe("Parent item id, for dropdown children."),
        order: z.number().int().optional(),
        is_active: z.boolean().default(true),
        icon_media_id: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe(`${ICON_TEXT} Leave it out for no icon.`),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({
      project,
      header_id,
      language_id,
      label,
      url,
      item_type,
      parent_id,
      order,
      is_active,
      icon_media_id,
    }) =>
      guard(async () => {
        const badValue = ensureVocabulary([["header_item_type", item_type]]);
        if (badValue) return fail(badValue);
        const response = await post<Envelope<CreatedItem>>(
          project,
          `/admin/headers/${header_id}/items`,
          {
            item_type,
            parent_id,
            order,
            is_active,
            icon_media_id,
            translations: [{ language_id, label, url }],
          },
        );
        return ok({ project, header_id, item_id: response.data.id, added: true });
      }),
  );

  server.registerTool(
    "update_header_item",
    {
      title: "Edit a navbar item's structure",
      description:
        "Updates a menu item's structure — its type, order, active flag, parent or icon. Text " +
        "(label/url) is per-language: change it with the translation tools. " +
        CATEGORY_MENU_ICONS +
        " Requires login.",
      inputSchema: {
        project: projectParam,
        header_id: z.number().int(),
        item_id: z.number().int(),
        item_type: z.string().optional(),
        order: z.number().int().optional(),
        is_active: z.boolean().optional(),
        parent_id: z.number().int().optional(),
        icon_media_id: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe(`${ICON_TEXT} null removes it; leave it out to keep the current one.`),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, header_id, item_id, ...body }) =>
      guard(async () => {
        await put(project, `/admin/headers/${header_id}/items/${item_id}`, body);
        return ok({ project, header_id, item_id, updated: true });
      }),
  );

  server.registerTool(
    "delete_header_item",
    {
      title: "Remove a navbar item",
      description:
        "Permanently removes a menu item (and its translations and any child items). Requires " +
        "login.",
      inputSchema: {
        project: projectParam,
        header_id: z.number().int(),
        item_id: z.number().int(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ project, header_id, item_id }) =>
      guard(async () => {
        await del(project, `/admin/headers/${header_id}/items/${item_id}`);
        return ok({ project, header_id, item_id, deleted: true });
      }),
  );
}
