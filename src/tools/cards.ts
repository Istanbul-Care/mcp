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
import type { Envelope, LanguageInfo } from "../api/types.js";
import type { ProjectId } from "../config/projects.js";
import { ok, fail, guard, projectParam, ensureWritable, ensureVocabulary } from "./helpers.js";

interface CreatedCard {
  id: number;
}

/** A media row as the card detail embeds it — `url` is already absolute. */
interface CardMedia {
  id: number;
  media_type?: string | null;
  url?: string | null;
  translations?: Array<{ language_code?: string | null; alt?: string | null }>;
}

export interface CardTranslationDetail {
  language: LanguageInfo;
  title?: string | null;
  description?: string | null;
  button_text?: string | null;
  button_url?: string | null;
  button_icon?: string | null;
}

/** GET /admin/cards/{id} — the whole card, every language. */
export interface CardDetail {
  id: number;
  type?: string | null;
  sort_order?: number | null;
  dark_mode?: boolean | null;
  text_position?: string | null;
  image?: CardMedia | null;
  media?: CardMedia[];
  translations?: CardTranslationDetail[];
}

/** One ordered card slot on a page — the page detail carries ids only. */
export interface OrderedCardItem {
  id: number;
  order?: number | null;
  grid_columns?: number | null;
}

interface PageCardsDetail {
  id: number;
  cards?: OrderedCardItem[];
}

export function mediaSummary(item: CardMedia | null | undefined, language?: string): Record<string, unknown> | null {
  if (!item) return null;
  const alts = item.translations ?? [];
  const match = language
    ? alts.find((entry) => entry.language_code?.toLowerCase() === language.toLowerCase())
    : undefined;
  const alt = match?.alt ?? alts[0]?.alt ?? null;
  return { id: item.id, url: item.url ?? null, ...(alt ? { alt } : {}) };
}

/**
 * Flatten a card for reading: shared layout fields plus its text, filtered to
 * one language when asked. `type` matters more than it looks — only `content`
 * and `default` cards are prose; the rest (whatsapp, sliders, galleries, word
 * clouds) are widgets whose text means nothing outside their own rendering.
 */
export function describeCard(card: CardDetail, language?: string): Record<string, unknown> {
  const rows = card.translations ?? [];
  const wanted = language
    ? rows.filter((row) => row.language?.code?.toLowerCase() === language.toLowerCase())
    : rows;
  const text = wanted.map((row) => ({
    language: row.language?.code,
    language_id: row.language?.id,
    ...(row.title ? { title: row.title } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.button_text ? { button_text: row.button_text } : {}),
    ...(row.button_url ? { button_url: row.button_url } : {}),
    ...(row.button_icon ? { button_icon: row.button_icon } : {}),
  }));

  return {
    id: card.id,
    type: card.type ?? null,
    sort_order: card.sort_order ?? null,
    dark_mode: card.dark_mode ?? null,
    text_position: card.text_position ?? null,
    image: mediaSummary(card.image, language),
    ...((card.media ?? []).length > 0
      ? { media: (card.media ?? []).map((item) => mediaSummary(item, language)) }
      : {}),
    translations: text,
    ...(language && text.length === 0 ? { missing_language: language } : {}),
  };
}

export async function fetchCard(project: ProjectId, cardId: number): Promise<CardDetail> {
  const response = await get<Envelope<CardDetail>>(project, `/admin/cards/${cardId}`);
  return response.data;
}

/** A page's cards, resolved in full and sorted the way they render. */
export async function fetchPageCards(
  project: ProjectId,
  pageId: number,
): Promise<Array<{ slot: OrderedCardItem; card: CardDetail }>> {
  const page = await get<Envelope<PageCardsDetail>>(project, `/admin/pages/${pageId}`);
  const slots = (page.data.cards ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const resolved: Array<{ slot: OrderedCardItem; card: CardDetail }> = [];
  // Sequential on purpose: a page rarely holds more than a dozen cards and the
  // admin API is the same box that serves the site.
  for (const slot of slots) {
    resolved.push({ slot, card: await fetchCard(project, slot.id) });
  }
  return resolved;
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
    "get_card",
    {
      title: "Read one card",
      description:
        "The whole card: its type, image, layout flags and its text in every language (or " +
        "one, with language_code). Unlike list_cards, this returns the full `description` " +
        "HTML, so it is what you read before folding a card's content into something else. " +
        "Requires login.",
      inputSchema: {
        project: projectParam,
        card_id: z.number().int(),
        language_code: z
          .string()
          .optional()
          .describe("Return only this language's text, e.g. 'de'. Omit for every language."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, card_id, language_code }) =>
      guard(async () => {
        const card = await fetchCard(project, card_id);
        return ok({ project, card: describeCard(card, language_code) });
      }),
  );

  server.registerTool(
    "get_page_cards",
    {
      title: "Read a page's cards, in page order",
      description:
        "Every card attached to a page, in the order it renders, with its full text and " +
        "images. get_page returns card ids only; this resolves each one, so it is the read " +
        "step before rewriting a page's card stack (e.g. folding the prose cards into the " +
        "page_content block). Requires login.",
      inputSchema: {
        project: projectParam,
        page_id: z.number().int(),
        language_code: z
          .string()
          .optional()
          .describe("Return only this language's text, e.g. 'de'. Omit for every language."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, page_id, language_code }) =>
      guard(async () => {
        const cards = (await fetchPageCards(project, page_id)).map(({ slot, card }) => ({
          ...describeCard(card, language_code),
          order: slot.order ?? 0,
          grid_columns: slot.grid_columns ?? null,
        }));

        return ok({
          project,
          page_id,
          ...(language_code ? { language: language_code } : {}),
          count: cards.length,
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
        const badValue = ensureVocabulary([
          ["card_type", body.type],
          ["card_text_position", body.text_position],
        ]);
        if (badValue) return fail(badValue);
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
        const badValue = ensureVocabulary([
          ["card_type", body.type],
          ["card_text_position", body.text_position],
        ]);
        if (badValue) return fail(badValue);
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
