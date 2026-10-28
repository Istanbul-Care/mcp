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
import type { ProjectId } from "../config/projects.js";
import { fetchPageCards, type CardDetail, type CardTranslationDetail } from "./cards.js";
import { ok, fail, guard, projectParam, ensureVocabulary, resolveLanguageIds } from "./helpers.js";
import { checkQueryParameters, ensureFormats } from "../lib/field-formats.js";

interface PageTranslation {
  language: LanguageInfo;
  title: string;
  slug: string;
  full_path?: string | null;
  excerpt?: string | null;
  content?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  focus_keyword?: string | null;
  canonical_url?: string | null;
  robots_index?: boolean | null;
  robots_follow?: boolean | null;
  child_pages_heading?: string | null;
}

/**
 * The translation columns a content write has to carry along. The PUT takes the
 * whole translation, so anything left out risks being cleared — re-send every
 * field the row already had and only swap `content`.
 */
const TRANSLATION_FIELDS = [
  "title",
  "slug",
  "excerpt",
  "meta_title",
  "meta_description",
  "focus_keyword",
  "canonical_url",
  "robots_index",
  "robots_follow",
  "child_pages_heading",
] as const;

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

/**
 * Built-in blocks switched on rather than attached by id. Read back with the
 * attached sections so a caller can see the whole page before changing it —
 * their `order` competes in the same sequence as the attached ones.
 */
const FLAG_KEYS = [
  "page_content",
  "page_faq",
  "blogs",
  "services",
  "social_media",
  "reviews",
  "sticky_multi_form",
  "single_blog_content",
  "single_service_content",
  "before_after_ai",
  "graftCalculator",
  "child_pages",
] as const;

type PageSections = Partial<Record<SectionKey, OrderedItem[]>>;

/** The page's rich-text body block: layout here, the text itself per language. */
interface PageContentBlock {
  enabled?: boolean;
  order?: number;
  grid_columns?: number;
}

/** The WhatsApp button in the page's corner: language code -> link. */
interface StickyWhatsApp {
  enabled: boolean;
  urls: Record<string, string>;
  /** 1 the round button; 2 the phone bar (graft calculator + WhatsApp). */
  style?: number;
  calculator_page_id?: number | null;
}

/** How a page shows its header — chosen per page, classic by default. */
const HEADER_STYLES = ["classic", "transparent", "mega"] as const;
const headerStyleParam = z
  .enum(HEADER_STYLES)
  .describe(
    "The page's header design: 'classic' = the brand bar (default); 'transparent' = no " +
      "background over the page's opening picture (hero or breadcrumb banner image), the " +
      "brand background coming in once the visitor scrolls. A page that does not open on " +
      "such a picture shows the transparent design with its background from the start. " +
      "'mega' = the transparent bar with a mega menu: hovering a top-level item opens a " +
      "floating card under the bar with its sub-items, laid out by the items' mega_display, " +
      "image_media_id and mega texts (see add_header_item / update_header_item).",
  );

const bannerStyleParam = z
  .union([z.literal(1), z.literal(2)])
  .describe(
    "The banner at the top of the page (breadcrumb_enabled): 1 (default) the featured image " +
      "under a dark veil with the title and breadcrumb; 2 the brand's navy, no picture — the " +
      "breadcrumb, the title and the page's excerpt on the left and banner_video_id on the right " +
      "(under them on phones). Without a video the text fills the banner.",
  );
const bannerVideoParam = z
  .number()
  .int()
  .positive()
  .nullable()
  .describe(
    "Banner style 2: a VIDEO of the media library (uploaded, youtube.video, youtube.short or " +
      "tiktok — see list_media / add_external_media); images are refused. null to clear.",
  );

interface PageDetail extends PageListItem, PageSections {
  header_id?: number | null;
  header_style?: (typeof HEADER_STYLES)[number] | null;
  banner_style?: number | null;
  banner_video_id?: number | null;
  footer_id?: number | null;
  featured_image_id?: number | null;
  page_content?: PageContentBlock | null;
  sticky_whatsapp?: StickyWhatsApp | null;
}

/** Reduce a section's ordered items to the minimal {id, order, grid_columns}. */
function sectionIds(items: OrderedItem[] | undefined): OrderedItem[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    ...(item.order == null ? {} : { order: item.order }),
    ...(item.grid_columns == null ? {} : { grid_columns: item.grid_columns }),
  }));
}


/**
 * Card types that are prose. Everything else on a page (whatsapp buttons,
 * sliders, galleries, word clouds) is a widget whose text means nothing outside
 * its own rendering, so it is never folded into the body.
 */
const PROSE_CARD_TYPES = new Set(["content", "default"]);

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function cardText(card: CardDetail, code: string): CardTranslationDetail | undefined {
  return (card.translations ?? []).find(
    (row) => row.language?.code?.toLowerCase() === code.toLowerCase(),
  );
}

/**
 * Render one card as the block of HTML it becomes inside the body.
 *
 * The card's own HTML is passed through byte for byte — this is a move, not a
 * rewrite — and only the wrapper (heading, image, button link) is authored here.
 */
function cardToHtml(
  card: CardDetail,
  text: CardTranslationDetail,
  headingTag: string | null,
  code: string,
): string {
  const parts: string[] = [];
  const image = card.image?.url;
  if (image) {
    const alts = card.image?.translations ?? [];
    const alt =
      alts.find((entry) => entry.language_code?.toLowerCase() === code.toLowerCase())?.alt ??
      alts[0]?.alt ??
      text.title ??
      "";
    parts.push(`<img src="${image}" alt="${escapeHtml(alt)}" data-media-id="${card.image?.id}">`);
  }
  if (headingTag && text.title?.trim()) {
    parts.push(`<${headingTag}>${escapeHtml(text.title.trim())}</${headingTag}>`);
  }
  if (text.description?.trim()) parts.push(text.description.trim());
  if (text.button_text?.trim() && text.button_url?.trim()) {
    parts.push(`<p><a href="${text.button_url.trim()}">${escapeHtml(text.button_text.trim())}</a></p>`);
  }
  return parts.join("\n");
}


/**
 * Replace one language's body HTML, carrying the rest of the translation along.
 * The PUT takes the whole translation, so every column the row already had is
 * re-sent and only `content` moves.
 */
async function writePageContent(
  project: ProjectId,
  pageId: number,
  languageId: number,
  translation: PageTranslation,
  content: string,
): Promise<void> {
  const body: Record<string, unknown> = { content };
  for (const field of TRANSLATION_FIELDS) {
    const value = translation[field];
    if (value !== undefined && value !== null) body[field] = value;
  }
  await put(project, `/admin/pages/${pageId}/translations/${languageId}`, body);
}

const pageContentParam = z
  .object({
    enabled: z.boolean(),
    order: z.number().int().min(0).optional(),
    grid_columns: z.number().int().min(1).max(12).optional(),
  })
  .describe(
    "The page's rich-text body block — layout only (enabled/order/grid_columns). " +
      "The text itself is per language: pass it as `content` on create_page, or write " +
      "it to the `content` field via save_translations with type 'page'.",
  );

/**
 * A page's "feature flag" blocks: built-in sections that are switched on
 * rather than attached by id. They share the layout shape of a section, and
 * their `order` competes in the SAME sequence as the attached sections — a
 * flag at order 3 renders between two cards at 2 and 4.
 */
const featureFlagParam = z.object({
  enabled: z.boolean(),
  order: z.number().int().min(0).optional(),
  grid_columns: z.number().int().min(1).max(12).optional(),
});

const servicesFlagParam = featureFlagParam
  .extend({
    style: z
      .union([z.literal(1), z.literal(2)])
      .optional()
      .describe(
        "1 (default): a row of tall photo cards with the categories as tabs above it. " +
          "2: each category's services side by side under the category's name.",
      ),
    category_ids: z
      .array(z.number().int().positive())
      .optional()
      .describe(
        "Only these service categories, in this order (ids from list_service_categories). " +
          "Empty or left out shows every category. With a single category, style 1 shows no tabs.",
      ),
  })
  .describe(
    "The page's list of services. The object you pass REPLACES the stored one, so send style " +
      "and category_ids each time — read get_page (feature_blocks.services) first.",
  );

const blogsFlagParam = featureFlagParam
  .extend({
    style: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
      .optional()
      .describe(
        "1 (default): two-column cards, numbered pages. 2: editorial list, previous/next. " +
          "3: magazine (a lead post, then two, then three to a row), 'Load more posts'. " +
          "4: small cards, four to a row, bare page numbers.",
      ),
    author_id: z.number().int().nullable().optional(),
    limit: z.number().int().min(1).optional(),
    query_parameters: z
      .string()
      .optional()
      .describe(
        "A raw query string such as 'category_id=3&sort_by=published_at' — no leading '?' " +
          "needed. `page` and `limit` in it are always overwritten, so setting them has no " +
          "effect. A malformed value does not error; the list simply comes back unfiltered.",
      ),
  })
  .describe(
    "The blog listing block. The object you pass REPLACES the stored one, so send style each " +
      "time — read get_page (feature_blocks.blogs) first, or it falls back to style 1.",
  );

/**
 * The reviews block. Like blogs and services, the backend stores exactly the
 * object it is sent, so every field has to be in this schema: zod strips a key
 * it does not know, and a style or figure read back from get_page would be
 * dropped on the way out and reset. The optional fields take null because
 * get_page shows an unset one as null and the caller re-sends what it read.
 */
const reviewsFlagParam = featureFlagParam
  .extend({
    style: z
      .union([z.literal(1), z.literal(2)])
      .optional()
      .describe(
        "1 (default): the turning deck with platform tabs. 2: the v8 design on the brand's " +
          "navy — a small heading and title, a 'Google 4.7 ★ · 1,179 Google reviews · Read all' " +
          "line, white review cards sliding side by side (the middle one large), and a row of " +
          "up to four figures, each shown only when set.",
      ),
    average_rating: z
      .number()
      .min(0)
      .max(5)
      .nullable()
      .optional()
      .describe("The Google rating, e.g. 4.7. Style 2: the rating line and the first figure."),
    total_reviews_text: z
      .string()
      .max(128)
      .nullable()
      .optional()
      .describe("How many reviews, e.g. '1,179'. Style 2: the rating line and the first figure."),
    years_experience_text: z.string().max(128).nullable().optional(),
    since_year: z
      .number()
      .int()
      .min(1900)
      .max(2100)
      .nullable()
      .optional()
      .describe("Style 2 figure 'Serving patients since', e.g. 2012."),
    countries_text: z
      .string()
      .max(16)
      .nullable()
      .optional()
      .describe("Style 2 figure 'Countries our patients come from', e.g. '30+'."),
    follow_up_text: z
      .string()
      .max(16)
      .nullable()
      .optional()
      .describe("Style 2 figure 'Follow-up after the procedure', e.g. '12 mo'."),
    read_all_url: z
      .string()
      .max(500)
      .nullable()
      .optional()
      .describe(
        "Style 2: where 'Read all' goes — the brand's Google reviews; it opens in a new tab.",
      ),
  })
  .describe(
    "The reviews block. The object you pass REPLACES the stored one, so send style and every " +
      "figure each time — read get_page (feature_blocks.reviews) first, or what you leave out " +
      "is cleared and the style falls back to 1.",
  );

/**
 * The social media block shows the brand's embeds (global settings
 * embed_media). Like reviews, the backend stores exactly the object it is sent,
 * so every field is in the schema and see_all_url takes the null get_page shows.
 */
const socialMediaFlagParam = featureFlagParam
  .extend({
    style: z
      .union([z.literal(1), z.literal(2)])
      .optional()
      .describe(
        "1 (default): the brand's Instagram / TikTok / YouTube embeds as they are. 2: the " +
          "patient stories — a row of round faces (the brand's YouTube embeds) beside a phone " +
          "that plays the one picked inside it, showing the person's full name, the video's " +
          "title as its line, a tag chip and a country chip (each embed's person_name, title, " +
          "tag, country_code and poster in update_global_setting); buttons 'Chat on WhatsApp' " +
          "and 'See all reviews' (to see_all_url).",
      ),
    see_all_url: z
      .string()
      .max(500)
      .nullable()
      .optional()
      .describe("Style 2: where 'See all reviews' goes, e.g. the brand's YouTube channel or Google reviews."),
  })
  .describe(
    "The social media block (the brand's embeds from global settings). The object you pass " +
      "REPLACES the stored one, so send style and see_all_url each time — read get_page " +
      "(feature_blocks.social_media) first, or what you leave out is cleared and the style " +
      "falls back to 1.",
  );

const stickyFormFlagParam = featureFlagParam
  .extend({
    form_code: z
      .string()
      .max(255)
      .optional()
      .describe("The multi-page form's own code. Takes precedence over a sticky contact form."),
    form_id: z.number().int().nullable().optional().describe("A contact form id instead."),
  })
  .describe(
    "The sticky bottom button. form_code and form_id are mutually exclusive; form_code wins.",
  );

const stickyWhatsAppParam = z
  .object({
    enabled: z.boolean(),
    urls: z
      .record(z.string(), z.string())
      .describe(
        "Language code -> WhatsApp link, e.g. {\"en\": \"https://destakesk.github.io/<brand>-web-english/\", " +
          "\"it\": \"…-web-italiano/\"}. A language left out shows no button on that language's page.",
      ),
    style: z
      .number()
      .int()
      .min(1)
      .max(2)
      .optional()
      .describe(
        "1 (default) the round button in the corner. 2 on phones a bar along the bottom of the screen: " +
          "the graft calculator page (calculator_page_id) on the left, WhatsApp on the right; computers " +
          "keep the round button. On the calculator page itself the bar shows WhatsApp only.",
      ),
    calculator_page_id: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .describe(
        "Style 2: the id of the page the bar's left button opens, in the visitor's language " +
          "(the brand's graft calculator page, e.g. tools/hair-graft-calculator). Without one the bar shows WhatsApp only.",
      ),
  })
  .describe(
    "The green WhatsApp button in the page's bottom corner — separate from sticky_multi_form " +
      "(a page can have both; the form button then sits above it). The visitor leaves their name " +
      "and number, then goes to the link for the language they are reading the page in. Leads are " +
      "reported as \"Sticky WhatsApp\" (form_source sticky_whatsapp). The object you pass REPLACES " +
      "the stored one, so send every language's link each time — read get_page first. The brand's " +
      "own per-language WhatsApp links are the per-language CTA links in its global settings.",
  );

const pageFaqFlagParam = featureFlagParam
  .extend({
    style: z
      .string()
      .optional()
      .describe("default_faq or word_style_faq. Checked against the values the site renders."),
  })
  .describe(
    "The FAQ block. When the page also has single_blog_content enabled it silently renders " +
      "as a bare accordion instead of the searchable FAQ.",
  );

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
          header_style: pageDetail.header_style ?? "classic",
          banner_style: pageDetail.banner_style ?? 1,
          banner_video_id: pageDetail.banner_video_id ?? null,
          footer_id: pageDetail.footer_id,
          featured_image_id: pageDetail.featured_image_id,
          page_content: pageDetail.page_content ?? null,
          sticky_whatsapp: pageDetail.sticky_whatsapp ?? null,
          sections,
          feature_blocks: Object.fromEntries(
            FLAG_KEYS.map((key) => [key, (pageDetail as unknown as Record<string, unknown>)[key] ?? null]).filter(
              ([, value]) => value !== null && value !== undefined,
            ),
          ),
          data_source_type: (pageDetail as unknown as Record<string, unknown>).data_source_type ?? null,
          translations: pageDetail.translations.map((t) => ({
            language: t.language.code,
            language_id: t.language.id,
            title: t.title,
            slug: t.slug,
            full_path: t.full_path,
            meta_title: t.meta_title,
            meta_description: t.meta_description,
            content_chars: (t.content ?? "").length,
          })),
        });
      }),
  );

  server.registerTool(
    "read_public_page",
    {
      title: "Read a published page (public API)",
      description:
        "Fetches a page the way the public site does — by its slug path, no login. Unlike " +
        "get_page, this returns the actual per-language body: the page_content block carries " +
        "its raw HTML when enabled, and every section (heroes, cards, sliders…) comes with " +
        "its full payload. Use it to read a reference page's real content, e.g. before " +
        "recreating it elsewhere. Only published pages resolve; drafts 404.",
      inputSchema: {
        project: projectParam,
        path: z
          .string()
          .min(1)
          .describe("The slug path from the public URL, e.g. 'procedures' or 'about/team' — no leading slash, no language prefix."),
        language: z
          .string()
          .optional()
          .describe("Language code, e.g. 'de'. Omit for the brand's default language."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, path, language }) =>
      guard(async () => {
        const cleanPath = path.replace(/^\/+|\/+$/g, "");
        const endpoint = language
          ? `/${language}/pages/${cleanPath}`
          : `/pages/${cleanPath}`;
        const response = await get<Envelope<unknown>>(project, endpoint, undefined, false);
        return ok({ project, path: cleanPath, page: response.data });
      }),
  );

  server.registerTool(
    "create_page",
    {
      title: "Create a page",
      description:
        "Creates a page in ONE language with its core SEO fields. Pass `content` (HTML) plus " +
        "`page_content: {enabled: true}` to create the page with its rich-text body in the " +
        "same call. Attach body sections (heroes, cards, sliders…) afterwards. The slug is " +
        "the bare leaf; the site composes the routable path from the brand's container " +
        "template and any parent page. Add other languages with the translation tools. " +
        "Requires login.",
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
        content: z
          .string()
          .optional()
          .describe("HTML body of the first translation, stored verbatim. Shown only when the page_content block is enabled."),
        page_content: pageContentParam.optional(),
        meta_title: z.string().max(255).optional(),
        meta_description: z.string().max(255).optional(),
        focus_keyword: z.string().max(255).optional(),
        canonical_url: z.string().max(255).optional(),
        robots_index: z.boolean().default(true),
        robots_follow: z.boolean().default(true),
        parent_id: z.number().int().optional().describe("Nest under another page."),
        header_id: z.number().int().optional(),
        header_style: headerStyleParam.optional(),
        footer_id: z.number().int().optional(),
        featured_image_id: z.number().int().optional(),
        breadcrumb_enabled: z.boolean().default(true),
        banner_style: bannerStyleParam.optional(),
        banner_video_id: bannerVideoParam.optional(),
        sticky_whatsapp: stickyWhatsAppParam.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, slug, ...rest }) =>
      guard(async () => {

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

  server.registerTool(
    "set_page_content",
    {
      title: "Write a page's rich-text body",
      description:
        "Writes the HTML body of a page in ONE language and, if you pass page_content, " +
        "enables/positions the block that renders it. This is the write half of moving a " +
        "page's cards into its rich-text body: build the HTML from get_page_cards, save it " +
        "here per language, then detach the folded cards with update_page. The rest of the " +
        "translation (title, slug, SEO) is read first and re-sent unchanged, so only the " +
        "body moves. The language row must already exist. Requires login.",
      inputSchema: {
        project: projectParam,
        page_id: z.number().int(),
        language_code: z.string().min(2).describe("Which language's body to write, e.g. 'en'."),
        content: z
          .string()
          .describe("The body HTML, stored verbatim. Pass an empty string to clear it."),
        page_content: pageContentParam
          .optional()
          .describe(
            "Also set the block's layout in the same operation — {enabled:true, order, " +
              "grid_columns}. Omit to leave the block as it is.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, page_id, language_code, content, page_content }) =>
      guard(async () => {

        const code = language_code.toLowerCase();
        const languageId = (await resolveLanguageIds(project, [code])).get(code);
        if (languageId === undefined) return fail(`'${code}' is not an active language.`);

        const response = await get<Envelope<PageDetail>>(project, `/admin/pages/${page_id}`, {
          language_id: languageId,
        });
        const existing = (response.data.translations ?? []).find(
          (t) => t.language?.code?.toLowerCase() === code,
        );
        if (!existing) {
          return fail(
            `Page ${page_id} has no '${code}' translation yet. Create it first ` +
              "(auto_translate, or save_translations with type 'page').",
          );
        }

        await writePageContent(project, page_id, languageId, existing, content);

        if (page_content) {
          await put(project, `/admin/pages/${page_id}`, { page_content });
        }

        return ok({
          project,
          page_id,
          language: code,
          language_id: languageId,
          content_chars: content.length,
          replaced_chars: (existing.content ?? "").length,
          ...(page_content ? { page_content } : {}),
        });
      }),
  );

  server.registerTool(
    "fold_page_cards",
    {
      title: "Fold a page's cards into its rich-text body",
      description:
        "Moves a page's prose cards into its page_content block, one language at a time. " +
        "The cards' HTML is copied byte for byte — each card becomes its heading plus its " +
        "own description, in render order — so nothing is rewritten, paraphrased or " +
        "translated. Widget cards (whatsapp, sliders, galleries, word clouds) are skipped " +
        "and stay on the page. Start with dry_run to see what each language would get. " +
        "Requires login.",
      inputSchema: {
        project: projectParam,
        page_id: z.number().int(),
        card_ids: z
          .array(z.number().int())
          .optional()
          .describe("Which cards to fold. Omit for every prose card on the page."),
        language_codes: z
          .array(z.string())
          .optional()
          .describe("Languages to write, e.g. ['en','de']. Omit for every language the page has."),
        heading_level: z
          .enum(["h2", "h3", "none"])
          .default("h2")
          .describe("Tag wrapped around each card's title. 'none' drops the titles."),
        dry_run: z
          .boolean()
          .default(true)
          .describe("Build and report without writing. Flip to false to actually save."),
        overwrite: z
          .boolean()
          .default(false)
          .describe("Required to replace a body that already has content in that language."),
        detach_cards: z
          .boolean()
          .default(false)
          .describe("Also remove the folded cards from the page (they are NOT deleted)."),
        page_content: pageContentParam
          .optional()
          .describe("Block layout. Defaults to enabled at the first folded card's position."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({
      project,
      page_id,
      card_ids,
      language_codes,
      heading_level,
      dry_run,
      overwrite,
      detach_cards,
      page_content,
    }) =>
      guard(async () => {

        const attached = await fetchPageCards(project, page_id);
        const wanted = card_ids ? new Set(card_ids) : null;
        const folding = attached.filter(({ card }) =>
          wanted ? wanted.has(card.id) : PROSE_CARD_TYPES.has(card.type ?? ""),
        );
        if (folding.length === 0) {
          return fail(
            `No cards to fold on page ${page_id}. Attached: ` +
              (attached.map(({ card }) => `${card.id} (${card.type})`).join(", ") || "none") +
              ". Prose types are: " + [...PROSE_CARD_TYPES].join(", ") + ".",
          );
        }
        const foldingIds = new Set(folding.map(({ card }) => card.id));
        const staying = attached.filter(({ card }) => !foldingIds.has(card.id));

        const detail = await get<Envelope<PageDetail>>(project, `/admin/pages/${page_id}`);
        const byCode = new Map(
          (detail.data.translations ?? []).map((t) => [t.language.code.toLowerCase(), t]),
        );
        const codes = (language_codes ?? [...byCode.keys()]).map((code) => code.toLowerCase());
        const languageIds = await resolveLanguageIds(project, codes);

        // Defaults are re-applied here, not just in the schema: an omitted flag must
        // mean "preview, keep everything" rather than an unannounced live write.
        const headingTag = heading_level === "none" ? null : (heading_level ?? "h2");
        const preview = dry_run !== false;
        const results: Record<string, unknown>[] = [];
        let wrote = 0;

        for (const code of codes) {
          const translation = byCode.get(code);
          if (!translation) {
            results.push({ language: code, skipped: "the page has no translation in this language" });
            continue;
          }

          const blocks: string[] = [];
          const missing: number[] = [];
          for (const { card } of folding) {
            const text = cardText(card, code);
            if (!text) {
              missing.push(card.id);
              continue;
            }
            const html = cardToHtml(card, text, headingTag, code);
            if (html) blocks.push(html);
          }

          if (blocks.length === 0) {
            results.push({
              language: code,
              skipped: "none of the folded cards have text in this language",
              cards_missing_language: missing,
            });
            continue;
          }

          const content = blocks.join("\n\n");
          const had = (translation.content ?? "").length;
          if (had > 0 && overwrite !== true) {
            results.push({
              language: code,
              skipped: `the body already has ${had} characters — pass overwrite:true to replace it`,
              would_write_chars: content.length,
            });
            continue;
          }

          if (preview) {
            results.push({
              language: code,
              would_write_chars: content.length,
              replaces_chars: had,
              cards: blocks.length,
              ...(missing.length ? { cards_missing_language: missing } : {}),
              preview: content.slice(0, 600),
            });
            continue;
          }

          await writePageContent(project, page_id, languageIds.get(code)!, translation, content);
          wrote += 1;
          results.push({
            language: code,
            written_chars: content.length,
            replaced_chars: had,
            cards: blocks.length,
            ...(missing.length ? { cards_missing_language: missing } : {}),
          });
        }

        // Layout and the card list only change once the text is actually in.
        const block =
          page_content ??
          ({
            enabled: true,
            order: folding[0]?.slot.order ?? 0,
            grid_columns: 12,
          } as const);
        if (!preview && wrote > 0) {
          const body: Record<string, unknown> = { page_content: block };
          if (detach_cards === true) {
            body.cards = staying.map(({ slot }) => ({
              id: slot.id,
              ...(slot.order == null ? {} : { order: slot.order }),
              ...(slot.grid_columns == null ? {} : { grid_columns: slot.grid_columns }),
            }));
          }
          await put(project, `/admin/pages/${page_id}`, body);
        }

        return ok({
          project,
          page_id,
          dry_run: preview,
          folded_cards: folding.map(({ card, slot }) => ({
            id: card.id,
            type: card.type,
            order: slot.order ?? 0,
            title: cardText(card, codes[0] ?? "")?.title ?? null,
          })),
          kept_cards: staying.map(({ card }) => ({ id: card.id, type: card.type })),
          page_content: preview ? { would_set: block } : block,
          cards_detached: !preview && wrote > 0 && detach_cards === true,
          languages: results,
          note: preview
            ? "Nothing was written. Re-run with dry_run:false to save."
            : detach_cards === true
              ? "The folded cards were removed from the page but still exist in the card library — delete_card removes them for good."
              : "The folded cards are still attached, so the page now renders this text twice. update_page({cards:[…]}) drops them.",
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
        "Updates a page's structure: its cover image, header/footer/parent, and every body " +
        "section — cards, heroes, sliders, forms, processes, before/afters, packages, price " +
        "comparisons, promotional landings and map sections. Each section array you pass " +
        "REPLACES that section wholesale — pass the full desired list of {id, order?}; " +
        "sections you omit are left unchanged. To add or remove one item, read get_page for " +
        "the current ids first. Note that `order` is a single sequence across ALL section " +
        "types on the page, not per type: a hero at order 5 renders below a card at order 2. " +
        "Also switches the page's sticky WhatsApp button (sticky_whatsapp). Requires login.",
      inputSchema: {
        project: projectParam,
        page_id: z.number().int(),
        featured_image_id: z.number().int().nullable().optional().describe("Cover image; null to clear."),
        banner_style: bannerStyleParam.optional(),
        banner_video_id: bannerVideoParam.optional(),
        header_id: z.number().int().optional(),
        header_style: headerStyleParam.optional(),
        footer_id: z.number().int().optional(),
        parent_id: z.number().int().nullable().optional(),
        cards: orderedItems.optional(),
        heroes: orderedItems.optional(),
        sliders: orderedItems.optional(),
        contact_forms: orderedItems
          .optional()
          .describe(
            "Only the first contact form on a page renders, and it is suppressed entirely " +
              "when the page has page_content, a blog layout, or a card of type 'content'.",
          ),
        multi_page_forms: orderedItems.optional(),
        processes: orderedItems
          .optional()
          .describe("Only the first process on a page renders."),
        before_afters: orderedItems
          .optional()
          .describe(
            "All style_4 galleries on a page merge into one filterable block using the " +
              "first one's order; style_1–3 each render separately.",
          ),
        packages: orderedItems.optional(),
        price_compares: orderedItems.optional(),
        promotional_landings: orderedItems.optional(),
        google_map_sections: orderedItems
          .optional()
          .describe("Grid columns are ignored for map sections; they always span full width."),
        page_content: pageContentParam.optional(),
        // Built-in blocks, switched on rather than attached by id.
        blogs: blogsFlagParam.optional(),
        services: servicesFlagParam.optional(),
        social_media: socialMediaFlagParam.optional(),
        reviews: reviewsFlagParam.optional(),
        page_faq: pageFaqFlagParam.optional(),
        sticky_multi_form: stickyFormFlagParam.optional(),
        sticky_whatsapp: stickyWhatsAppParam.optional(),
        single_blog_content: featureFlagParam
          .optional()
          .describe(
            "Marks this as a single-blog page. Turning it on removes the standalone contact " +
              "form, because this layout renders the form in its own sidebar.",
          ),
        single_service_content: featureFlagParam
          .optional()
          .describe("Marks this as a single-service page."),
        before_after_ai: featureFlagParam.optional(),
        graft_calculator: featureFlagParam
          .optional()
          .describe("Sent to the API as `graftCalculator` — the one camelCase key in this payload."),
        child_pages: z
          .object({
            show_child_pages: z.boolean(),
            order: z.number().int().min(0).optional(),
            grid_columns: z.number().int().min(1).max(12).optional(),
          })
          .optional()
          .describe("Uses show_child_pages, not enabled."),
        data_source_type: z
          .string()
          .nullable()
          .optional()
          .describe("'blog_list' or 'service_list', or null to clear."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, page_id, ...body }) =>
      guard(async () => {
        const badValue = ensureVocabulary([["faq_style", body.page_faq?.style]]);
        if (badValue) return fail(badValue);
        const badFormat = ensureFormats([checkQueryParameters(body.blogs?.query_parameters)]);
        if (badFormat) return fail(badFormat);
        // The API reads this one block under a camelCase alias.
        const { graft_calculator, ...rest } = body;
        const payload: Record<string, unknown> = { ...rest };
        if (graft_calculator !== undefined) payload.graftCalculator = graft_calculator;
        await put(project, `/admin/pages/${page_id}`, payload);
        return ok({
          project,
          page_id,
          updated: true,
          changed: Object.keys(payload).filter((k) => payload[k] !== undefined),
        });
      }),
  );
}
