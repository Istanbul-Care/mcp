/**
 * Fixed vocabularies: fields where only a listed value renders.
 *
 * Every one of these is a dropdown in the admin panel and a free string in the
 * database. Nothing validates them — not the panel on the way out, not the
 * API, not the column type. An unknown value does not error; the site's switch
 * statement simply falls through and the block renders as something else, or
 * as nothing.
 *
 * The values here are the ones the **site** honours, which is not always what
 * the panel offers. (Hero `coverflow` was selectable in the panel but had no
 * branch on the site, until the panel's option became `form`.)
 *
 * Site-side sources:
 *   CardSection.tsx · HeroesWrapper.tsx · Footer/index.tsx · Sliders.tsx
 *   BeforeAftersSection.tsx · FaqWrapper.tsx · NavItem.tsx · Footer/utils.ts
 *   LinkIcon.tsx · VideoEmbed.tsx · SocialMediaFollowSectionWrapper.tsx
 *   contact-form-modal/formHelpers.tsx
 */

export interface VocabularyValue {
  value: string;
  label?: string;
  /** Set when the panel offers it but the site has no branch for it. */
  unrendered?: true;
  note?: string;
}

export interface Vocabulary {
  field: string;
  applies_to: string;
  values: VocabularyValue[];
  /** What goes wrong when the value is not one of the above. */
  on_unknown: string;
  note?: string;
}

export const VOCABULARIES: Record<string, Vocabulary> = {
  card_type: {
    field: "type",
    applies_to: "card",
    values: [
      { value: "default", label: "Image and text card" },
      {
        value: "content",
        label: "Content with Reach Us form",
        note: "Also suppresses the page's standalone contact form, and its description feeds the table of contents.",
      },
      { value: "whatsapp", label: "Consultation banner" },
      { value: "vertical_slider", label: "Vertical slider" },
      {
        value: "seo_text",
        label: "SEO text (v8)",
        note: "One row on the brand's navy: the card's picture beside the eyebrow (the per-language small line over the title), the title as the heading and the description as prose. Every <h3> in the description, with what follows it up to the next <h3>, becomes a question that opens and closes; the text before the first <h3> stays as it is. text_position: 'left' puts the text left (picture right), 'right' the text right (picture first). Two seo_text cards one after the other read as one section (the agency's two-row SEO block). Rendered by the site since 2026-11-03 (staging).",
      },
      { value: "testimonial_gallery", label: "Testimonial gallery", note: "Media are consumed in pairs; an odd count leaves a gap." },
      { value: "word_cloud", label: "Why choose us", note: "Its description must be a JSON array of {title, description}." },
      { value: "media_slider", label: "Logo row", note: "A row of logos (press, partners, awards), media_ids being the logos. Two designs, picked by the card's dark_mode: false = design 1, the title between two rules and the logos in grey with a button at each end that slides the row on a click; true = design 2, the press strip in the hero's colour, made to sit right after the hero as its continuation: the title is a small uppercase heading (e.g. \"As seen in\"), the logos white and all one height, sliding slowly by themselves and stopping under the mouse. Rendered by the site since 2026-10-01 (design 2 since 2026-10-23)." },
    ],
    on_unknown: "Falls back to the plain image/text card.",
  },

  card_text_position: {
    field: "text_position",
    applies_to: "card",
    values: [
      { value: "left", note: "Puts the IMAGE on the right — the name describes the text, not the image." },
      { value: "right", note: "Puts the IMAGE on the left." },
      { value: "center" },
    ],
    on_unknown: "Centred layout.",
  },

  hero_style: {
    field: "style",
    applies_to: "hero",
    values: [
      { value: "default" },
      { value: "cinematic" },
      { value: "editorial" },
      { value: "premium" },
      { value: "form", note: "The brand's contact form on a card beside the headline; the hero's own button is not shown." },
      {
        value: "spotlight",
        note:
          "Background photo behind the headline, the hero's button and up to four features; the side " +
          "image (side_image_id) beside them when set; the brand's contact form as a strip below.",
      },
      {
        value: "team",
        note:
          "The hero's icons as badges, the headline (*words* coloured), the subtitle (**words** bold), " +
          "a WhatsApp button (the brand link) and the hero's own button (desktop only), beside the " +
          "side image (the team's cut-out photo) with the brand's contact form in front of it. " +
          "Features are not shown.",
      },
    ],
    on_unknown: "Falls back to default.",
  },

  footer_style: {
    field: "style",
    applies_to: "footer",
    values: [
      { value: "default" },
      { value: "premium" },
      { value: "editorial" },
      {
        value: "v8",
        note:
          "The brand's navy: logo and social icons, a link column per top_section, a contact column (the " +
          "bottom_section call/mail items, WhatsApp through the lead form, the address with a map button's " +
          "link), then the licence row (group 'licence' + group 'accreditation' logos) and the copyright line.",
      },
    ],
    on_unknown: "Falls back to default.",
  },

  slider_style: {
    field: "style",
    applies_to: "slider",
    values: [{ value: "Timeline" }, { value: "Showcase" }],
    on_unknown:
      "Falls back to inspecting each slide's type instead, which drops mixed slides.",
    note: "Capitalised — the only style field on the site that is not lowercase.",
  },

  slide_type: {
    field: "type",
    applies_to: "slider slide",
    values: [
      { value: "timeline", label: "Timeline step" },
      { value: "showcase", label: "Showcase panel" },
      { value: "image", label: "Plain image slide", note: "Rendered by the timeline layout." },
    ],
    on_unknown:
      "The slide belongs to neither layout and is dropped from the mixed-slide fallback.",
    note:
      "Always set the slider's own style as well. With no style the site guesses from the " +
      "slides, and in the mixed case it collects the timeline half by looking for type " +
      "'image' — so a styleless slider holding 'timeline' and 'showcase' slides renders the " +
      "showcase ones and silently drops every timeline slide.",
  },

  footer_section_platform: {
    field: "platform",
    applies_to: "footer_section",
    values: [
      { value: "instagram" },
      { value: "facebook" },
      { value: "youtube" },
      { value: "messenger" },
    ],
    on_unknown: "Rejected by the API.",
    note: "Only set on the social sections; leave it empty for an ordinary link column.",
  },

  before_after_style: {
    field: "style",
    applies_to: "before_after",
    values: [
      { value: "style_1", label: "Patient progress slider" },
      { value: "style_2", label: "Transformation showcase" },
      { value: "style_3", label: "Clinical results grid" },
      { value: "style_4", label: "Before/after hero", note: "All style_4 records on a page merge into one filterable gallery, using only the first one's order." },
      { value: "style_5", label: "Cases by angle", note: "Each case's photos from several angles with a category filter. Uses each case's angle_id (its own pair's angle), views (its other angles), category_ids and months_after, not the sex/technique/graft/age chips. The angles and categories are lists the brand keeps, a name per language: create them first (create_before_after_angle / create_before_after_category), then set them on the cases (create_gallery_item / update_gallery_item)." },
    ],
    on_unknown: "The record is not rendered in any of the five layouts.",
  },

  faq_style: {
    field: "style",
    applies_to: "page_faq",
    values: [
      { value: "default_faq", label: "Searchable FAQ with CTA" },
      { value: "word_style_faq", label: "Word-style FAQ", note: "The site also accepts the misspelling 'world_style_faq'." },
      { value: "whatsapp_box_faq", label: "One list + WhatsApp box (v8)", note: "On the brand's navy: every question once, no categories or search, the first answer open and one open at a time, then a green WhatsApp box (\"Still have a question? Ask a doctor on WhatsApp · Chat now\") going through the lead form to the brand's WhatsApp." },
    ],
    on_unknown: "Falls back to the searchable FAQ.",
  },

  campaign_theme: {
    field: "theme",
    applies_to: "campaign",
    values: [
      {
        value: "black_friday",
        label: "Black Friday",
        note:
          "Black ground (#0b0b0f), gold accent (#f5c542), white text unless the campaign's colours say " +
          "otherwise: a side card sliding in from the edge with the countdown, the popup in black and gold " +
          "with the offer large, a ribbon on the package cards, the hero's coloured words in the accent — " +
          "laid over the site, nothing changes size.",
      },
      {
        value: "custom",
        label: "Custom (colours only)",
        note: "The same places, in the campaign's own colours and nothing else — for an occasion the site has no look for yet.",
      },
    ],
    on_unknown: "The site falls back to the plain campaign look (colours only).",
    note: "A new occasion is one value here, one in the panel's list and its look on the site.",
  },

  child_pages_style: {
    field: "child_pages.style",
    applies_to: "page",
    values: [
      { value: "", label: "Cards", unrendered: true, note: "The site does not draw the plain child-page cards." },
      {
        value: "videos",
        label: "Video library (v8)",
        note:
          "The /videos/ page: the title and excerpt beside a featured video (the child whose banner video is " +
          "the page's own banner_video_id, else the first doctor video), chips to the groups, the recovery " +
          "timeline (video.month / video.day), doctor videos three to a row, short clips in a sliding shelf, " +
          "patient stories. Only children with a banner video show; each is a layout_style 3 page.",
      },
    ],
    on_unknown: "Not drawn.",
  },

  video_group: {
    field: "video.group",
    applies_to: "page (layout_style 3)",
    values: [
      { value: "recovery", label: "Recovery timeline", note: "Ordered by day then month; set video.month (and video.day for the first weeks)." },
      { value: "doctor", label: "Doctor explains" },
      { value: "clips", label: "Short clips", note: "A youtube.short / tiktok video stands 9:16 in the shelf." },
      { value: "patients", label: "Patient stories" },
    ],
    on_unknown: "Refused by the API.",
  },

  header_item_type: {
    field: "item_type",
    applies_to: "header_item",
    values: [
      { value: "custom_button", note: "Reads the item's own children." },
      { value: "service_category", note: "Reads categories; navigates to the item's url and stashes the category id." },
      { value: "post_category", note: "Reads categories; builds url?blog-category={slug}." },
    ],
    on_unknown: "The dropdown reads the wrong collection and disappears entirely.",
  },

  header_style: {
    field: "header_style",
    applies_to: "page",
    values: [
      { value: "classic", note: "The brand bar. Also the meaning of an empty value." },
      {
        value: "transparent",
        note:
          "No background over the page's opening picture (hero or breadcrumb banner image); the " +
          "brand background comes in once the visitor scrolls.",
      },
      {
        value: "mega",
        note:
          "The transparent bar with a mega menu: hovering a top-level item opens a floating card " +
          "under the bar with its sub-items, each laid out by its mega_display (see " +
          "header_mega_display). The only design that reads the items' image_media, mega_display, " +
          "description, highlight and cta_label.",
      },
    ],
    on_unknown: "Rejected by the API.",
  },

  header_button_style: {
    field: "button_style",
    applies_to: "header_item",
    values: [
      { value: "filled", note: "The brand colour." },
      { value: "green" },
      { value: "outline" },
      {
        value: "icon",
        note:
          "A round button showing only the item's icon (icon_media_id); the label is read out by " +
          "screen readers only — e.g. a tel: link.",
      },
    ],
    on_unknown: "Rejected by the API.",
    note:
      "Empty = a plain menu link. Only a top-level custom_button item with a URL shows as a button.",
  },

  header_mega_display: {
    field: "mega_display",
    applies_to: "header_item",
    values: [
      {
        value: "column",
        note: "Right under a top item: its label is a small uppercase heading, its own sub-items under it.",
      },
      {
        value: "promo",
        note:
          "Right under a top item: the highlighted box at the right end — label = the small top " +
          "line, highlight = the big words (e.g. 'from $1,990'), description = its text, cta_label = " +
          "its button, to the item's URL.",
      },
      {
        value: "feature",
        note:
          "Inside a column: a wide card over image_media — label, description, cta_label (e.g. " +
          "'See prices →'); the whole card links.",
      },
      {
        value: "tile",
        note:
          "Inside a column: a photo tile — image_media, icon, label, description (e.g. 'From " +
          "$1,990'); tiles sit side by side.",
      },
      { value: "link", note: "Inside a column: the label with its description under it." },
    ],
    on_unknown: "Rejected by the API.",
    note:
      "Empty = automatic: a column if the item has sub-items, else a link. Only the mega header " +
      "design (a page's header_style 'mega') reads it; classic and transparent ignore it.",
  },

  footer_item_type: {
    field: "type",
    applies_to: "footer_section_item",
    values: [
      { value: "url", note: "Renders an Instagram icon regardless of destination." },
      { value: "mail", note: "Value should be a bare email address." },
      { value: "call", note: "Value should be a phone number." },
      { value: "text", note: "Not a link." },
      { value: "button" },
    ],
    on_unknown: "No icon and no type-specific handling.",
  },

  footer_section_group: {
    field: "group",
    applies_to: "footer_section",
    values: [
      { value: "top_section", note: "Also the meaning of an empty value." },
      { value: "bottom_section", note: "Only bottom-section links run through the modal/CTA dispatcher." },
      {
        value: "licence",
        note:
          "v8 footer only: the section title (e.g. 'Licensed & accredited') and its text items as lines; its " +
          "link items show in the copyright line (e.g. 'Verify on healthturkiye.gov.tr', opens in a new tab).",
      },
      {
        value: "accreditation",
        note:
          "v8 footer only: one logo per section — its icon (icon_media_id), the title as the logo's name; " +
          "an item's link makes the logo a link (new tab).",
      },
    ],
    on_unknown: "Not shown (the site shows top_section/empty, bottom_section, and on the v8 footer licence/accreditation).",
  },

  link_icon: {
    field: "icon",
    applies_to: "link",
    values: [
      { value: "phone" },
      { value: "whatsapp" },
      { value: "briefcase-medical" },
      { value: "envelope" },
      { value: "calendar" },
      { value: "location" },
      { value: "chat" },
    ],
    on_unknown: "No icon at all — not a fallback icon.",
    note: "These are the site's own codes. Card and feature icon fields are different: they take Iconify names such as 'solar:whatsapp-outline'.",
  },

  link_size: {
    field: "size",
    applies_to: "link",
    values: [{ value: "small" }, { value: "large" }],
    on_unknown: "Treated as large.",
  },

  media_type: {
    field: "media_type",
    applies_to: "media",
    values: [
      { value: "image" },
      { value: "video" },
      { value: "youtube.video", note: "The stored url must be the bare video id, not a watch URL." },
      { value: "youtube.short", note: "Bare video id." },
      { value: "tiktok.video", note: "Bare video id." },
    ],
    on_unknown: "The embed does not render.",
  },

  social_embed_type: {
    field: "media_type",
    applies_to: "social media follow section",
    values: [
      { value: "instagram", note: "media_id must be the Elfsight app id, not a video id." },
      { value: "tiktok", note: "Bare video id." },
      { value: "youtube", note: "Bare video id." },
    ],
    on_unknown: "The item is silently dropped from the section.",
    note:
      "The brand's embeds: global settings embed_media (create_global_setting / " +
      "update_global_setting), shown by a page's social_media block. Its style 2 (the patient " +
      "stories) shows only the youtube ones.",
  },

  form_field_type: {
    field: "field_type",
    applies_to: "multi_page_form field",
    values: [
      { value: "name", note: "Routes the lead's name." },
      { value: "firstName", note: "Routes the lead's name." },
      { value: "lastName", note: "Routes the lead's name." },
      { value: "email", note: "Routes the lead's email." },
      { value: "mobile", note: "Routes the lead's phone." },
      { value: "phone", note: "Routes the lead's phone." },
      { value: "date" },
      { value: "number" },
      { value: "checkbox" },
      { value: "Large text", note: "Note the space and the capital L." },
    ],
    on_unknown:
      "Renders a plain text input, and for the routing types the lead arrives with that field empty.",
  },

  redirect_method: {
    field: "method",
    applies_to: "redirect",
    values: [
      { value: "301", label: "Moved permanently" },
      { value: "302", label: "Found" },
      { value: "303", label: "See other" },
      { value: "307", label: "Temporary redirect" },
      { value: "308", label: "Permanent redirect" },
    ],
    on_unknown: "Defaults to 301.",
    note: "source_url must be '/v1/{lang}/pages/{slug}' and target_url '/{lang}/{path}/' with both slashes.",
  },

  content_status: {
    field: "status",
    applies_to: "post, service",
    values: [{ value: "draft" }, { value: "published" }, { value: "scheduled", note: "Requires scheduled_at." }],
    on_unknown: "Rejected by the API.",
  },

  faq_owner_type: {
    field: "owner_type",
    applies_to: "faq",
    values: [{ value: "post" }, { value: "service" }, { value: "page" }],
    on_unknown: "The FAQ is attached to nothing.",
  },
};

export interface VocabularyCheck {
  ok: boolean;
  message?: string;
}

/**
 * Validate a value against a vocabulary. Returns ok for an unknown vocabulary
 * name so a caller never blocks on a field this table has not learned yet.
 */
export function checkVocabulary(name: string, value: unknown): VocabularyCheck {
  const vocab = VOCABULARIES[name];
  if (!vocab) return { ok: true };
  if (value === undefined || value === null || value === "") return { ok: true };
  const raw = String(value);
  const hit = vocab.values.find((v) => v.value === raw);
  if (!hit) {
    const allowed = vocab.values.map((v) => v.value).join(", ");
    return {
      ok: false,
      message:
        `'${raw}' is not a value the site renders for ${vocab.applies_to}.${vocab.field ? ` Field: ${vocab.field}.` : ""} ` +
        `Accepted: ${allowed}. ${vocab.on_unknown} Nothing validates this field, so the wrong value fails silently.`,
    };
  }
  if (hit.unrendered) {
    return {
      ok: false,
      message:
        `'${raw}' is offered by the admin panel but the site has no branch for it — ${hit.note ?? "it will not render as intended"}. Pick another value.`,
    };
  }
  return { ok: true };
}
