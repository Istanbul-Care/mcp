/**
 * Every place in the admin API where content carries a per-language row.
 *
 * There are two very different kinds of surface here:
 *
 *   - `llm` surfaces (post / service / page) have a backend endpoint that runs
 *     a DeepSeek translation server-side. We just start the job and poll.
 *   - everything else has translation CRUD only. Nothing translates those for
 *     us, so the agent holding this MCP session is the translator: it pulls the
 *     source strings (`translation_worklist`) and writes back its own rendering
 *     (`save_translations`).
 *
 * The registry is what makes "translate everywhere" a data problem rather than
 * 30 hand-written tools. `scripts/check-translatable.mjs` diffs it against the
 * backend's OpenAPI spec so drift shows up as a failing check, not as a silent
 * gap in a sweep.
 */

/**
 * How a field survives translation.
 *
 * `verbatim` is not "skip" — the value is copied from the source translation
 * into the new row, because several of these columns are required by the
 * create endpoint (a package section's `price` / `currency`, a process step's
 * `icon`) and would otherwise come back null.
 */
export type FieldKind = "text" | "html" | "slug" | "url" | "verbatim";

export interface TranslatableField {
  name: string;
  kind: FieldKind;
  /** For `slug`: the field whose translated value the slug is derived from. */
  from?: string;
  /** Soft cap the backend enforces on SEO fields. */
  maxLength?: number;
}

/**
 * How to enumerate the rows of a surface.
 *
 * Nine surfaces have no list endpoint of their own — a slider's slides, a
 * package's sections, a hero's features. For those, `child` is a dotted path
 * walked down from each row of the parent list.
 */
export interface SurfaceSource {
  /** Admin list endpoint, relative to the brand's `/v1` base. */
  path: string;
  /** Key of the row array inside the response envelope's `data`. */
  key: string;
  /** Dotted path from a parent row down to the rows we translate. */
  child?: string;
  /** Header items only: each parent row must be re-fetched in full first. */
  detailPath?: string;
  /** Header items only: children nest into themselves under this key. */
  recurse?: string;
}

export type TranslationWrite =
  | {
      /** The common shape: POST to create a language row, PUT to update it. */
      mode: "endpoint";
      /** `{id}` is substituted with the row id. */
      create: string;
      /**
       * `{id}` and `{language}` are substituted. Omit when the entity has no
       * per-language PUT and its POST upserts instead (media alt works this way).
       */
      update?: string;
      /** Which identifier the row is keyed by in the payload. */
      key: "language_id" | "language_code";
    }
  | {
      /**
       * Some entities have no /translations endpoint at all — their translations
       * live inside the row and are written by PUTting the row with the FULL set
       * of translations (languages left out are deleted). Before/after-AI steps
       * and links work this way.
       */
      mode: "embedded";
      put: string;
      key: "language_code" | "language_id";
    };

export interface TranslatableSurface {
  /** Stable id used by the tools. */
  type: string;
  label: string;
  /** Set when the backend can machine-translate this itself. */
  llm: "posts" | "services" | "pages" | null;
  source: SurfaceSource;
  write: TranslationWrite;
  fields: TranslatableField[];
  /** Field used to name the row in reports. */
  titleField: string;
}

const t = (name: string, maxLength?: number): TranslatableField =>
  maxLength === undefined ? { name, kind: "text" } : { name, kind: "text", maxLength };
const html = (name: string): TranslatableField => ({ name, kind: "html" });
const url = (name: string): TranslatableField => ({ name, kind: "url" });
const verbatim = (name: string): TranslatableField => ({ name, kind: "verbatim" });
const slug = (from: string): TranslatableField => ({ name: "slug", kind: "slug", from });

/** The SEO caps the backend's own translator applies (`auto_translate.py`). */
const META_TITLE_MAX = 60;
const META_DESCRIPTION_MAX = 160;

function endpoint(base: string): TranslationWrite {
  return {
    mode: "endpoint",
    create: `${base}/{id}/translations`,
    update: `${base}/{id}/translations/{language}`,
    key: "language_id",
  };
}

export const SURFACES: TranslatableSurface[] = [
  // --- Machine-translatable server-side ------------------------------------
  {
    type: "post",
    label: "Blog post",
    llm: "posts",
    source: { path: "/admin/posts", key: "posts" },
    write: endpoint("/admin/posts"),
    titleField: "title",
    fields: [
      t("title"),
      slug("title"),
      t("excerpt"),
      html("content"),
      t("meta_title", META_TITLE_MAX),
      t("meta_description", META_DESCRIPTION_MAX),
      t("focus_keyword"),
      t("related_description"),
      url("canonical_url"),
      verbatim("robots_index"),
      verbatim("robots_follow"),
    ],
  },
  {
    type: "service",
    label: "Service",
    llm: "services",
    source: { path: "/admin/services", key: "services" },
    write: endpoint("/admin/services"),
    titleField: "title",
    fields: [
      t("title"),
      slug("title"),
      t("excerpt"),
      t("meta_title", META_TITLE_MAX),
      t("meta_description", META_DESCRIPTION_MAX),
      t("focus_keyword"),
      url("canonical_url"),
      verbatim("robots_index"),
      verbatim("robots_follow"),
    ],
  },
  {
    type: "page",
    label: "Page",
    llm: "pages",
    source: { path: "/admin/pages", key: "pages" },
    write: endpoint("/admin/pages"),
    titleField: "title",
    fields: [
      t("title"),
      slug("title"),
      t("excerpt"),
      t("meta_title", META_TITLE_MAX),
      t("meta_description", META_DESCRIPTION_MAX),
      t("focus_keyword"),
      t("child_pages_heading"),
      url("canonical_url"),
      verbatim("robots_index"),
      verbatim("robots_follow"),
    ],
  },

  // --- Taxonomy ------------------------------------------------------------
  {
    type: "post_category",
    label: "Blog category",
    llm: null,
    source: { path: "/admin/post-categories", key: "categories" },
    write: endpoint("/admin/post-categories"),
    titleField: "name",
    fields: [t("name"), slug("name"), t("description")],
  },
  {
    type: "tag",
    label: "Blog tag",
    llm: null,
    source: { path: "/admin/tags", key: "tags" },
    write: endpoint("/admin/tags"),
    titleField: "name",
    fields: [t("name"), slug("name")],
  },
  {
    type: "service_category",
    label: "Service category",
    llm: null,
    source: { path: "/admin/service-categories", key: "categories" },
    write: endpoint("/admin/service-categories"),
    titleField: "name",
    fields: [t("name"), slug("name"), t("description")],
  },
  {
    type: "faq_category",
    label: "FAQ category",
    llm: null,
    source: { path: "/admin/faq-categories", key: "categories" },
    write: endpoint("/admin/faq-categories"),
    titleField: "name",
    fields: [t("name"), slug("name"), t("description")],
  },
  {
    type: "faq",
    label: "FAQ",
    llm: null,
    source: { path: "/admin/faqs", key: "faqs" },
    write: endpoint("/admin/faqs"),
    titleField: "question",
    fields: [t("question"), html("answer")],
  },

  // --- Page building blocks ------------------------------------------------
  {
    type: "card",
    label: "Card",
    llm: null,
    source: { path: "/admin/cards", key: "cards" },
    write: endpoint("/admin/cards"),
    titleField: "title",
    fields: [
      t("title"),
      html("description"),
      t("button_text"),
      url("button_url"),
      verbatim("button_icon"),
    ],
  },
  {
    type: "hero",
    label: "Hero",
    llm: null,
    source: { path: "/admin/heroes", key: "heroes" },
    write: endpoint("/admin/heroes"),
    titleField: "title",
    fields: [
      t("title"),
      t("subtitle"),
      t("clinic_rank"),
      t("motion_text"),
      t("button_text"),
      url("button_url"),
      // A hero's artwork is per-language (the text is burnt into some of them),
      // so the ids ride along with the translation row.
      verbatim("background_image_id"),
      verbatim("background_image_url"),
      verbatim("mobile_background_image_id"),
      verbatim("mobile_background_image_url"),
    ],
  },
  {
    type: "hero_feature",
    label: "Hero feature",
    llm: null,
    source: { path: "/admin/heroes", key: "heroes", child: "features" },
    write: endpoint("/admin/heroes/features"),
    titleField: "title",
    fields: [
      t("title"),
      t("description"),
      url("url"),
      verbatim("image_id"),
      verbatim("image_url"),
    ],
  },
  {
    type: "slider_slide",
    label: "Slider slide",
    llm: null,
    source: { path: "/admin/sliders", key: "sliders", child: "slides" },
    write: endpoint("/admin/sliders/slides"),
    titleField: "title",
    fields: [t("title"), t("subtitle"), t("description"), t("cta_text"), url("cta_url")],
  },
  {
    type: "slider_feature",
    label: "Slider feature",
    llm: null,
    source: { path: "/admin/sliders", key: "sliders", child: "slides.features" },
    write: endpoint("/admin/sliders/features"),
    titleField: "title",
    fields: [
      t("title"),
      t("description"),
      t("unit_name"),
      t("unit_label"),
      verbatim("unit_number"),
    ],
  },
  {
    type: "process",
    label: "Process",
    llm: null,
    source: { path: "/admin/processes", key: "processes" },
    write: endpoint("/admin/processes"),
    titleField: "title",
    fields: [t("title"), t("description"), t("button_text"), url("button_url")],
  },
  {
    type: "process_step",
    label: "Process step",
    llm: null,
    source: { path: "/admin/processes", key: "processes", child: "steps" },
    write: endpoint("/admin/processes/steps"),
    titleField: "title",
    fields: [t("title"), t("description"), verbatim("icon")],
  },
  {
    type: "before_after",
    label: "Before/after",
    llm: null,
    source: { path: "/admin/before-afters", key: "before_afters" },
    write: endpoint("/admin/before-afters"),
    titleField: "title",
    fields: [t("title"), t("description")],
  },
  {
    type: "package",
    label: "Package",
    llm: null,
    source: { path: "/admin/packages", key: "packages" },
    write: endpoint("/admin/packages"),
    titleField: "title",
    fields: [t("title")],
  },
  {
    type: "package_section",
    label: "Package section",
    llm: null,
    source: { path: "/admin/packages", key: "packages", child: "sections" },
    write: endpoint("/admin/packages/sections"),
    titleField: "title",
    fields: [
      t("title"),
      t("summary_text"),
      t("call_to_action_text"),
      url("button_url"),
      verbatim("price"),
      verbatim("currency"),
    ],
  },
  {
    type: "package_offer",
    label: "Package offer",
    llm: null,
    source: { path: "/admin/packages", key: "packages", child: "sections.offers" },
    write: endpoint("/admin/packages/offers"),
    titleField: "title",
    fields: [t("title"), t("description")],
  },
  {
    type: "price_compare",
    label: "Price comparison",
    llm: null,
    source: { path: "/admin/price-compares", key: "price_compares" },
    write: endpoint("/admin/price-compares"),
    titleField: "main_title",
    fields: [t("main_title"), t("bottom_title"), t("description")],
  },
  {
    type: "price_compare_country",
    label: "Price comparison country",
    llm: null,
    source: { path: "/admin/price-compares", key: "price_compares", child: "countries" },
    write: endpoint("/admin/price-compares/countries"),
    titleField: "country_name",
    fields: [t("country_name")],
  },
  {
    type: "promotional_landing",
    label: "Promotional landing",
    llm: null,
    source: { path: "/admin/promotional-landings", key: "promotional_landings" },
    write: endpoint("/admin/promotional-landings"),
    titleField: "title",
    fields: [
      t("title"),
      t("description"),
      t("read_more_text"),
      url("read_more_url"),
      t("contact_text"),
      url("contact_url"),
    ],
  },
  {
    type: "promotional_landing_feature",
    label: "Promotional landing feature",
    llm: null,
    source: {
      path: "/admin/promotional-landings",
      key: "promotional_landings",
      child: "features",
    },
    write: endpoint("/admin/promotional-landings/features"),
    titleField: "text",
    fields: [t("text")],
  },
  {
    type: "google_map_section",
    label: "Google map section",
    llm: null,
    source: { path: "/admin/google-map-sections", key: "sections" },
    write: endpoint("/admin/google-map-sections"),
    titleField: "title",
    fields: [t("title"), t("description"), t("cta_button_text"), url("cta_button_url")],
  },

  // --- Forms and chrome ----------------------------------------------------
  {
    type: "contact_form",
    label: "Contact form",
    llm: null,
    source: { path: "/admin/contact-form", key: "contact_form" },
    write: endpoint("/admin/contact-form"),
    titleField: "title",
    fields: [
      t("title"),
      t("description"),
      t("full_name_verbose_name"),
      t("email_verbose_name"),
      t("language_verbose_name"),
      t("number_verbose_name"),
      t("service_category_verbose_name"),
      t("check_box_text"),
      t("privacy_and_policy"),
      t("button_text"),
      url("button_url"),
      url("thankyou_page_url"),
    ],
  },
  {
    type: "multi_page_form",
    label: "Multi-page form",
    llm: null,
    source: { path: "/admin/multi-page-form", key: "multi_page_form" },
    write: endpoint("/admin/multi-page-form"),
    titleField: "customer_service_name",
    fields: [
      t("customer_service_name"),
      t("customer_service_status"),
      t("customer_service_description"),
      t("cta_text"),
      t("cta_button_text"),
      url("cta_button_url"),
      url("thankyou_page_url"),
      t("prev_button_text"),
      t("next_button_text"),
      verbatim("avatar_url"),
      verbatim("avatar_media_id"),
    ],
  },
  {
    type: "header_item",
    label: "Header menu item",
    llm: null,
    source: {
      path: "/admin/headers",
      key: "headers",
      detailPath: "/admin/headers/{id}",
      child: "items",
      recurse: "children",
    },
    write: {
      mode: "endpoint",
      // Header item translations hang off their header, so the create path needs
      // both ids. `{parent}` is the header, `{id}` the item.
      create: "/admin/headers/{parent}/items/{id}/translations",
      update: "/admin/headers/{parent}/items/{id}/translations/{language}",
      key: "language_id",
    },
    titleField: "label",
    fields: [t("label"), url("url")],
  },
  {
    type: "footer",
    label: "Footer",
    llm: null,
    source: { path: "/admin/footers", key: "footers" },
    write: endpoint("/admin/footers"),
    titleField: "cta_button_text",
    fields: [t("cta_button_text"), url("cta_button_url")],
  },
  {
    type: "global_setting",
    label: "Global settings",
    llm: null,
    source: { path: "/admin/global-settings", key: "settings" },
    write: endpoint("/admin/global-settings"),
    titleField: "cta_text",
    fields: [
      t("cta_text"),
      url("cta_url"),
      t("popup_title"),
      t("popup_description"),
      t("popup_button_text"),
      url("popup_button_url"),
      // An address and a phone number are the clinic's, not prose — translating
      // them would invent a location. Social handles are identifiers.
      verbatim("address"),
      verbatim("phone_number"),
      verbatim("instagram_id"),
      verbatim("facebook_id"),
      verbatim("twitter_id"),
      verbatim("youtube_id"),
      verbatim("tiktok_id"),
    ],
  },
  {
    type: "before_after_ai_step",
    label: "Before/after-AI step",
    llm: null,
    source: { path: "/admin/before-after-ai/steps", key: "steps" },
    write: { mode: "embedded", put: "/admin/before-after-ai/steps/{id}", key: "language_code" },
    titleField: "title",
    fields: [t("title"), t("description")],
  },
  {
    // The site-wide CTA buttons (WhatsApp / consultation). Only the button's
    // text and its link are per-language; the icon and size are shared. Like the
    // AI steps, links have no /translations endpoint — the whole set is PUT back
    // with the row, so save has to re-send the other languages or they are lost.
    type: "link",
    label: "CTA link button",
    llm: null,
    source: { path: "/admin/links", key: "links" },
    write: { mode: "embedded", put: "/admin/links/{id}", key: "language_id" },
    titleField: "button_text",
    fields: [t("button_text"), url("button_url")],
  },
  {
    // Image alt text. `GET /admin/media` returns the rows as the envelope's
    // `data` array directly (pagination sits beside it, not inside), and there
    // is no per-language PUT — the POST upserts by language_code. The library is
    // large, so a media-only sweep is best run on its own rather than folded
    // into a content pass.
    type: "media",
    label: "Image alt text",
    llm: null,
    source: { path: "/admin/media", key: "data" },
    write: { mode: "endpoint", create: "/admin/media/{id}/translations", key: "language_code" },
    titleField: "alt",
    fields: [t("alt", 255)],
  },
];

/**
 * Translation endpoints deliberately left out of the sweep, and why.
 *
 * `scripts/check-translatable.mjs` reads this, so "not covered" is a recorded
 * decision rather than something that quietly fell off the list.
 */
export const UNCOVERED: Record<string, string> = {};

export const SURFACE_TYPES = SURFACES.map((surface) => surface.type) as [
  string,
  ...string[],
];

export function getSurface(type: string): TranslatableSurface {
  const surface = SURFACES.find((candidate) => candidate.type === type);
  if (!surface) {
    throw new Error(
      `Unknown content type '${type}'. Known types: ${SURFACE_TYPES.join(", ")}`,
    );
  }
  return surface;
}

/** The three the backend can translate on its own. */
export const LLM_SURFACES = SURFACES.filter((surface) => surface.llm !== null);
/** The rest — the agent has to write these itself. */
export const MANUAL_SURFACES = SURFACES.filter((surface) => surface.llm === null);

export function fillPath(
  template: string,
  values: { id?: number | string; parent?: number | string; language?: number | string },
): string {
  return template
    .replace("{parent}", String(values.parent ?? ""))
    .replace("{id}", String(values.id ?? ""))
    .replace("{language}", String(values.language ?? ""));
}
