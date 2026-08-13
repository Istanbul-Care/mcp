/**
 * Structural CRUD for the remaining page components — the building blocks that
 * make up a brand's landing pages: sliders, heroes, processes, packages,
 * price-compares, promotional-landings, before-afters, google-map-sections,
 * redirects and global-settings.
 *
 * Translations of these live through the registry-driven translate_* tools;
 * these tools create/update/delete the components themselves. Nested children
 * (slides, features, offers, steps, …) are passed inline at create time; edit
 * them by re-sending the parent's child array on update where the API supports
 * it. Each write needs login + a write-enabled brand.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post, put, del } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { ok, fail, guard, projectParam, ensureWritable } from "./helpers.js";

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
): Promise<ReturnType<typeof ok>> {
  const blocked = ensureWritable(project as never);
  if (blocked) return fail(blocked);
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
      description: `Permanently removes one of the ${label}. Requires login and a write-enabled brand.`,
      inputSchema: {
        project: projectParam,
        [idParam]: z.number().int(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) =>
      guard(async () => {
        const project = args.project;
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
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
        "Adds a source→target URL redirect for a brand. Use relative paths (e.g. /old-page). " +
        "Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        source_url: z.string().describe("The old/incoming path, e.g. /old-slug."),
        target_url: z.string().describe("Where it should go, e.g. /new-slug."),
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
      description: "Edits an existing redirect. Pass only what changes. Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        redirect_id: z.number().int(),
        source_url: z.string().optional(),
        target_url: z.string().optional(),
        method: redirectMethod.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, redirect_id, ...body }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
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
        "first-language text. Requires login and a write-enabled brand.",
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
        "Pass only what changes. Requires login and a write-enabled brand.",
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
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        await put(project, `/admin/google-map-sections/${google_map_section_id}`, body);
        return ok({ project, google_map_section_id, updated: true });
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
        "background image and inline feature cards / icons. Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        language_id: z.number().int(),
        clinic_rank: z.string().describe("e.g. 'No.1 Hair Clinic'."),
        title: z.string(),
        subtitle: z.string(),
        button_text: z.string(),
        button_url: z.string(),
        motion_text: z.string().optional(),
        style: z.string().optional(),
        background_image_id: z.number().int().optional(),
        mobile_background_image_id: z.number().int().optional(),
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
          features,
          icons,
        }),
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
        "slides may carry feature stats. Requires login and a write-enabled brand.",
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
    async ({ project, ...body }) => guard(() => createEntity(project, "/admin/sliders", body)),
  );

  // ---- Processes ---------------------------------------------------------
  registerListDelete(server, { entity: "process", collection: "processes", label: "process sections" });

  server.registerTool(
    "create_process",
    {
      title: "Create a process section",
      description:
        "Creates a 'how it works' process block with its first-language text and optional numbered " +
        "steps. Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        title: z.string(),
        description: z.string().optional(),
        button_text: z.string().optional(),
        button_url: z.string().optional(),
        language_id: z.number().int().optional(),
        sort_order: z.number().int().optional(),
        image_id: z.number().int().optional(),
        steps: z
          .array(z.record(z.unknown()))
          .optional()
          .describe("Inline steps: [{ step_number*, sort_order?, translation? }]."),
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
        "Requires login and a write-enabled brand.",
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
        "Edits a package's price / featured flag. Pass only what changes. Requires login and a write-enabled brand.",
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
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
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
        "afterwards. Requires login and a write-enabled brand.",
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
        "video and a gallery. Requires login and a write-enabled brand.",
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
        video_id: z.number().int().optional(),
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
        "Creates a before/after gallery block with optional inline image pairs. Requires login " +
        "and a write-enabled brand.",
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
      guard(() => createEntity(project, "/admin/before-afters", body)),
  );

  // ---- Global settings ---------------------------------------------------
  registerListDelete(server, {
    entity: "global_setting",
    collection: "global-settings",
    label: "global settings",
  });

  server.registerTool(
    "create_global_setting",
    {
      title: "Create the brand's global settings",
      description:
        "Creates the site-wide settings record: robots.txt / llms.txt content, canonical site " +
        "URL, brand code/name, header & footer scripts, favicon, feature flags, plus the " +
        "first-language contact/social block. A brand usually has exactly one — prefer " +
        "update_global_setting if one already exists. Requires login and a write-enabled brand.",
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
        is_active: z.boolean().optional(),
        language_id: z.number().int(),
        address: z.string(),
        phone_number: z.string(),
        cta_text: z.string(),
        cta_url: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, language_id, address, phone_number, cta_text, cta_url, ...rest }) =>
      guard(() =>
        createEntity(project, "/admin/global-settings", {
          ...rest,
          translation: { language_id, address, phone_number, cta_text, cta_url },
        }),
      ),
  );

  server.registerTool(
    "update_global_setting",
    {
      title: "Update the brand's global settings",
      description:
        "Edits the site-wide settings (robots/llms.txt, site URL, scripts, favicon, flags). Pass " +
        "only what changes; the contact/social text is per-language — use the translate tools. " +
        "Requires login and a write-enabled brand.",
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
        popup_enabled: z.boolean().optional(),
        is_active: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, setting_id, ...body }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        await put(project, `/admin/global-settings/${setting_id}`, body);
        return ok({ project, setting_id, updated: true });
      }),
  );
}
