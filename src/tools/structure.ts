/**
 * Editing a component after it exists.
 *
 * `components.ts` can create a hero, a slider or a package and delete it
 * whole. Everything between those two points lived only in the admin panel
 * until now: changing a hero's style, reordering a slide, fixing one price
 * row, adding a feature bullet. An agent that could only create and delete had
 * exactly one way to change a typo in a slide — rebuild the slider and lose
 * every other language's translation with it.
 *
 * The admin API is regular here: a parent row, child collections hung off it,
 * and per-language translations on both. Each child collection gets the same
 * three tools (create / update / delete), and each write runs through
 * `registerWrite`, so the write gate and the dropdown validation are applied
 * the same way everywhere.
 *
 * Two shapes recur and are worth knowing before reading further:
 *   · create takes the first language inline as `translation` or as flat
 *     fields with a `language_id`; further languages go through the translate_*
 *     tools or the *_translation tools here.
 *   · update splits in two: the row's own non-translated fields go at the top
 *     level, and text for one language goes in `translation_update`, which
 *     always carries its own `language_id`.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import {
  ok,
  guard,
  projectParam,
  registerWrite,
  ensureVocabulary,
  type WriteArgs,
} from "./helpers.js";
import { checkCurrency, ensureFormats } from "../lib/field-formats.js";

const languageId = z
  .number()
  .int()
  .describe("Numeric language id — call list_languages, not a language code.");

const sortOrder = z.number().int().min(0).optional().describe("Lower sorts first.");

/** Fold the flat `*_text` / `language_id` args into the API's patch object. */
function translationUpdate(
  args: WriteArgs,
  fields: string[],
): Record<string, unknown> | undefined {
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    if (args[field] !== undefined) patch[field] = args[field];
  }
  if (Object.keys(patch).length === 0) return undefined;
  if (args.language_id === undefined) {
    throw new Error(
      "Changing text needs language_id — the API patches exactly one language at a time.",
    );
  }
  return { language_id: args.language_id, ...patch };
}

export function registerStructureTools(server: McpServer): void {
  // ---- Reading one component in full -------------------------------------
  const COMPONENT_COLLECTIONS = {
    hero: "heroes",
    slider: "sliders",
    process: "processes",
    package: "packages",
    price_compare: "price-compares",
    promotional_landing: "promotional-landings",
    before_after: "before-afters",
    google_map_section: "google-map-sections",
    global_setting: "global-settings",
    header: "headers",
    footer: "footers",
    multi_page_form: "multi-page-form",
  } as const;

  server.registerTool(
    "get_component",
    {
      title: "Read one component in full",
      description:
        "Returns a single component with every child row and every language, which is what " +
        "you need before editing one: the list tools compact nested arrays down to a count, " +
        "so they never show you a slide's id or a country row's price. Use this to find the " +
        "child id the update and delete tools ask for. Requires login.",
      inputSchema: {
        project: projectParam,
        component: z.enum(
          Object.keys(COMPONENT_COLLECTIONS) as [string, ...string[]],
        ).describe("Which kind of component."),
        component_id: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, component, component_id }) =>
      guard(async () => {
        const collection =
          COMPONENT_COLLECTIONS[component as keyof typeof COMPONENT_COLLECTIONS];
        const response = await get<Envelope<unknown>>(
          project,
          `/admin/${collection}/${component_id}`,
        );
        return ok({ project, component, data: response.data });
      }),
  );

  // ---- Hero ---------------------------------------------------------------
  registerWrite(server, {
    name: "update_hero",
    title: "Update a hero banner",
    description:
      "Edits a hero's style and background images. Pass only what changes. Text is " +
      "per-language — use update_hero_translation or the translate tools.",
    params: {
      hero_id: z.number().int(),
      style: z.string().optional().describe("default | cinematic | editorial | premium."),
      background_image_id: z.number().int().optional(),
      mobile_background_image_id: z.number().int().optional(),
    },
    method: "put",
    path: (a) => `/admin/heroes/${a.hero_id}`,
    body: (a) => ({
      style: a.style,
      background_image_id: a.background_image_id,
      mobile_background_image_id: a.mobile_background_image_id,
    }),
    checks: (a) => ensureVocabulary([["hero_style", a.style]]),
    echo: ["hero_id"],
  });

  registerWrite(server, {
    name: "update_hero_translation",
    title: "Update a hero's text in one language",
    description: "Rewrites the headline, subtitle and button for a single language.",
    params: {
      hero_id: z.number().int(),
      language_id: languageId,
      clinic_rank: z.string().optional().describe("e.g. 'No.1 Hair Clinic'."),
      title: z.string().optional(),
      subtitle: z.string().optional(),
      button_text: z.string().optional(),
      button_url: z
        .string()
        .optional()
        .describe("Honours the reserved link values — see get_link_conventions."),
      motion_text: z.string().optional(),
    },
    method: "put",
    path: (a) => `/admin/heroes/${a.hero_id}/translations/${a.language_id}`,
    body: (a) => ({
      clinic_rank: a.clinic_rank,
      title: a.title,
      subtitle: a.subtitle,
      button_text: a.button_text,
      button_url: a.button_url,
      motion_text: a.motion_text,
    }),
    echo: ["hero_id", "language_id"],
  });

  registerWrite(server, {
    name: "create_hero_feature",
    title: "Add a feature card to a hero",
    description:
      "Adds one of the small cards that sit under a hero's headline, with its first-language " +
      "text. Add the other languages with create_hero_feature_translation.",
    params: {
      hero_id: z.number().int(),
      language_id: languageId,
      title: z.string(),
      description: z.string().optional(),
      url: z
        .string()
        .optional()
        .describe("Runs through the link dispatcher — see get_link_conventions."),
      image_id: z.number().int().optional(),
      sort_order: sortOrder,
    },
    method: "post",
    path: (a) => `/admin/heroes/${a.hero_id}/features`,
    body: (a) => ({
      image_id: a.image_id,
      sort_order: a.sort_order,
      translation: {
        language_id: a.language_id,
        title: a.title,
        description: a.description,
        url: a.url,
      },
    }),
    echo: ["hero_id"],
  });

  registerWrite(server, {
    name: "update_hero_feature",
    title: "Update a hero feature card",
    description: "Changes a feature card's image or position. Text goes through its translation.",
    params: {
      feature_id: z.number().int(),
      image_id: z.number().int().optional(),
      sort_order: sortOrder,
    },
    method: "put",
    path: (a) => `/admin/heroes/features/${a.feature_id}`,
    body: (a) => ({ image_id: a.image_id, sort_order: a.sort_order }),
    echo: ["feature_id"],
  });

  registerWrite(server, {
    name: "update_hero_feature_translation",
    title: "Update a hero feature card's text",
    description: "Rewrites one language of a hero feature card.",
    params: {
      feature_id: z.number().int(),
      language_id: languageId,
      title: z.string().optional(),
      description: z.string().optional(),
      url: z.string().optional(),
      image_id: z.number().int().optional(),
    },
    method: "put",
    path: (a) => `/admin/heroes/features/${a.feature_id}/translations/${a.language_id}`,
    body: (a) => ({
      title: a.title,
      description: a.description,
      url: a.url,
      image_id: a.image_id,
    }),
    echo: ["feature_id", "language_id"],
  });

  registerWrite(server, {
    name: "delete_hero_feature",
    title: "Delete a hero feature card",
    description: "Removes one feature card from a hero, in every language.",
    params: { feature_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/heroes/features/${a.feature_id}`,
    destructive: true,
    echo: ["feature_id"],
  });

  // ---- Slider -------------------------------------------------------------
  registerWrite(server, {
    name: "update_slider",
    title: "Update a slider",
    description:
      "Changes a slider's name or layout style. Setting the style matters: with none, the " +
      "site guesses from the slides and drops the timeline half of a mixed slider.",
    params: {
      slider_id: z.number().int(),
      name: z.string().optional(),
      style: z.string().optional().describe("Timeline | Showcase — capitalised."),
    },
    method: "put",
    path: (a) => `/admin/sliders/${a.slider_id}`,
    body: (a) => ({ name: a.name, style: a.style }),
    checks: (a) => ensureVocabulary([["slider_style", a.style]]),
    echo: ["slider_id"],
  });

  registerWrite(server, {
    name: "create_slide",
    title: "Add a slide to a slider",
    description:
      "Appends one slide with its first-language text. The slide's own type decides which " +
      "layout picks it up when the slider has no style of its own.",
    params: {
      slider_id: z.number().int(),
      type: z.string().describe("timeline | showcase | image."),
      language_id: languageId,
      title: z.string(),
      subtitle: z.string().optional(),
      description: z.string().optional(),
      cta_text: z.string().optional(),
      cta_url: z.string().optional(),
      order: sortOrder,
    },
    method: "post",
    path: (a) => `/admin/sliders/${a.slider_id}/slides`,
    body: (a) => ({
      type: a.type,
      order: a.order,
      translation: {
        language_id: a.language_id,
        title: a.title,
        subtitle: a.subtitle,
        description: a.description,
        cta_text: a.cta_text,
        cta_url: a.cta_url,
      },
    }),
    checks: (a) => ensureVocabulary([["slide_type", a.type]]),
    echo: ["slider_id"],
  });

  registerWrite(server, {
    name: "update_slide",
    title: "Replace a slide",
    description:
      "Rewrites the whole slide row. The API demands `type` and one language's text on every " +
      "call, so this is a replace, not a patch — sending it without the title you already " +
      "have overwrites it. To change wording only, use update_slide_translation instead.",
    params: {
      slide_id: z.number().int(),
      type: z.string().describe("timeline | showcase | image. Required by the API."),
      language_id: languageId,
      title: z.string().describe("Required by the API — pass the current title if unchanged."),
      subtitle: z.string().optional(),
      description: z.string().optional(),
      cta_text: z.string().optional(),
      cta_url: z.string().optional(),
      order: sortOrder,
    },
    method: "put",
    path: (a) => `/admin/sliders/slides/${a.slide_id}`,
    body: (a) => ({
      type: a.type,
      order: a.order,
      translation: {
        language_id: a.language_id,
        title: a.title,
        subtitle: a.subtitle,
        description: a.description,
        cta_text: a.cta_text,
        cta_url: a.cta_url,
      },
    }),
    checks: (a) => ensureVocabulary([["slide_type", a.type]]),
    echo: ["slide_id"],
  });

  registerWrite(server, {
    name: "update_slide_translation",
    title: "Update a slide's text",
    description: "Rewrites one language of a slide.",
    params: {
      slide_id: z.number().int(),
      language_id: languageId,
      title: z.string().optional(),
      subtitle: z.string().optional(),
      description: z.string().optional(),
      cta_text: z.string().optional(),
      cta_url: z.string().optional(),
    },
    method: "put",
    path: (a) => `/admin/sliders/slides/${a.slide_id}/translations/${a.language_id}`,
    body: (a) => ({
      title: a.title,
      subtitle: a.subtitle,
      description: a.description,
      cta_text: a.cta_text,
      cta_url: a.cta_url,
    }),
    echo: ["slide_id", "language_id"],
  });

  registerWrite(server, {
    name: "delete_slide",
    title: "Delete a slide",
    description: "Removes one slide from its slider, in every language.",
    params: { slide_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/sliders/slides/${a.slide_id}`,
    destructive: true,
    echo: ["slide_id"],
  });

  registerWrite(server, {
    name: "create_slide_feature",
    title: "Add a stat to a slide",
    description:
      "Adds one of the numbered stats a slide can carry (e.g. '15.000 grafts'), with its " +
      "first-language wording.",
    params: {
      slide_id: z.number().int(),
      language_id: languageId,
      title: z.string(),
      description: z.string().optional(),
      unit_name: z.string().optional(),
      unit_number: z.number().int().optional(),
      unit_label: z.string().optional(),
      image_id: z.number().int().optional(),
      order: sortOrder,
    },
    method: "post",
    path: (a) => `/admin/sliders/slides/${a.slide_id}/features`,
    body: (a) => ({
      image_id: a.image_id,
      order: a.order,
      translation: {
        language_id: a.language_id,
        title: a.title,
        description: a.description,
        unit_name: a.unit_name,
        unit_number: a.unit_number,
        unit_label: a.unit_label,
      },
    }),
    echo: ["slide_id"],
  });

  registerWrite(server, {
    name: "update_slide_feature",
    title: "Replace a slide stat",
    description:
      "Rewrites the whole stat row. Like update_slide, the API demands one language's text " +
      "on every call, so pass the current title even when only the image changes. For " +
      "wording alone use update_slide_feature_translation.",
    params: {
      feature_id: z.number().int(),
      language_id: languageId,
      title: z.string().describe("Required by the API — pass the current title if unchanged."),
      description: z.string().optional(),
      unit_name: z.string().optional(),
      unit_number: z.number().int().optional(),
      unit_label: z.string().optional(),
      image_id: z.number().int().optional(),
      order: sortOrder,
    },
    method: "put",
    path: (a) => `/admin/sliders/features/${a.feature_id}`,
    body: (a) => ({
      image_id: a.image_id,
      order: a.order,
      translation: {
        language_id: a.language_id,
        title: a.title,
        description: a.description,
        unit_name: a.unit_name,
        unit_number: a.unit_number,
        unit_label: a.unit_label,
      },
    }),
    echo: ["feature_id"],
  });

  registerWrite(server, {
    name: "update_slide_feature_translation",
    title: "Update a slide stat's text",
    description: "Rewrites one language of a stat, leaving its image and position alone.",
    params: {
      feature_id: z.number().int(),
      language_id: languageId,
      title: z.string().optional(),
      description: z.string().optional(),
      unit_name: z.string().optional(),
      unit_number: z.number().int().optional(),
      unit_label: z.string().optional(),
    },
    method: "put",
    path: (a) => `/admin/sliders/features/${a.feature_id}/translations/${a.language_id}`,
    body: (a) => ({
      title: a.title,
      description: a.description,
      unit_name: a.unit_name,
      unit_number: a.unit_number,
      unit_label: a.unit_label,
    }),
    echo: ["feature_id", "language_id"],
  });

  registerWrite(server, {
    name: "delete_slide_feature",
    title: "Delete a slide stat",
    description: "Removes one stat from a slide.",
    params: { feature_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/sliders/features/${a.feature_id}`,
    destructive: true,
    echo: ["feature_id"],
  });

  // ---- Process ------------------------------------------------------------
  registerWrite(server, {
    name: "update_process",
    title: "Update a process section",
    description: "Changes a process block's image or position. Text is per-language.",
    params: {
      process_id: z.number().int(),
      sort_order: sortOrder,
      image_id: z.number().int().optional(),
    },
    method: "put",
    path: (a) => `/admin/processes/${a.process_id}`,
    body: (a) => ({ sort_order: a.sort_order, image_id: a.image_id }),
    echo: ["process_id"],
  });

  registerWrite(server, {
    name: "update_process_translation",
    title: "Update a process section's text",
    description: "Rewrites one language of a process block's heading and button.",
    params: {
      process_id: z.number().int(),
      language_id: languageId,
      title: z.string().optional(),
      description: z.string().optional(),
      button_text: z.string().optional(),
      button_url: z.string().optional(),
    },
    method: "put",
    path: (a) => `/admin/processes/${a.process_id}/translations/${a.language_id}`,
    body: (a) => ({
      title: a.title,
      description: a.description,
      button_text: a.button_text,
      button_url: a.button_url,
    }),
    echo: ["process_id", "language_id"],
  });

  registerWrite(server, {
    name: "create_process_step",
    title: "Add a step to a process section",
    description:
      "Adds a numbered step. The step row itself carries only its number and position — " +
      "follow this with create_process_step_translation for the wording, or the step renders " +
      "blank.",
    params: {
      process_id: z.number().int(),
      step_number: z.number().int().min(1),
      sort_order: sortOrder,
    },
    method: "post",
    path: (a) => `/admin/processes/${a.process_id}/steps`,
    body: (a) => ({ step_number: a.step_number, sort_order: a.sort_order }),
    echo: ["process_id"],
  });

  registerWrite(server, {
    name: "create_process_step_translation",
    title: "Write a process step's text",
    description: "Adds one language's wording to a step.",
    params: {
      step_id: z.number().int(),
      language_id: languageId,
      title: z.string(),
      description: z.string().optional(),
      icon: z.string().optional().describe("An Iconify name, e.g. 'solar:stethoscope-outline'."),
    },
    method: "post",
    path: (a) => `/admin/processes/steps/${a.step_id}/translations`,
    body: (a) => ({
      language_id: a.language_id,
      title: a.title,
      description: a.description,
      icon: a.icon,
    }),
    echo: ["step_id"],
  });

  registerWrite(server, {
    name: "update_process_step_translation",
    title: "Update a process step's text",
    description: "Rewrites one language of a step.",
    params: {
      step_id: z.number().int(),
      language_id: languageId,
      title: z.string().optional(),
      description: z.string().optional(),
      icon: z.string().optional(),
    },
    method: "put",
    path: (a) => `/admin/processes/steps/${a.step_id}/translations/${a.language_id}`,
    body: (a) => ({ title: a.title, description: a.description, icon: a.icon }),
    echo: ["step_id", "language_id"],
  });

  registerWrite(server, {
    name: "update_process_step",
    title: "Update a process step",
    description: "Changes a step's number or position.",
    params: {
      step_id: z.number().int(),
      step_number: z.number().int().min(1).optional(),
      sort_order: sortOrder,
    },
    method: "put",
    path: (a) => `/admin/processes/steps/${a.step_id}`,
    body: (a) => ({ step_number: a.step_number, sort_order: a.sort_order }),
    echo: ["step_id"],
  });

  registerWrite(server, {
    name: "delete_process_step",
    title: "Delete a process step",
    description: "Removes one step, in every language.",
    params: { step_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/processes/steps/${a.step_id}`,
    destructive: true,
    echo: ["step_id"],
  });

  // ---- Price compare ------------------------------------------------------
  registerWrite(server, {
    name: "update_price_compare",
    title: "Update a price-comparison section",
    description:
      "Changes the block's position, background, or its headings in ONE language " +
      "(pass language_id with any text field).",
    params: {
      price_compare_id: z.number().int(),
      sort_order: sortOrder,
      background_image_id: z.number().int().optional(),
      language_id: z.number().int().optional().describe("Required when changing any text."),
      main_title: z.string().optional(),
      bottom_title: z.string().optional(),
      description: z.string().optional(),
    },
    method: "put",
    path: (a) => `/admin/price-compares/${a.price_compare_id}`,
    body: (a) => ({
      sort_order: a.sort_order,
      background_image_id: a.background_image_id,
      translation_update: translationUpdate(a, ["main_title", "bottom_title", "description"]),
    }),
    echo: ["price_compare_id"],
  });

  registerWrite(server, {
    name: "create_price_compare_country",
    title: "Add a country row to a price comparison",
    description:
      "Adds one country's price band to the comparison table, with its name in the first " +
      "language.",
    params: {
      price_compare_id: z.number().int(),
      language_id: languageId,
      country_name: z.string(),
      price_min: z.number().optional(),
      price_max: z.number().optional(),
      currency: z.string().optional().describe("ISO-4217, e.g. EUR."),
      percentage: z.number().int().min(0).max(100).optional(),
      is_highlighted: z.boolean().optional().describe("Marks this row as the clinic's own."),
      logo_id: z.number().int().optional().describe("Flag image."),
      sort_order: sortOrder,
    },
    method: "post",
    path: (a) => `/admin/price-compares/${a.price_compare_id}/countries`,
    body: (a) => ({
      language_id: a.language_id,
      country_name: a.country_name,
      price_min: a.price_min,
      price_max: a.price_max,
      currency: a.currency,
      percentage: a.percentage,
      is_highlighted: a.is_highlighted,
      logo_id: a.logo_id,
      sort_order: a.sort_order,
    }),
    checks: (a) => ensureFormats([checkCurrency(a.currency)]),
    echo: ["price_compare_id"],
  });

  registerWrite(server, {
    name: "update_price_compare_country",
    title: "Update a country row",
    description:
      "Changes one country's prices, flag or highlight, and optionally its name in one " +
      "language (pass language_id with country_name).",
    params: {
      country_id: z.number().int(),
      price_min: z.number().optional(),
      price_max: z.number().optional(),
      currency: z.string().optional(),
      percentage: z.number().int().min(0).max(100).optional(),
      is_highlighted: z.boolean().optional(),
      logo_id: z.number().int().optional(),
      sort_order: sortOrder,
      language_id: z.number().int().optional(),
      country_name: z.string().optional(),
    },
    method: "put",
    path: (a) => `/admin/price-compares/countries/${a.country_id}`,
    body: (a) => ({
      price_min: a.price_min,
      price_max: a.price_max,
      currency: a.currency,
      percentage: a.percentage,
      is_highlighted: a.is_highlighted,
      logo_id: a.logo_id,
      sort_order: a.sort_order,
      translation_update: translationUpdate(a, ["country_name"]),
    }),
    checks: (a) => ensureFormats([checkCurrency(a.currency)]),
    echo: ["country_id"],
  });

  registerWrite(server, {
    name: "delete_price_compare_country",
    title: "Delete a country row",
    description: "Removes one country from the comparison table.",
    params: { country_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/price-compares/countries/${a.country_id}`,
    destructive: true,
    echo: ["country_id"],
  });

  // ---- Promotional landing ------------------------------------------------
  registerWrite(server, {
    name: "update_promotional_landing",
    title: "Update a promotional landing block",
    description:
      "Changes the block's media and position, or its text in ONE language (pass language_id " +
      "with any text field).",
    params: {
      promotional_landing_id: z.number().int(),
      sort_order: sortOrder,
      background_image_id: z.number().int().optional(),
      video_id: z.number().int().optional(),
      gallery_ids: z.array(z.number().int()).optional().describe("Replaces the gallery wholesale."),
      language_id: z.number().int().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      read_more_text: z.string().optional(),
      read_more_url: z.string().optional(),
      contact_text: z.string().optional(),
      contact_url: z.string().optional(),
    },
    method: "put",
    path: (a) => `/admin/promotional-landings/${a.promotional_landing_id}`,
    body: (a) => ({
      sort_order: a.sort_order,
      background_image_id: a.background_image_id,
      video_id: a.video_id,
      gallery_ids: a.gallery_ids,
      translation_update: translationUpdate(a, [
        "title",
        "description",
        "read_more_text",
        "read_more_url",
        "contact_text",
        "contact_url",
      ]),
    }),
    echo: ["promotional_landing_id"],
  });

  registerWrite(server, {
    name: "create_promo_feature",
    title: "Add a bullet to a promotional landing block",
    description: "Adds one icon + line of text to the block's feature list.",
    params: {
      promotional_landing_id: z.number().int(),
      language_id: languageId,
      text: z.string(),
      icon: z.string().optional().describe("An Iconify name."),
      sort_order: sortOrder,
    },
    method: "post",
    path: (a) => `/admin/promotional-landings/${a.promotional_landing_id}/features`,
    body: (a) => ({
      language_id: a.language_id,
      text: a.text,
      icon: a.icon,
      sort_order: a.sort_order,
    }),
    echo: ["promotional_landing_id"],
  });

  registerWrite(server, {
    name: "update_promo_feature",
    title: "Update a promotional bullet",
    description: "Changes a bullet's icon or position, and its text in one language.",
    params: {
      feature_id: z.number().int(),
      icon: z.string().optional(),
      sort_order: sortOrder,
      language_id: z.number().int().optional(),
      text: z.string().optional(),
    },
    method: "put",
    path: (a) => `/admin/promotional-landings/features/${a.feature_id}`,
    body: (a) => ({
      icon: a.icon,
      sort_order: a.sort_order,
      translation_update: translationUpdate(a, ["text"]),
    }),
    echo: ["feature_id"],
  });

  registerWrite(server, {
    name: "delete_promo_feature",
    title: "Delete a promotional bullet",
    description: "Removes one bullet, in every language.",
    params: { feature_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/promotional-landings/features/${a.feature_id}`,
    destructive: true,
    echo: ["feature_id"],
  });

  // ---- Before/after -------------------------------------------------------
  registerWrite(server, {
    name: "update_before_after",
    title: "Update a before/after gallery",
    description:
      "Changes the gallery's layout style and position, or its heading in one language. " +
      "Remember that every style_4 record on a page merges into a single filterable gallery.",
    params: {
      before_after_id: z.number().int(),
      style: z.string().optional().describe("style_1 … style_4."),
      sort_order: sortOrder,
      language_id: z.number().int().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
    },
    method: "put",
    path: (a) => `/admin/before-afters/${a.before_after_id}`,
    body: (a) => ({
      style: a.style,
      sort_order: a.sort_order,
      translation_update: translationUpdate(a, ["title", "description"]),
    }),
    checks: (a) => ensureVocabulary([["before_after_style", a.style]]),
    echo: ["before_after_id"],
  });

  registerWrite(server, {
    name: "create_gallery_item",
    title: "Add a before/after pair",
    description:
      "Adds one patient's before and after images. The four descriptive fields are the " +
      "filter chips on the style_4 gallery, so spell them exactly as the existing rows do — " +
      "'Female' and 'female' become two separate filters.",
    params: {
      before_after_id: z.number().int(),
      before_media_id: z.number().int().optional(),
      after_media_id: z.number().int().optional(),
      sex: z.string().optional(),
      technique: z.string().optional(),
      graft: z.string().optional(),
      age: z.string().optional(),
      sort_order: sortOrder,
    },
    method: "post",
    path: (a) => `/admin/before-afters/${a.before_after_id}/gallery-items`,
    body: (a) => ({
      before_media_id: a.before_media_id,
      after_media_id: a.after_media_id,
      sex: a.sex,
      technique: a.technique,
      graft: a.graft,
      age: a.age,
      sort_order: a.sort_order,
    }),
    echo: ["before_after_id"],
  });

  registerWrite(server, {
    name: "update_gallery_item",
    title: "Update a before/after pair",
    description: "Changes one pair's images, filter labels or position.",
    params: {
      gallery_item_id: z.number().int(),
      before_media_id: z.number().int().optional(),
      after_media_id: z.number().int().optional(),
      sex: z.string().optional(),
      technique: z.string().optional(),
      graft: z.string().optional(),
      age: z.string().optional(),
      sort_order: sortOrder,
    },
    method: "put",
    path: (a) => `/admin/before-afters/gallery-items/${a.gallery_item_id}`,
    body: (a) => ({
      before_media_id: a.before_media_id,
      after_media_id: a.after_media_id,
      sex: a.sex,
      technique: a.technique,
      graft: a.graft,
      age: a.age,
      sort_order: a.sort_order,
    }),
    echo: ["gallery_item_id"],
  });

  registerWrite(server, {
    name: "delete_gallery_item",
    title: "Delete a before/after pair",
    description: "Removes one pair from the gallery.",
    params: { gallery_item_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/before-afters/gallery-items/${a.gallery_item_id}`,
    destructive: true,
    echo: ["gallery_item_id"],
  });

  // ---- Package sections and offers ---------------------------------------
  registerWrite(server, {
    name: "create_package_section",
    title: "Add a tier to a package",
    description:
      "Adds one priced tier (a column in the pricing table) with its first-language text. " +
      "Its bullet list goes in afterwards with create_offer.",
    params: {
      package_id: z.number().int(),
      language_id: languageId,
      title: z.string(),
      summary_text: z.string().optional(),
      call_to_action_text: z.string().optional(),
      button_url: z
        .string()
        .optional()
        .describe("Honours the reserved link values — see get_link_conventions."),
      price: z.number().optional(),
      currency: z.string().optional().describe("ISO-4217, e.g. EUR."),
      is_recommended: z.boolean().optional(),
      order: sortOrder,
    },
    method: "post",
    path: (a) => `/admin/packages/${a.package_id}/sections`,
    body: (a) => ({
      order: a.order,
      is_recommended: a.is_recommended,
      translation: {
        language_id: a.language_id,
        title: a.title,
        summary_text: a.summary_text,
        call_to_action_text: a.call_to_action_text,
        button_url: a.button_url,
        price: a.price,
        currency: a.currency,
      },
    }),
    checks: (a) => ensureFormats([checkCurrency(a.currency)]),
    echo: ["package_id"],
  });

  registerWrite(server, {
    name: "update_package_section",
    title: "Update a package tier",
    description: "Changes a tier's position or its 'recommended' badge. Text is per-language.",
    params: {
      section_id: z.number().int(),
      order: sortOrder,
      is_recommended: z.boolean().optional(),
    },
    method: "put",
    path: (a) => `/admin/packages/sections/${a.section_id}`,
    body: (a) => ({ order: a.order, is_recommended: a.is_recommended }),
    echo: ["section_id"],
  });

  registerWrite(server, {
    name: "update_package_section_translation",
    title: "Update a package tier's text and price",
    description:
      "Rewrites one language of a tier, including its price and currency — those live on the " +
      "translation, so a price set in English is not the price shown in Italian.",
    params: {
      section_id: z.number().int(),
      language_id: languageId,
      title: z.string().optional(),
      summary_text: z.string().optional(),
      call_to_action_text: z.string().optional(),
      button_url: z.string().optional(),
      price: z.number().optional(),
      currency: z.string().optional(),
    },
    method: "put",
    path: (a) => `/admin/packages/sections/${a.section_id}/translations/${a.language_id}`,
    body: (a) => ({
      title: a.title,
      summary_text: a.summary_text,
      call_to_action_text: a.call_to_action_text,
      button_url: a.button_url,
      price: a.price,
      currency: a.currency,
    }),
    checks: (a) => ensureFormats([checkCurrency(a.currency)]),
    echo: ["section_id", "language_id"],
  });

  registerWrite(server, {
    name: "delete_package_section",
    title: "Delete a package tier",
    description: "Removes one tier and every offer under it.",
    params: { section_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/packages/sections/${a.section_id}`,
    destructive: true,
    echo: ["section_id"],
  });

  registerWrite(server, {
    name: "create_offer",
    title: "Add a line to a package tier",
    description: "Adds one bullet — what the tier includes — with its first-language wording.",
    params: {
      section_id: z.number().int(),
      language_id: languageId,
      title: z.string(),
      description: z.string().optional(),
      order: sortOrder,
    },
    method: "post",
    path: (a) => `/admin/packages/sections/${a.section_id}/offers`,
    body: (a) => ({
      order: a.order,
      translation: {
        language_id: a.language_id,
        title: a.title,
        description: a.description,
      },
    }),
    echo: ["section_id"],
  });

  registerWrite(server, {
    name: "update_offer_translation",
    title: "Update a package line's text",
    description: "Rewrites one language of an offer bullet.",
    params: {
      offer_id: z.number().int(),
      language_id: languageId,
      title: z.string().optional(),
      description: z.string().optional(),
    },
    method: "put",
    path: (a) => `/admin/packages/offers/${a.offer_id}/translations/${a.language_id}`,
    body: (a) => ({ title: a.title, description: a.description }),
    echo: ["offer_id", "language_id"],
  });

  registerWrite(server, {
    name: "update_offer",
    title: "Reorder a package line",
    description: "Changes an offer bullet's position within its tier.",
    params: { offer_id: z.number().int(), order: sortOrder },
    method: "put",
    path: (a) => `/admin/packages/offers/${a.offer_id}`,
    body: (a) => ({ order: a.order }),
    echo: ["offer_id"],
  });

  registerWrite(server, {
    name: "delete_offer",
    title: "Delete a package line",
    description: "Removes one offer bullet, in every language.",
    params: { offer_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/packages/offers/${a.offer_id}`,
    destructive: true,
    echo: ["offer_id"],
  });

  // ---- Links (the reusable CTA buttons) -----------------------------------
  server.registerTool(
    "list_links",
    {
      title: "List the brand's CTA links",
      description:
        "The reusable call-to-action buttons — the phone, WhatsApp and consultation buttons " +
        "that other blocks point at. Each carries its label and destination per language. " +
        "Requires login.",
      inputSchema: {
        project: projectParam,
        limit: z.number().int().min(1).max(200).default(50),
        page: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, ...query }) =>
      guard(async () => {
        const response = await get<Envelope<unknown>>(project, "/admin/links", query);
        return ok({ project, data: response.data });
      }),
  );

  const linkTranslations = z
    .array(
      z.object({
        language_id: z.number().int(),
        button_text: z.string(),
        button_url: z.string(),
      }),
    )
    .describe(
      "One entry per language. button_url honours the reserved values (cta_url, " +
        "modal-dialog-*, #) — call get_link_conventions before inventing a path.",
    );

  registerWrite(server, {
    name: "create_link",
    title: "Create a CTA link",
    description:
      "Creates a reusable call-to-action button with its label and destination in each " +
      "language given.",
    params: {
      size: z.string().optional().describe("small | large."),
      icon: z
        .string()
        .optional()
        .describe(
          "One of the site's own icon codes (phone, whatsapp, envelope, …) — NOT an Iconify " +
            "name. Anything else renders no icon at all.",
        ),
      is_active: z.boolean().optional(),
      sort_order: sortOrder,
      translations: linkTranslations,
    },
    method: "post",
    path: () => "/admin/links",
    body: (a) => ({
      size: a.size,
      icon: a.icon,
      is_active: a.is_active,
      sort_order: a.sort_order,
      translations: a.translations,
    }),
    checks: (a) =>
      ensureVocabulary([
        ["link_size", a.size],
        ["link_icon", a.icon],
      ]),
  });

  registerWrite(server, {
    name: "update_link",
    title: "Update a CTA link",
    description:
      "Edits a CTA button. Careful with `translations`: sending it REPLACES the whole set, " +
      "so a language you leave out is deleted. Omit it to touch only the icon, size or order.",
    params: {
      link_id: z.number().int(),
      size: z.string().optional(),
      icon: z.string().optional(),
      is_active: z.boolean().optional(),
      sort_order: sortOrder,
      translations: linkTranslations.optional(),
    },
    method: "put",
    path: (a) => `/admin/links/${a.link_id}`,
    body: (a) => ({
      size: a.size,
      icon: a.icon,
      is_active: a.is_active,
      sort_order: a.sort_order,
      translations: a.translations,
    }),
    checks: (a) =>
      ensureVocabulary([
        ["link_size", a.size],
        ["link_icon", a.icon],
      ]),
    echo: ["link_id"],
  });

  registerWrite(server, {
    name: "delete_link",
    title: "Delete a CTA link",
    description:
      "Removes a CTA button. Blocks that referenced it lose their button with no error.",
    params: { link_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/links/${a.link_id}`,
    destructive: true,
    echo: ["link_id"],
  });
}
