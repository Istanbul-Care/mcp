/**
 * Pages — the static/landing pages (About, service-category landings, etc.).
 *
 * The backend has full page CRUD; the MCP just never surfaced it, so pages were
 * invisible to the agent except through translation coverage. These tools give
 * the read + create side. Composing a page's body (heroes, cards, sliders…) is a
 * separate, larger surface handled elsewhere — create_page makes the page and
 * its core SEO fields; sections are attached afterwards.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post, put } from "../api/client.js";
import type { Envelope, LanguageInfo } from "../api/types.js";
import { coerceSlug } from "../lib/slug.js";
import { ok, fail, guard, projectParam, ensureWritable } from "./helpers.js";

interface PageTranslation {
  language: LanguageInfo;
  title: string;
  slug: string;
  full_path?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
}

interface PageListItem {
  id: number;
  parent_id?: number | null;
  translations: PageTranslation[];
}

interface PageListData {
  pages: PageListItem[];
  total: number;
  page: number;
  total_pages: number;
}

interface OrderedItem {
  id: number;
  order?: number | null;
  grid_columns?: number | null;
}

/** The page-body section arrays that PUT /pages replaces wholesale. */
const SECTION_KEYS = [
  "cards",
  "heroes",
  "sliders",
  "contact_forms",
  "multi_page_forms",
  "processes",
  "before_afters",
  "packages",
  "price_compares",
  "promotional_landings",
  "google_map_sections",
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

type PageSections = Partial<Record<SectionKey, OrderedItem[]>>;

/** The page's rich-text body block: layout here, the text itself per language. */
interface PageContentBlock {
  enabled?: boolean;
  order?: number;
  grid_columns?: number;
}

interface PageDetail extends PageListItem, PageSections {
  header_id?: number | null;
  footer_id?: number | null;
  featured_image_id?: number | null;
  page_content?: PageContentBlock | null;
}

/** Reduce a section's ordered items to the minimal {id, order, grid_columns}. */
function sectionIds(items: OrderedItem[] | undefined): OrderedItem[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    ...(item.order == null ? {} : { order: item.order }),
    ...(item.grid_columns == null ? {} : { grid_columns: item.grid_columns }),
  }));
}

export function registerPageTools(server: McpServer): void {
  server.registerTool(
    "list_pages",
    {
      title: "List pages",
      description:
        "Static and landing pages for a brand, each with its translations and composed " +
        "full_path. Use it to find a page's id, or a parent page id when nesting. Requires login.",
      inputSchema: {
        project: projectParam,
        search: z.string().optional().describe("Matches title / slug / meta_title."),
        limit: z.number().int().min(1).max(100).default(20),
        page: z.number().int().min(1).default(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, ...query }) =>
      guard(async () => {
        const response = await get<Envelope<PageListData>>(project, "/admin/pages", query);
        return ok({
          project,
          total: response.data.total,
          page: response.data.page,
          total_pages: response.data.total_pages,
          pages: response.data.pages.map((item) => ({
            id: item.id,
            parent_id: item.parent_id,
            translations: item.translations.map((t) => ({
              language: t.language.code,
              title: t.title,
              slug: t.slug,
              full_path: t.full_path,
            })),
          })),
        });
      }),
  );

  server.registerTool(
    "get_page",
    {
      title: "Read one page",
      description:
        "Full detail for a page: SEO fields per translation, its header/footer/parent and " +
        "featured image. Requires login.",
      inputSchema: {
        project: projectParam,
        page_id: z.number().int(),
        language_id: z.number().int().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, page_id, language_id }) =>
      guard(async () => {
        const response = await get<Envelope<PageDetail>>(project, `/admin/pages/${page_id}`, {
          language_id,
        });
        const pageDetail = response.data;
        const sections = Object.fromEntries(
          SECTION_KEYS.map((key) => [key, sectionIds(pageDetail[key]).map((s) => s.id)]).filter(
            ([, ids]) => (ids as number[]).length > 0,
          ),
        );
        return ok({
          project,
          id: pageDetail.id,
          parent_id: pageDetail.parent_id,
          header_id: pageDetail.header_id,
          footer_id: pageDetail.footer_id,
          featured_image_id: pageDetail.featured_image_id,
          page_content: pageDetail.page_content ?? null,
          sections,
          translations: pageDetail.translations.map((t) => ({
            language: t.language.code,
            language_id: t.language.id,
            title: t.title,
            slug: t.slug,
            full_path: t.full_path,
            meta_title: t.meta_title,
            meta_description: t.meta_description,
          })),
        });
      }),
  );

  server.registerTool(
    "create_page",
    {
      title: "Create a page",
      description:
        "Creates a page in ONE language with its core SEO fields. Attach body sections " +
        "(heroes, cards, sliders…) afterwards. The slug is the bare leaf; the site composes " +
        "the routable path from the brand's container template and any parent page. Add other " +
        "languages with the translation tools. Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        language_id: z.number().int().describe("Language of this first translation. See list_languages."),
        title: z.string().min(1).max(255),
        slug: z
          .string()
          .min(1)
          .max(255)
          .describe("Lowercase ASCII, hyphens only — the leaf slug, no container prefix."),
        excerpt: z.string().optional(),
        meta_title: z.string().max(255).optional(),
        meta_description: z.string().max(255).optional(),
        focus_keyword: z.string().max(255).optional(),
        canonical_url: z.string().max(255).optional(),
        robots_index: z.boolean().default(true),
        robots_follow: z.boolean().default(true),
        parent_id: z.number().int().optional().describe("Nest under another page."),
        header_id: z.number().int().optional(),
        footer_id: z.number().int().optional(),
        featured_image_id: z.number().int().optional(),
        breadcrumb_enabled: z.boolean().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, slug, ...rest }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        const { slug: cleanSlug, corrected } = coerceSlug(slug);
        const response = await post<Envelope<PageDetail>>(project, "/admin/pages", {
          slug: cleanSlug,
          ...rest,
        });
        return ok({
          project,
          created: true,
          page_id: response.data.id,
          ...(corrected ? { slug_corrected_to: cleanSlug } : {}),
          next_steps: [
            "Add other languages with the translation tools (auto_translate for pages).",
            "Attach body sections (heroes, cards, …) with update_page.",
          ],
        });
      }),
  );

  const orderedItems = z
    .array(
      z.object({
        id: z.number().int(),
        order: z.number().int().optional(),
        grid_columns: z.number().int().optional(),
      }),
    )
    .describe(
      "The COMPLETE desired list for this section — it replaces the current one. Read " +
        "get_page first to see the existing ids, then add/remove to build the new list.",
    );

  server.registerTool(
    "update_page",
    {
      title: "Edit a page / compose its body",
      description:
        "Updates a page's structure: its cover image, header/footer/parent, and the body " +
        "sections (cards, heroes, sliders, forms). Each section array you pass REPLACES that " +
        "section wholesale — pass the full desired list of {id, order?}; sections you omit are " +
        "left unchanged. To add or remove one item, read get_page for the current ids first. " +
        "This is how images (via image cards) and forms are added to or removed from a page. " +
        "Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        page_id: z.number().int(),
        featured_image_id: z.number().int().nullable().optional().describe("Cover image; null to clear."),
        header_id: z.number().int().optional(),
        footer_id: z.number().int().optional(),
        parent_id: z.number().int().nullable().optional(),
        cards: orderedItems.optional(),
        heroes: orderedItems.optional(),
        sliders: orderedItems.optional(),
        contact_forms: orderedItems.optional(),
        multi_page_forms: orderedItems.optional(),
        page_content: z
          .object({
            enabled: z.boolean(),
            order: z.number().int().min(0).optional(),
            grid_columns: z.number().int().min(1).max(12).optional(),
          })
          .optional()
          .describe(
            "The page's rich-text body block — layout only (enabled/order/grid_columns). " +
              "The text itself is per language: write it to the `content` field via " +
              "save_translations with type 'page'.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, page_id, ...body }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        await put(project, `/admin/pages/${page_id}`, body);
        return ok({
          project,
          page_id,
          updated: true,
          changed: Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined),
        });
      }),
  );
}
