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
import { ok, fail, guard, projectParam, ensureWritable } from "./helpers.js";

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
        "translation tools (type 'header_item'). Requires login and a write-enabled brand.",
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
        item_type: z.string().default("link").describe("e.g. 'link' or 'dropdown'."),
        parent_id: z.number().int().optional().describe("Parent item id, for dropdown children."),
        order: z.number().int().optional(),
        is_active: z.boolean().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, header_id, language_id, label, url, item_type, parent_id, order, is_active }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        const response = await post<Envelope<CreatedItem>>(
          project,
          `/admin/headers/${header_id}/items`,
          {
            item_type,
            parent_id,
            order,
            is_active,
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
        "Updates a menu item's structure — its type, order, active flag or parent. Text " +
        "(label/url) is per-language: change it with the translation tools. Requires login " +
        "and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        header_id: z.number().int(),
        item_id: z.number().int(),
        item_type: z.string().optional(),
        order: z.number().int().optional(),
        is_active: z.boolean().optional(),
        parent_id: z.number().int().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, header_id, item_id, ...body }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
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
        "login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        header_id: z.number().int(),
        item_id: z.number().int(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ project, header_id, item_id }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        await del(project, `/admin/headers/${header_id}/items/${item_id}`);
        return ok({ project, header_id, item_id, deleted: true });
      }),
  );
}
