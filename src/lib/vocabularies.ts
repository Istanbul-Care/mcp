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
 * the panel offers: hero `coverflow` and card `media_slider` are selectable in
 * the panel but have no branch on the site, so they are listed as accepted
 * with a warning rather than silently recommended.
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
      { value: "testimonial_gallery", label: "Testimonial gallery", note: "Media are consumed in pairs; an odd count leaves a gap." },
      { value: "word_cloud", label: "Why choose us", note: "Its description must be a JSON array of {title, description}." },
      { value: "media_slider", unrendered: true, note: "Offered by the panel but the site has no branch for it — renders as a plain card." },
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
      { value: "coverflow", unrendered: true, note: "Offered by the panel but the site has no branch — renders as default." },
    ],
    on_unknown: "Falls back to default.",
  },

  footer_style: {
    field: "style",
    applies_to: "footer",
    values: [{ value: "default" }, { value: "premium" }, { value: "editorial" }],
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
    ],
    on_unknown: "The record is not rendered in any of the four layouts.",
  },

  faq_style: {
    field: "style",
    applies_to: "page_faq",
    values: [
      { value: "default_faq", label: "Searchable FAQ with CTA" },
      { value: "word_style_faq", label: "Word-style FAQ", note: "The site also accepts the misspelling 'world_style_faq'." },
    ],
    on_unknown: "Falls back to the searchable FAQ.",
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
    ],
    on_unknown: "Treated as a top section.",
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
