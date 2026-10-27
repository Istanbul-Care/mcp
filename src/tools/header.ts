/**
 * Header / navbar — the top navigation menu.
 *
 * Backend has full header + item CRUD; the MCP could translate menu items but
 * not add/remove them. These tools list the headers and manage their items.
 * Item text (label/url, and the mega menu's description/highlight/cta_label) is
 * per-language: one language at a time with add_header_item_translation /
 * update_header_item_translation, a whole brand's menus with the translation
 * tools (type "header_item").
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post, put, del } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { ok, fail, guard, projectParam, ensureVocabulary, registerWrite } from "./helpers.js";

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

/**
 * A top-level link can show as a button. button_style and button_show_on go
 * through exactly like icon_media_id: null is sent (a plain link / shown on
 * both) and an omitted key stays undefined, so an update keeps the value.
 */
const BUTTON_STYLES = ["filled", "green", "outline", "icon"] as const;
const BUTTON_SHOW_ON = ["both", "mobile", "desktop"] as const;

const BUTTON_STYLE_TEXT =
  "Shows the item as a button instead of a plain menu link: 'filled' (the brand colour), " +
  "'green', 'outline' or 'icon' (a round button showing only the item's icon — set " +
  "icon_media_id; the label is read out by screen readers only, e.g. a tel: link). Only a " +
  "TOP-LEVEL item (no parent_id) of item_type custom_button " +
  "that has a URL shows as a button; on any other item it does nothing. On desktop, where " +
  "the menu is in the bar, the button sits in the bar at the item's place in the menu " +
  "order. On phones and tablets, where the menu is behind the burger, the buttons gather at " +
  "the bottom of that menu as big rounded buttons: the first full width, the rest two per " +
  "row when they fit. A button's URL can be any address: a page slug, a full https " +
  "address, a WhatsApp link (the site asks the visitor for their details before opening " +
  "WhatsApp), tel:+90…, mailto:…, or the word 'consultation', which opens the site's free " +
  "consultation form.";

const BUTTON_SHOW_ON_TEXT =
  "Where the button shows: 'both' (the default), 'mobile' (only on phones and tablets, at " +
  "the bottom of the burger menu) or 'desktop' (only in the bar on wide screens). It " +
  "matters only while button_style is set.";

const BUTTON_OPTION =
  "A top-level custom_button item with a URL can show as a button instead of a link " +
  "(button_style), on mobile only, desktop only or both (button_show_on) — e.g. a 'Free " +
  "consultation' button whose url is 'consultation'.";

/**
 * The mega header design (a page's header_style 'mega') reads more off its
 * items: a photo, how the item shows in the open menu, and three texts per
 * language. image_media_id and mega_display go through exactly like
 * icon_media_id (null is sent, an omitted key keeps the value); the texts ride
 * in the translation beside label and url. Classic and transparent ignore them.
 */
const MEGA_DISPLAYS = ["column", "promo", "feature", "tile", "link"] as const;

const MEGA_ONLY =
  "Only the mega header design (a page's header_style 'mega') reads it; classic and " +
  "transparent ignore it.";

const IMAGE_TEXT =
  "The item's photo in the mega menu — the background of a 'feature' card or the picture of " +
  `a 'tile': a media id from upload_media. ${MEGA_ONLY}`;

const MEGA_DISPLAY_TEXT =
  "How the item shows in the mega menu, the floating card that opens under the bar when a " +
  "top-level item is hovered. Right under a top item: 'column' (label = a small uppercase " +
  "heading, its own sub-items under it) or 'promo' (the highlighted box at the right end: " +
  "label = the small top line, highlight = the big words such as 'from $1,990', description " +
  "= its text, cta_label = its button to the item's URL). Inside a column: 'feature' (a wide " +
  "card over image_media: label, description, cta_label such as 'See prices →'; the whole " +
  "card links), 'tile' (a photo tile: image_media, icon, label, description such as 'From " +
  "$1,990'; tiles sit side by side) or 'link' (label with its description under it). " +
  MEGA_ONLY;

const MEGA_DISPLAY_AUTO = "automatic: a column if it has sub-items, else a link";

const DESCRIPTION_TEXT =
  "Mega menu: the line under a link, a tile or a feature card; a promo box's text.";
const HIGHLIGHT_TEXT = "Mega menu: a promo box's big words, e.g. 'from $1,990'.";
const CTA_LABEL_TEXT =
  "Mega menu: a feature card's or a promo box's button text, e.g. 'See prices →'.";

/** The mega texts as a new translation takes them: left out = none. */
const megaTexts = {
  description: z.string().max(500).optional().describe(DESCRIPTION_TEXT),
  highlight: z.string().max(100).optional().describe(HIGHLIGHT_TEXT),
  cta_label: z.string().max(100).optional().describe(CTA_LABEL_TEXT),
};

/** On a translation update: left out = kept, null or "" clears it. */
const CLEARS = " null or '' clears it; leave it out to keep it.";
const megaTextUpdates = {
  description: z.string().max(500).nullable().optional().describe(DESCRIPTION_TEXT + CLEARS),
  highlight: z.string().max(100).nullable().optional().describe(HIGHLIGHT_TEXT + CLEARS),
  cta_label: z.string().max(100).nullable().optional().describe(CTA_LABEL_TEXT + CLEARS),
};

const MEGA_OPTION =
  "For the mega header design (a page's header_style 'mega'), mega_display and " +
  "image_media_id set how the item shows in the open menu, and description / highlight / " +
  "cta_label (per language, beside the label) its texts.";

/** A menu link as the site wants it: a bare slug path for internal pages. */
const URL_TEXT =
  "Where it links. For internal pages pass a bare slug path " +
  "('hair-transplant/dhi') — no domain, no locale prefix; the frontend " +
  "prepends the current locale itself, so absolute URLs escape the language.";

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
        "another item with parent_id (for dropdowns). Add other languages with " +
        "add_header_item_translation, or for a whole brand with the translation tools (type " +
        "'header_item'). " +
        BUTTON_OPTION +
        " " +
        MEGA_OPTION +
        " " +
        CATEGORY_MENU_ICONS +
        " Requires login.",
      inputSchema: {
        project: projectParam,
        header_id: z.number().int().describe("From list_headers."),
        language_id: z.number().int(),
        label: z.string().describe("Menu text."),
        url: z.string().describe(URL_TEXT),
        ...megaTexts,
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
        button_style: z
          .enum(BUTTON_STYLES)
          .nullable()
          .optional()
          .describe(`${BUTTON_STYLE_TEXT} Leave it out (or null) for a plain menu link.`),
        button_show_on: z
          .enum(BUTTON_SHOW_ON)
          .nullable()
          .optional()
          .describe(`${BUTTON_SHOW_ON_TEXT} Leave it out (or null) for both.`),
        image_media_id: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe(`${IMAGE_TEXT} Leave it out for no photo.`),
        mega_display: z
          .enum(MEGA_DISPLAYS)
          .nullable()
          .optional()
          .describe(`${MEGA_DISPLAY_TEXT} Leave it out (or null) for ${MEGA_DISPLAY_AUTO}.`),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({
      project,
      header_id,
      language_id,
      label,
      url,
      description,
      highlight,
      cta_label,
      item_type,
      parent_id,
      order,
      is_active,
      icon_media_id,
      button_style,
      button_show_on,
      image_media_id,
      mega_display,
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
            button_style,
            button_show_on,
            image_media_id,
            mega_display,
            translations: [{ language_id, label, url, description, highlight, cta_label }],
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
        "Updates a menu item's structure — its type, order, active flag, parent, icon, " +
        "button look, or mega menu photo and display. Text (label/url and the mega texts) " +
        "is per-language: change it with update_header_item_translation. " +
        BUTTON_OPTION +
        " " +
        MEGA_OPTION +
        " " +
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
        button_style: z
          .enum(BUTTON_STYLES)
          .nullable()
          .optional()
          .describe(
            `${BUTTON_STYLE_TEXT} null makes it a plain menu link again; leave it out to keep ` +
              "the current style.",
          ),
        button_show_on: z
          .enum(BUTTON_SHOW_ON)
          .nullable()
          .optional()
          .describe(
            `${BUTTON_SHOW_ON_TEXT} null shows it on both again; leave it out to keep the ` +
              "current value.",
          ),
        image_media_id: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe(`${IMAGE_TEXT} null removes it; leave it out to keep the current one.`),
        mega_display: z
          .enum(MEGA_DISPLAYS)
          .nullable()
          .optional()
          .describe(
            `${MEGA_DISPLAY_TEXT} null makes it ${MEGA_DISPLAY_AUTO} again; leave it out to ` +
              "keep the current one.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, header_id, item_id, ...body }) =>
      guard(async () => {
        await put(project, `/admin/headers/${header_id}/items/${item_id}`, body);
        return ok({ project, header_id, item_id, updated: true });
      }),
  );

  registerWrite(server, {
    name: "add_header_item_translation",
    title: "Add a language to a navbar item",
    description:
      "Adds one language to a menu item: its label and link, and the mega menu texts " +
      "(description, highlight, cta_label). For every menu of a brand at once use " +
      "translation_worklist / save_translations (type 'header_item').",
    params: {
      header_id: z.number().int(),
      item_id: z.number().int(),
      language_id: z.number().int(),
      label: z.string().min(1).max(255).describe("Menu text."),
      url: z.string().max(500).optional().describe(URL_TEXT),
      ...megaTexts,
    },
    method: "post",
    path: (a) => `/admin/headers/${a.header_id}/items/${a.item_id}/translations`,
    body: (a) => ({
      language_id: a.language_id,
      label: a.label,
      url: a.url,
      description: a.description,
      highlight: a.highlight,
      cta_label: a.cta_label,
    }),
    echo: ["header_id", "item_id", "language_id"],
  });

  registerWrite(server, {
    name: "update_header_item_translation",
    title: "Edit a navbar item's text in one language",
    description:
      "Changes a menu item's label, link or mega menu texts (description, highlight, " +
      "cta_label) in one language. Only pass what changes — what you leave out is kept.",
    params: {
      header_id: z.number().int(),
      item_id: z.number().int(),
      language_id: z.number().int(),
      label: z.string().min(1).max(255).optional().describe("Menu text."),
      url: z.string().max(500).optional().describe(URL_TEXT),
      ...megaTextUpdates,
    },
    method: "put",
    path: (a) =>
      `/admin/headers/${a.header_id}/items/${a.item_id}/translations/${a.language_id}`,
    body: (a) => ({
      label: a.label,
      url: a.url,
      description: a.description,
      highlight: a.highlight,
      cta_label: a.cta_label,
    }),
    echo: ["header_id", "item_id", "language_id"],
  });

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
