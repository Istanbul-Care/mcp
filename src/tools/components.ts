/**
 * Structural CRUD for the remaining page components — the building blocks that
 * make up a brand's landing pages: sliders, heroes, processes, packages,
 * price-compares, promotional-landings, before-afters, google-map-sections, doctors,
 * redirects and global-settings.
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

  server.registerTool(
    "create_package",
    {
      title: "Create a package",
      description:
        "Creates a pricing package with its first-language title and optional sections/offers. " +
        "Requires login.",
      inputSchema: {
        project: projectParam,
        language_id: z.number().int(),
        title: z.string(),
        is_featured: z.boolean().optional(),
        sections: z
          .array(z.record(z.unknown()))
          .optional()
          .describe(
            "[{ order?, is_recommended?, translation: { title*, language_id }, offers?: [...] }].",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, language_id, title, is_featured, sections }) =>
      guard(() =>
        createEntity(project, "/admin/packages", {
          translation: { language_id, title },
          is_featured,
          sections,
        }),
      ),
  );

  server.registerTool(
    "update_package",
    {
      title: "Update a package",
      description:
        "Edits a package's price / featured flag. Pass only what changes. Requires login.",
      inputSchema: {
        project: projectParam,
        package_id: z.number().int(),
        price: z.number().optional(),
        is_featured: z.boolean().optional(),
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
        "Creates a before/after gallery block with optional inline image pairs. Requires login.",
      inputSchema: {
        project: projectParam,
        language_id: z.number().int().optional(),
        sort_order: z.number().int().optional(),
        style: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        gallery_items: z
          .array(z.record(z.unknown()))
          .optional()
          .describe("Before/after pairs: [{ before_image_id, after_image_id, ... }]."),
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

  server.registerTool(
    "get_zapier_allow_list",
    {
      title: "Read the Zapier allow list",
      description:
        "Every lead is labelled first (real / test / spam); a real lead goes to Zapier (the CRM), a " +
        "test or spam one only when its e-mail — or its @domain — is on this list (e.g. our own people " +
        "testing the CRM). Others are only labelled. Per brand. Requires login.",
      inputSchema: { project: projectParam },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project }) =>
      guard(async () => {
        const response = await get<{ emails: string[] }>(project, "/admin/lead-quality/allow-list");
        return ok({ project, emails: response.emails });
      }),
  );

  server.registerTool(
    "set_zapier_allow_list",
    {
      title: "Replace the Zapier allow list",
      description:
        "Replaces the brand's Zapier allow list: one entry per e-mail, or \"@domain.com\" for a whole " +
        "domain. Their test or spam leads still go to Zapier; everyone else's only when real. [] empties " +
        "it. Admins only. Requires login.",
      inputSchema: {
        project: projectParam,
        emails: z.array(z.string().min(3).max(254)).max(500),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, emails }) =>
      guard(async () => {
        const bad = emails.filter((e) => !/^(@[^@\s]+\.[a-z]{2,}|[^@\s]+@[^@\s]+\.[a-z]{2,})$/i.test(e.trim()));
        if (bad.length) return fail(`Not an e-mail or @domain: ${bad.join(", ")}`);
        const response = await put<{ emails: string[] }>(project, "/admin/lead-quality/allow-list", { emails });
        return ok({ project, emails: response.emails });
      }),
  );
}
