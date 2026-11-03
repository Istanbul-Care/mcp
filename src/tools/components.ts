/**
 * Structural CRUD for the remaining page components — the building blocks that
 * make up a brand's landing pages: sliders, heroes, processes, packages,
 * price-compares, promotional-landings, before-afters (and their angles and
 * categories), google-map-sections, doctors, campaigns, redirects and global-settings.
 *
 * Translations of these live through the registry-driven translate_* tools;
 * these tools create/update/delete the components themselves. Nested children
 * (slides, features, offers, steps, …) are passed inline at create time; edit
 * them by re-sending the parent's child array on update where the API supports
 * it. Each write needs login.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post, put, del } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { ok, fail, guard, projectParam, ensureVocabulary } from "./helpers.js";
import {
  PROCESS_EYEBROW_TEXT,
  PROCESS_STEP_IMAGE_TEXT,
  PROCESS_STYLE_TEXT,
  processStyleParam,
} from "./process-fields.js";
import { BEFORE_AFTER_STYLE_TEXT, caseFields } from "./before-after-fields.js";

/**
 * Create responses come in two shapes: most wrap the new row under `data`
 * ({ status, data: { id } }), but a few (e.g. redirects) put the id at the top
 * level ({ status, id }). Read whichever is present.
 */
interface CreateResponse {
  id?: number;
  data?: { id?: number };
}

/** POST a create body and return the new id. Wraps the write-gate. */
async function createEntity(
  project: string,
  path: string,
  body: unknown,
  vocabulary: Array<[string, unknown]> = [],
): Promise<ReturnType<typeof ok>> {
  // Style/type fields are free strings in the database; a value the site has
  // no branch for renders as something else with no error anywhere.
  const badValue = ensureVocabulary(vocabulary);
  if (badValue) return fail(badValue);
  const response = await post<CreateResponse>(project as never, path, body);
  const id = response.data?.id ?? response.id;
  return ok({ project, id, created: true });
}

/**
 * List responses embed every nested child and every-language translation, which
 * can be megabytes. Compact each row down to its scalar fields for browsing —
 * long strings are truncated and nested arrays/objects collapse to a count or a
 * bare id/label. Pagination fields (total, page, …) are preserved.
 */
function compactValue(v: unknown): unknown {
  if (v === null || typeof v !== "object") {
    return typeof v === "string" && v.length > 120 ? v.slice(0, 120) + "…" : v;
  }
  if (Array.isArray(v)) return `[${v.length} items]`;
  const obj = v as Record<string, unknown>;
  const keep: Record<string, unknown> = {};
  for (const k of ["id", "title", "name", "language_id", "language_code", "code"]) {
    if (k in obj) keep[k] = obj[k];
  }
  return Object.keys(keep).length ? keep : "{…}";
}

function compactRow(row: unknown): unknown {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) out[k] = compactValue(v);
  return out;
}

function compactList(data: unknown): unknown {
  if (data === null || typeof data !== "object") return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    out[k] = Array.isArray(v) ? v.map(compactRow) : v;
  }
  return out;
}

/** Register a standard `list_<name>` (GET) + `delete_<name>` (DELETE) pair. */
function registerListDelete(
  server: McpServer,
  opts: {
    entity: string; // singular, for tool names / id param
    collection: string; // plural, for the URL segment
    label: string; // human label for descriptions
  },
): void {
  const { entity, collection, label } = opts;
  const idParam = `${entity}_id`;

  server.registerTool(
    `list_${collection.replace(/-/g, "_")}`,
    {
      title: `List ${label}`,
      description: `Lists the ${label} configured for a brand. Requires login.`,
      inputSchema: {
        project: projectParam,
        limit: z.number().int().min(1).max(200).default(50),
        page: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, ...query }) =>
      guard(async () => {
        const response = await get<Envelope<unknown>>(project, `/admin/${collection}`, query);
        return ok({ project, data: compactList(response.data) });
      }),
  );

  server.registerTool(
    `delete_${entity}`,
    {
      title: `Delete a ${label.replace(/s$/, "")}`,
      description: `Permanently removes one of the ${label}. Requires login.`,
      inputSchema: {
        project: projectParam,
        [idParam]: z.number().int(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) =>
      guard(async () => {
        const project = args.project;
        await del(project, `/admin/${collection}/${args[idParam]}`);
        return ok({ project, [idParam]: args[idParam], deleted: true });
      }),
  );
}

/**
 * list / create / update / delete for one of a brand's two before/after lists
 * (angles, categories) — /admin/before-afters/{angles|categories}. The list is
 * short and unpaged, so it comes back whole, every language's name included.
 */
function registerBeforeAfterList(
  server: McpServer,
  opts: {
    collection: "angles" | "categories";
    entity: "angle" | "category";
    /** What the list is for. */
    what: string;
    example: string;
    /** What force=true does to the cases using one. */
    inUse: string;
  },
): void {
  const { collection, entity, what, example, inUse } = opts;
  const base = `/admin/before-afters/${collection}`;
  const idParam = `${entity}_id`;

  const nameIn = (create: boolean) =>
    z.object({
      language_code: z.string().optional().describe("e.g. 'en' (or give language_id)."),
      language_id: z.number().int().optional().describe("list_languages (or give language_code)."),
      name: (create ? z.string().min(1) : z.string())
        .max(100)
        .describe(
          create
            ? `The name in that language, e.g. ${example}.`
            : `The name in that language; "" removes that language's name.`,
        ),
    });

  server.registerTool(
    `list_before_after_${collection}`,
    {
      title: `List the before/after ${collection}`,
      description:
        `The brand's before/after ${collection}: ${what}. Each with its id, sort_order, name (the ` +
        "default language's), every language's name and usage_count (the cases using it). " +
        "Requires login.",
      inputSchema: { project: projectParam },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project }) =>
      guard(async () => {
        const response = await get<Envelope<unknown>>(project, base);
        return ok({ project, [collection]: response.data });
      }),
  );

  server.registerTool(
    `create_before_after_${entity}`,
    {
      title: `Add a before/after ${entity}`,
      description:
        `Adds one of the brand's before/after ${collection} — ${what}. Give its name in each ` +
        "language you have (at least one; a language without one shows the default " +
        "language's on the site). Requires login.",
      inputSchema: {
        project: projectParam,
        sort_order: z.number().int().min(0).optional().describe("Lower comes first; ties by id."),
        translations: z.array(nameIn(true)).min(1).describe("A name per language."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) =>
      guard(async () => {
        const response = await post<Envelope<{ id?: number }>>(project, base, body);
        return ok({ project, created: true, id: response.data?.id, [entity]: response.data });
      }),
  );

  server.registerTool(
    `update_before_after_${entity}`,
    {
      title: `Update a before/after ${entity}`,
      description:
        `Renames or reorders one of the brand's before/after ${collection}. Only the languages ` +
        "sent change, the others are kept; at least one name must remain. The pages showing " +
        "a style_5 gallery are rebuilt. Requires login.",
      inputSchema: {
        project: projectParam,
        [idParam]: z.number().int().describe(`From list_before_after_${collection}.`),
        sort_order: z.number().int().min(0).optional(),
        translations: z.array(nameIn(false)).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guard(async () => {
        const { project, [idParam]: id, ...body } = args as Record<string, any>;
        const response = await put<Envelope<unknown>>(project, `${base}/${id}`, body);
        return ok({ project, [idParam]: id, updated: true, [entity]: response.data });
      }),
  );

  server.registerTool(
    `delete_before_after_${entity}`,
    {
      title: `Delete a before/after ${entity}`,
      description:
        `Removes one of the brand's before/after ${collection}. One in use (usage_count > 0) is ` +
        `refused (409) unless force is true; with force ${inUse}. Requires login.`,
      inputSchema: {
        project: projectParam,
        [idParam]: z.number().int().describe(`From list_before_after_${collection}.`),
        force: z
          .boolean()
          .optional()
          .describe("true deletes it even when cases use it. Default false."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) =>
      guard(async () => {
        const { project, [idParam]: id, force } = args as Record<string, any>;
        const forced = force === true;
        await del(project, `${base}/${id}?force=${forced}`);
        return ok({ project, [idParam]: id, deleted: true, forced });
      }),
  );
}

export function registerComponentTools(server: McpServer): void {
  // ---- Redirects (flat, no translations) --------------------------------
  const redirectMethod = z
    .enum(["301", "302", "303", "307", "308"])
    .describe("HTTP redirect status. 301 = permanent (default), 302/307 = temporary.");

  registerListDelete(server, { entity: "redirect", collection: "redirects", label: "URL redirects" });

  server.registerTool(
    "create_redirect",
    {
      title: "Create a URL redirect",
      description:
        "Adds a source→target URL redirect for a brand. Give both addresses as a visitor " +
        "sees them on the site, with the language prefix the site uses (none for the " +
        "default language): /de/old-page/ → /de/new-page/. The backend stores the source " +
        "as /v1/<lang>/pages/<path>, the form the site looks up; the reply shows it. " +
        "Files (.pdf, .webp) and home pages can't be redirected. Requires login.",
      inputSchema: {
        project: projectParam,
        source_url: z
          .string()
          .describe("The old address, e.g. /de/old-page/ or a full URL on the brand's site."),
        target_url: z.string().describe("Where it should go, e.g. /de/new-page/."),
        method: redirectMethod.default("301"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) => guard(() => createEntity(project, "/admin/redirects", body)),
  );

  server.registerTool(
    "update_redirect",
    {
      title: "Update a URL redirect",
      description: "Edits an existing redirect. Pass only what changes. Requires login.",
      inputSchema: {
        project: projectParam,
        redirect_id: z.number().int(),
        source_url: z.string().optional().describe("The old address, as in create_redirect."),
        target_url: z.string().optional(),
        method: redirectMethod.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, redirect_id, ...body }) =>
      guard(async () => {
        await put(project, `/admin/redirects/${redirect_id}`, body);
        return ok({ project, redirect_id, updated: true });
      }),
  );

  // ---- Google map sections ----------------------------------------------
  registerListDelete(server, {
    entity: "google_map_section",
    collection: "google-map-sections",
    label: "map/contact sections",
  });

  server.registerTool(
    "create_google_map_section",
    {
      title: "Create a map/contact section",
      description:
        "Creates a Google-map + contact block (map embed, phone, e-mail, social id) with its " +
        "first-language text. Requires login.",
      inputSchema: {
        project: projectParam,
        googlemap_url: z.string().describe("The map embed URL."),
        phone_number: z.string(),
        email: z.string(),
        social_media_id: z.string().describe("Social handle/id shown in the block."),
        is_active: z.boolean().optional(),
        language_id: z.number().int().describe("Language of the text below."),
        title: z.string(),
        description: z.string(),
        cta_button_text: z.string(),
        cta_button_url: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, language_id, title, description, cta_button_text, cta_button_url, ...rest }) =>
      guard(() =>
        createEntity(project, "/admin/google-map-sections", {
          ...rest,
          translation: { language_id, title, description, cta_button_text, cta_button_url },
        }),
      ),
  );

  server.registerTool(
    "update_google_map_section",
    {
      title: "Update a map/contact section",
      description:
        "Edits the map/contact fields (not the translated text — use the translate tools for that). " +
        "Pass only what changes. Requires login.",
      inputSchema: {
        project: projectParam,
        google_map_section_id: z.number().int(),
        googlemap_url: z.string().optional(),
        phone_number: z.string().optional(),
        email: z.string().optional(),
        social_media_id: z.string().optional(),
        is_active: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, google_map_section_id, ...body }) =>
      guard(async () => {
        await put(project, `/admin/google-map-sections/${google_map_section_id}`, body);
        return ok({ project, google_map_section_id, updated: true });
      }),
  );

  // ---- Doctors -----------------------------------------------------------
  registerListDelete(server, { entity: "doctor", collection: "doctors", label: "doctors" });

  const doctorTranslations = z
    .array(
      z.object({
        language_id: z.number().int(),
        title: z.string().max(150).nullable().optional().describe("e.g. 'Hair Transplant Doctor'."),
        quote: z.string().max(300).nullable().optional().describe("A line in their words, no quote marks."),
        bio: z.string().nullable().optional().describe("A short paragraph, plain text."),
        specialties: z
          .string()
          .max(300)
          .nullable()
          .optional()
          .describe("Comma-separated: 'FUE, DHI, Hairline design' (one line on the site)."),
      }),
    )
    .describe(
      "Per language. The languages given are written, the others kept; a language without text " +
        "shows the default language's on the site.",
    );
  const doctorFields = {
    photo_id: z.number().int().nullable().optional().describe("A portrait IMAGE of the media library (4:5 crop, face at the top)."),
    profile_page_id: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe("The doctor's own page; 'View full profile' opens it in the visitor's language."),
    stat_procedures: z.string().max(30).nullable().optional().describe("As it should read: '6,000+'."),
    stat_patients: z.string().max(30).nullable().optional().describe("'9,000+'"),
    stat_years: z.string().max(30).nullable().optional().describe("Years of experience: '20+'."),
    is_active: z.boolean().optional().describe("false hides them on every page."),
  };

  server.registerTool(
    "get_doctor",
    {
      title: "Read one doctor",
      description: "One of the brand's doctors with every language's text. Requires login.",
      inputSchema: { project: projectParam, doctor_id: z.number().int() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, doctor_id }) =>
      guard(async () => {
        const response = await get<Envelope<unknown>>(project, `/admin/doctors/${doctor_id}`);
        return ok({ project, doctor: response.data });
      }),
  );

  server.registerTool(
    "create_doctor",
    {
      title: "Add a doctor",
      description:
        "Adds one of the brand's doctors, shown by a page's Doctors block (update_page `doctors`): " +
        "a name tab each, the picked one's profile — portrait, title, name, quote, bio, the three " +
        "figures, what they do, 'Ask … on WhatsApp' and their profile link. Requires login.",
      inputSchema: {
        project: projectParam,
        name: z.string().min(1).max(150).describe("As shown in every language: 'Dr. Asil Onay'."),
        ...doctorFields,
        translations: doctorTranslations.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) => guard(() => createEntity(project, "/admin/doctors", body)),
  );

  server.registerTool(
    "update_doctor",
    {
      title: "Update a doctor",
      description:
        "Edits a doctor: pass only what changes; translations write the languages given. The pages " +
        "showing them are rebuilt. Requires login.",
      inputSchema: {
        project: projectParam,
        doctor_id: z.number().int(),
        name: z.string().min(1).max(150).optional(),
        ...doctorFields,
        translations: doctorTranslations.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, doctor_id, ...body }) =>
      guard(async () => {
        await put(project, `/admin/doctors/${doctor_id}`, body);
        return ok({ project, doctor_id, updated: true });
      }),
  );

  // ---- Campaigns ---------------------------------------------------------
  // A seasonal look for the whole site (Black Friday, …), switched on and off.
  registerListDelete(server, { entity: "campaign", collection: "campaigns", label: "campaigns" });

  const hexColor = z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "a colour is written #rrggbb")
    .nullable()
    .optional();
  const campaignTranslations = z
    .array(
      z.object({
        language_id: z.number().int(),
        badge_text: z.string().max(60).nullable().optional().describe("The occasion's name as shown: 'BLACK FRIDAY'."),
        discount_text: z.string().max(40).nullable().optional().describe("The offer in a few characters: '-30%'. Big in the popup, on the package ribbon."),
        side_text: z
          .string()
          .max(200)
          .nullable()
          .optional()
          .describe("The side card's line (the card that slides in from the edge): 'Up to 30% off every hair transplant package'."),
        button_text: z.string().max(60).nullable().optional().describe("The side card's button: 'Claim the offer'."),
        button_url: z
          .string()
          .max(500)
          .nullable()
          .optional()
          .describe("The side card button's link: 'cta_url' (WhatsApp through the lead form), 'contact-form' (the contact form) or a page link."),
        popup_eyebrow: z.string().max(120).nullable().optional(),
        popup_title: z.string().max(200).nullable().optional(),
        popup_description: z.string().nullable().optional().describe("Plain text, a line or two."),
        popup_button_text: z.string().max(60).nullable().optional(),
      }),
    )
    .describe(
      "Per language. The languages given are written (every text of that language — send them all), the " +
        "others kept. The site shows the campaign ONLY in languages that have texts.",
    );
  const campaignSwaps = z
    .array(
      z.object({
        from_media_id: z.number().int().positive().describe("The site's own picture (a media id)."),
        to_media_id: z.number().int().positive().describe("The campaign picture shown in its place (an IMAGE)."),
      }),
    )
    .superRefine((rows, ctx) => {
      const seen = new Set<number>();
      rows.forEach((row, i) => {
        if (row.from_media_id === row.to_media_id)
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i], message: "a picture cannot replace itself" });
        if (seen.has(row.from_media_id))
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i], message: `media ${row.from_media_id} is replaced twice` });
        seen.add(row.from_media_id);
      });
    })
    .describe(
      "Pictures swapped while the campaign is on: wherever the site shows from_media_id it shows " +
        "to_media_id instead; the box keeps its size, so use pictures of a similar shape, not specific to " +
        "a treatment or a doctor. Sent, the list REPLACES the old one ([] clears it); left out, kept.",
    );
  const campaignFields = {
    theme: z
      .string()
      .optional()
      .describe("The occasion's look on the site (vocabulary campaign_theme): 'black_friday', or 'custom' for the colours only."),
    ends_at: z
      .string()
      .nullable()
      .optional()
      .describe("ISO date-time with offset, e.g. '2026-11-30T23:59:00+03:00' (Istanbul). The countdown counts to it; after it the site shows nothing. null: until switched off."),
    accent_color: hexColor.describe("'#rrggbb'; null = the theme's own (Black Friday: #f5c542)."),
    background_color: hexColor.describe("'#rrggbb'; null = the theme's own (Black Friday: #0b0b0f)."),
    text_color: hexColor.describe("'#rrggbb'; null = the theme's own (Black Friday: #ffffff)."),
    show_side_card: z
      .boolean()
      .optional()
      .describe("Side card and tags: a card and price tags slide in from the sides of the screen (on phones a small tab); the card's X folds them all away, leaving one tag's corner. Nothing on the page moves."),
    show_countdown: z.boolean().optional().describe("The time left to ends_at, on the side card and in the popup."),
    show_popup: z.boolean().optional().describe("The popup in the campaign's look (picture, offer, the brand's popup form)."),
    mark_packages: z.boolean().optional().describe("A sticker with the offer on the corner of the price-table cards."),
    tint_hero: z.boolean().optional().describe("The hero's coloured words take the accent colour."),
    popup_image_id: z.number().int().nullable().optional().describe("An IMAGE of the media library for the popup; null removes it."),
    media_swaps: campaignSwaps.optional(),
  };
  const campaignVocabulary = (theme: unknown): Array<[string, unknown]> => [["campaign_theme", theme]];

  server.registerTool(
    "get_campaign",
    {
      title: "Read one campaign",
      description:
        "One seasonal campaign with its colours, switches, picture swaps (media_swaps with both pictures) " +
        "and every language's texts. Requires login.",
      inputSchema: { project: projectParam, campaign_id: z.number().int() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, campaign_id }) =>
      guard(async () => {
        const response = await get<Envelope<unknown>>(project, `/admin/campaigns/${campaign_id}`);
        return ok({ project, campaign: response.data });
      }),
  );

  server.registerTool(
    "create_campaign",
    {
      title: "Create a campaign",
      description:
        "Creates a seasonal campaign (Black Friday, …): a look laid over the whole site — a side card " +
        "and price tags sliding in from the edges with the countdown, the popup in its colours, a sticker on the package " +
        "cards, the hero's accent, swapped pictures — that never changes the size of anything and goes " +
        "away when switched off. One is on at a time: is_active true switches the others off. " +
        "The site picks it up within a minute or two. Requires login.",
      inputSchema: {
        project: projectParam,
        name: z.string().min(1).max(120).describe("For the panel only: 'Black Friday 2026'."),
        is_active: z.boolean().default(false).describe("Switch it on now (turns every other campaign off)."),
        ...campaignFields,
        translations: campaignTranslations.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) =>
      guard(() => createEntity(project, "/admin/campaigns", body, campaignVocabulary(body.theme))),
  );

  server.registerTool(
    "update_campaign",
    {
      title: "Update a campaign",
      description:
        "Edits a campaign, or switches it on/off (is_active; on switches the others off). Pass only what " +
        "changes; translations write the languages given. Requires login.",
      inputSchema: {
        project: projectParam,
        campaign_id: z.number().int(),
        name: z.string().min(1).max(120).optional(),
        is_active: z.boolean().optional(),
        ...campaignFields,
        translations: campaignTranslations.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, campaign_id, ...body }) =>
      guard(async () => {
        const badValue = ensureVocabulary(campaignVocabulary(body.theme));
        if (badValue) return fail(badValue);
        const response = await put<Envelope<{ is_active?: boolean; is_live?: boolean }>>(
          project,
          `/admin/campaigns/${campaign_id}`,
          body,
        );
        return ok({
          project,
          campaign_id,
          updated: true,
          is_active: response?.data?.is_active,
          is_live: response?.data?.is_live,
        });
      }),
  );

  // ---- Heroes ------------------------------------------------------------
  registerListDelete(server, { entity: "hero", collection: "heroes", label: "hero banners" });

  const heroFeature = z
    .array(z.record(z.unknown()))
    .optional()
    .describe(
      "Feature cards: [{ image_id?, sort_order?, translation: { title*, description?, url?, language_id? } }].",
    );

  server.registerTool(
    "create_hero",
    {
      title: "Create a hero banner",
      description:
        "Creates a page hero (the big top banner) with its first-language text, optional " +
        "background image and inline feature cards / icons. Requires login.",
      inputSchema: {
        project: projectParam,
        language_id: z.number().int(),
        clinic_rank: z
          .string()
          .optional()
          .describe("The line above the headline, e.g. 'No.1 Hair Clinic'. Optional: left out, none shows."),
        title: z.string(),
        subtitle: z.string(),
        button_text: z.string(),
        button_url: z.string(),
        motion_text: z.string().optional(),
        style: z
          .string()
          .optional()
          .describe("default | cinematic | editorial | premium | form | spotlight | team. 'form' puts the " +
            "brand's contact form on a card beside the headline (the hero's own button is not shown). " +
            "'spotlight' puts the headline, the hero's button and up to four features over the " +
            "background, the side image (side_image_id) beside them when set, and the contact form " +
            "as a strip below. 'team' shows the icons as badges, the headline (*words* coloured), the " +
            "subtitle (**words** bold), WhatsApp + the hero's button beside the side image (team photo) " +
            "with the contact form in front of it."),
        background_image_id: z.number().int().optional(),
        mobile_background_image_id: z.number().int().optional(),
        side_image_id: z
          .number()
          .int()
          .optional()
          .describe("A picture beside the text (the spotlight and team styles), the same in every language."),
        features: heroFeature,
        icons: z
          .array(z.record(z.unknown()))
          .optional()
          .describe("Trust icons: [{ icon_media_id*, order? }]."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({
      project,
      language_id,
      clinic_rank,
      title,
      subtitle,
      button_text,
      button_url,
      motion_text,
      style,
      background_image_id,
      mobile_background_image_id,
      side_image_id,
      features,
      icons,
    }) =>
      guard(() =>
        createEntity(project, "/admin/heroes", {
          translation: {
            language_id,
            clinic_rank,
            title,
            subtitle,
            button_text,
            button_url,
            motion_text,
          },
          style,
          background_image_id,
          mobile_background_image_id,
          side_image_id,
          features,
          icons,
        }, [["hero_style", style]]),
      ),
  );

  // ---- Sliders -----------------------------------------------------------
  registerListDelete(server, { entity: "slider", collection: "sliders", label: "sliders" });

  server.registerTool(
    "create_slider",
    {
      title: "Create a slider",
      description:
        "Creates a slider (carousel) and, optionally, its slides inline. Each slide needs a type " +
        "and a translation { title*, subtitle?, description?, cta_text?, cta_url?, language_id }; " +
        "slides may carry feature stats. Requires login.",
      inputSchema: {
        project: projectParam,
        name: z.string().optional(),
        style: z.string().optional(),
        slides: z
          .array(z.record(z.unknown()))
          .optional()
          .describe(
            "[{ type*, order?, translation: { title*, subtitle?, description?, cta_text?, cta_url?, language_id }, features?: [{ image_id?, order?, translation: { title*, unit_name?, unit_number?, unit_label?, language_id } }] }].",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) =>
      guard(() =>
        createEntity(project, "/admin/sliders", body, [["slider_style", body.style]]),
      ),
  );

  // ---- Processes ---------------------------------------------------------
  registerListDelete(server, { entity: "process", collection: "processes", label: "process sections" });

  // The API reads each inline step flat — its first-language text sits beside
  // its number, not under a `translation` key (which it silently ignores, so
  // the step came out blank). An image_id left out stays out of the body.
  const processStep = z.object({
    step_number: z.number().int().min(1),
    sort_order: z.number().int().min(0).optional(),
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    icon: z.string().max(255).optional().describe("An Iconify name, e.g. 'solar:stethoscope-outline'."),
    image_id: z.number().int().optional().describe(PROCESS_STEP_IMAGE_TEXT),
  });

  server.registerTool(
    "create_process",
    {
      title: "Create a process section",
      description:
        "Creates a 'how it works' process block with its first-language text and optional numbered " +
        "steps. Requires login.",
      inputSchema: {
        project: projectParam,
        title: z.string(),
        description: z.string().optional(),
        button_text: z.string().optional(),
        button_url: z.string().optional(),
        eyebrow: z.string().max(100).optional().describe(PROCESS_EYEBROW_TEXT),
        language_id: z.number().int().optional(),
        sort_order: z.number().int().optional(),
        image_id: z.number().int().optional(),
        style: processStyleParam.optional().describe(`${PROCESS_STYLE_TEXT} Defaults to 1.`),
        steps: z
          .array(processStep)
          .optional()
          .describe(
            "Inline steps, each with its first-language text: [{ step_number, sort_order?, " +
              "title, description?, icon?, image_id? }].",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) => guard(() => createEntity(project, "/admin/processes", body)),
  );

  // ---- Packages ----------------------------------------------------------
  registerListDelete(server, { entity: "package", collection: "packages", label: "packages" });

  const PACKAGE_STYLE_TEXT =
    "The design. 1 (or unset): the original cards. 2: the v8 price table — the packages side " +
    "by side with their name, price, line and button lined up across all of them, then each " +
    "one's offers; the recommended section (is_recommended) is highlighted.";
  const packageStyleParam = z.union([z.literal(1), z.literal(2)]);

  server.registerTool(
    "create_package",
    {
      title: "Create a package",
      description:
        "Creates a pricing package with its first-language title and optional sections/offers, " +
        "in the original cards (style 1) or the v8 price table (style 2). Requires login.",
      inputSchema: {
        project: projectParam,
        language_id: z.number().int(),
        title: z.string(),
        is_featured: z.boolean().optional(),
        style: packageStyleParam.optional().describe(PACKAGE_STYLE_TEXT),
        sections: z
          .array(z.record(z.unknown()))
          .optional()
          .describe(
            "[{ order?, is_recommended?, translation: { title*, language_id }, offers?: [...] }].",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, language_id, title, is_featured, style, sections }) =>
      guard(() =>
        createEntity(project, "/admin/packages", {
          translation: { language_id, title },
          is_featured,
          style,
          sections,
        }),
      ),
  );

  server.registerTool(
    "update_package",
    {
      title: "Update a package",
      description:
        "Edits a package's price / featured flag / design (style). Pass only what changes. " +
        "Requires login.",
      inputSchema: {
        project: projectParam,
        package_id: z.number().int(),
        price: z.number().optional(),
        is_featured: z.boolean().optional(),
        style: packageStyleParam
          .optional()
          .describe(`${PACKAGE_STYLE_TEXT} Leave it out to keep the current one.`),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, package_id, ...body }) =>
      guard(async () => {
        await put(project, `/admin/packages/${package_id}`, body);
        return ok({ project, package_id, updated: true });
      }),
  );

  // ---- Price compares ----------------------------------------------------
  registerListDelete(server, {
    entity: "price_compare",
    collection: "price-compares",
    label: "price-comparison sections",
  });

  server.registerTool(
    "create_price_compare",
    {
      title: "Create a price-comparison section",
      description:
        "Creates a price-comparison block with its first-language titles. Add per-country rows " +
        "afterwards. Requires login.",
      inputSchema: {
        project: projectParam,
        main_title: z.string(),
        bottom_title: z.string().optional(),
        description: z.string().optional(),
        language_id: z.number().int().optional(),
        sort_order: z.number().int().optional(),
        background_image_id: z.number().int().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) =>
      guard(() => createEntity(project, "/admin/price-compares", body)),
  );

  // ---- Promotional landings ---------------------------------------------
  registerListDelete(server, {
    entity: "promotional_landing",
    collection: "promotional-landings",
    label: "promotional landing blocks",
  });

  server.registerTool(
    "create_promotional_landing",
    {
      title: "Create a promotional landing block",
      description:
        "Creates a promotional landing section with its first-language text, optional background/" +
        "video and a gallery. Requires login.",
      inputSchema: {
        project: projectParam,
        title: z.string(),
        description: z.string().optional(),
        read_more_text: z.string().optional(),
        read_more_url: z.string().optional(),
        contact_text: z.string().optional(),
        contact_url: z.string().optional(),
        language_id: z.number().int().optional(),
        sort_order: z.number().int().optional(),
        background_image_id: z.number().int().optional(),
        video_id: z
          .number()
          .int()
          .optional()
          .describe(
            "A video media id (upload_media for a file, add_external_media for YouTube/TikTok). " +
              "The landing shows the video's own thumbnail as its cover until play; set or " +
              "replace it with set_media_thumbnail.",
          ),
        gallery_ids: z.array(z.number().int()).optional().describe("Media ids for the gallery."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) =>
      guard(() => createEntity(project, "/admin/promotional-landings", body)),
  );

  // ---- Before/afters -----------------------------------------------------
  registerListDelete(server, {
    entity: "before_after",
    collection: "before-afters",
    label: "before/after galleries",
  });

  server.registerTool(
    "create_before_after",
    {
      title: "Create a before/after gallery",
      description:
        "Creates a before/after gallery block with optional inline cases (gallery_items; add " +
        "more later with create_gallery_item). For style_5 create the brand's angles and " +
        "categories first (create_before_after_angle / create_before_after_category), then " +
        "give each case its angle_id, views, category_ids and months_after. Requires login.",
      inputSchema: {
        project: projectParam,
        language_id: z.number().int().optional().describe("Language of title/description."),
        sort_order: z.number().int().optional(),
        style: z.string().optional().describe(BEFORE_AFTER_STYLE_TEXT),
        title: z.string().optional(),
        description: z.string().optional(),
        gallery_items: z
          .array(z.object(caseFields))
          .optional()
          .describe(
            "The cases: [{ before_media_id, after_media_id, sex, technique, graft, age, " +
              "sort_order, angle_id, months_after, category_ids, views }], each field optional.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) =>
      guard(() =>
        createEntity(project, "/admin/before-afters", body, [
          ["before_after_style", body.style],
        ]),
      ),
  );

  // ---- Before/after angles and categories --------------------------------
  // Two lists the brand keeps, the same shape: a name per language and an
  // order. A style_5 case points at them (angle_id, views[].angle_id,
  // category_ids), so they are created before the cases.
  registerBeforeAfterList(server, {
    collection: "angles",
    entity: "angle",
    what:
      "the sides a case is photographed from (Front, Left, Right, Top…). A case's own pair " +
      "has one (angle_id) and its other photos one each (views); the style_5 gallery shows " +
      "them in this list's order",
    example: "'Front'",
    inUse:
      "the cases' photos at that angle (their views) are removed — the media files stay in " +
      "the library — and a case whose own pair had it keeps the pair, without an angle",
  });
  registerBeforeAfterList(server, {
    collection: "categories",
    entity: "category",
    what:
      "what the style_5 gallery filters by (FUE, DHI, Afro, Women…); a case can be in several " +
      "(category_ids), and each section shows the categories its cases are in with their counts",
    example: "'Afro'",
    inUse: "the cases in it just leave it",
  });

  // ---- Global settings ---------------------------------------------------
  registerListDelete(server, {
    entity: "global_setting",
    collection: "global-settings",
    label: "global settings",
  });

  /**
   * The brand's embeds (a page's social_media block shows them). A save
   * replaces the whole list — the backend deletes every item and recreates
   * what it is sent — so every field is in this schema (zod strips a key it
   * does not know, and the item would come back without it), and the optional
   * ones take null because the read shows an unset field as null.
   */
  const embedMediaItem = z.object({
    media_type: z
      .string()
      .min(1)
      .max(50)
      .describe("instagram | tiktok | youtube — see get_vocabularies (social_embed_type)."),
    media_url: z
      .string()
      .min(1)
      .max(500)
      .describe("The post's address (required; the site plays media_id)."),
    media_id: z
      .string()
      .max(255)
      .nullable()
      .optional()
      .describe("youtube / tiktok: the bare video id; instagram: the Elfsight app id."),
    poster_id: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe("A cover image (a media id). Patient stories: the face and the phone's cover — portrait works best."),
    person_name: z
      .string()
      .max(120)
      .nullable()
      .optional()
      .describe("Patient stories: the person's full name; the first word shows under their face."),
    title: z
      .string()
      .max(255)
      .nullable()
      .optional()
      .describe("Patient stories: the line under the name in the phone."),
    tag: z
      .string()
      .max(60)
      .nullable()
      .optional()
      .describe("Patient stories: a short tag chip, e.g. the technique ('Long FUE')."),
    country_code: z
      .string()
      .regex(/^[A-Za-z]{2}$/, "two letters, ISO 3166 alpha-2")
      .nullable()
      .optional()
      .describe(
        "Patient stories: their country, ISO 3166 alpha-2 (GB, DE…) — the country chip and " +
          "'Name · Country' in the phone's top bar. Stored upper-case.",
      ),
    duration_seconds: z
      .number()
      .int()
      .min(0)
      .max(86400)
      .nullable()
      .optional()
      .describe("Its length in seconds (not shown by the patient stories)."),
  });
  const EMBED_MEDIA_TEXT =
    "The brand's Instagram / TikTok / YouTube embeds, which a page's social_media block shows " +
    "(style 2, the patient stories, shows the youtube ones: faces beside a phone that plays " +
    "the one picked, with its person, title, tag and country). A save REPLACES the whole list — every item is deleted and recreated from what " +
    "you send — so send every item with all its fields: read get_component (component " +
    "global_setting) first and send each item back with its changes (poster_id, not poster).";
  const embedVocabulary = (items: Array<{ media_type: string }> | undefined) =>
    (items ?? []).map((item): [string, unknown] => ["social_embed_type", item.media_type]);

  server.registerTool(
    "create_global_setting",
    {
      title: "Create the brand's global settings",
      description:
        "Creates the site-wide settings record: robots.txt / llms.txt content, canonical site " +
        "URL, brand code/name, header & footer scripts, favicon, feature flags, plus the " +
        "first-language contact/social block. A brand usually has exactly one — prefer " +
        "update_global_setting if one already exists. Requires login.",
      inputSchema: {
        project: projectParam,
        robots_txt_content: z.string(),
        llms_txt_content: z.string(),
        site_url: z.string(),
        brand_code: z.string().optional(),
        brand_name: z.string().optional(),
        header_scripts: z.string().optional(),
        footer_scripts: z.string().optional(),
        favicon_media_id: z.number().int().optional(),
        chat_bot_enabled: z.boolean().default(false),
        popup_enabled: z.boolean().default(false),
        popup_show_form: z
          .boolean()
          .default(false)
          .describe("Show a lead form inside the popup in place of its button (only while popup_enabled). After sending: " +
            "the popup's button link if it has one (a WhatsApp link opens straight away, no second form), " +
            "else a thank-you and the popup closes. Leave the button link empty for a form-only popup."),
        popup_style: z
          .number()
          .int()
          .min(1)
          .max(2)
          .optional()
          .describe("The popup's design: 1 the brand panel with cards; 2 the v8 popup — popup_image with the eyebrow, " +
            "title and description on it, beside the short lead form (name, phone, email) and a 'Chat on WhatsApp " +
            "instead' button (through the lead form). Design 2 needs popup_show_form; without it design 1 shows. " +
            "The eyebrow (popup_eyebrow) is per language, with the title."),
        popup_image_id: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("The v8 popup's picture (a portrait photo, WebP); 0 removes it. Never a photo of someone who left the clinic."),
        is_active: z.boolean().optional(),
        language_id: z.number().int(),
        address: z.string(),
        phone_number: z.string(),
        cta_text: z.string(),
        cta_url: z.string(),
        embed_media: z.array(embedMediaItem).optional().describe(EMBED_MEDIA_TEXT),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, language_id, address, phone_number, cta_text, cta_url, ...rest }) =>
      guard(() =>
        createEntity(
          project,
          "/admin/global-settings",
          {
            ...rest,
            translation: { language_id, address, phone_number, cta_text, cta_url },
          },
          embedVocabulary(rest.embed_media),
        ),
      ),
  );

  server.registerTool(
    "update_global_setting",
    {
      title: "Update the brand's global settings",
      description:
        "Edits the site-wide settings (robots/llms.txt, site URL, scripts, favicon, flags, the " +
        "brand's embeds). Pass only what changes; the contact/social text is per-language — use " +
        "the translate tools. embed_media is the exception to 'only what changes': it replaces " +
        "the whole list. Requires login.",
      inputSchema: {
        project: projectParam,
        setting_id: z.number().int(),
        robots_txt_content: z.string().optional(),
        llms_txt_content: z.string().optional(),
        site_url: z.string().optional(),
        brand_code: z.string().optional(),
        brand_name: z.string().optional(),
        header_scripts: z.string().optional(),
        footer_scripts: z.string().optional(),
        favicon_media_id: z.number().int().optional(),
        chat_bot_enabled: z.boolean().optional(),
        chat_bot_name: z
          .string()
          .max(60)
          .optional()
          .describe("The chat assistant's name on this brand's site, one for every language (e.g. 'E-moon'); '' = the site's own (Mr. Graft)."),
        chat_bot_avatar_id: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("The assistant's round face (chat button, window header, replies): a square image; 0 = the site's own."),
        chat_bot_welcome_image_id: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("The full figure on the chat's welcome card; 0 = the face (else the site's own)."),
        popup_enabled: z.boolean().optional(),
        popup_show_form: z
          .boolean()
          .optional()
          .describe("Show a lead form inside the popup in place of its button (only while popup_enabled). After sending: " +
            "the popup's button link if it has one (a WhatsApp link opens straight away, no second form), " +
            "else a thank-you and the popup closes. Leave the button link empty for a form-only popup."),
        popup_style: z
          .number()
          .int()
          .min(1)
          .max(2)
          .optional()
          .describe("The popup's design: 1 the brand panel with cards; 2 the v8 popup — popup_image with the eyebrow, " +
            "title and description on it, beside the short lead form (name, phone, email) and a 'Chat on WhatsApp " +
            "instead' button (through the lead form). Design 2 needs popup_show_form; without it design 1 shows. " +
            "The eyebrow (popup_eyebrow) is per language, with the title."),
        popup_image_id: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("The v8 popup's picture (a portrait photo, WebP); 0 removes it. Never a photo of someone who left the clinic."),
        is_active: z.boolean().optional(),
        embed_media: z
          .array(embedMediaItem)
          .optional()
          .describe(`${EMBED_MEDIA_TEXT} Leave it out to keep the list as it is; [] removes them all.`),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, setting_id, ...body }) =>
      guard(async () => {
        const badValue = ensureVocabulary(embedVocabulary(body.embed_media));
        if (badValue) return fail(badValue);
        await put(project, `/admin/global-settings/${setting_id}`, body);
        return ok({ project, setting_id, updated: true });
      }),
  );
}
