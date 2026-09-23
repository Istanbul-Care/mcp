/**
 * Link values that are instructions, not URLs.
 *
 * A link field on a card, hero, CTA or footer item is read by the site's
 * `ConsultationLink` dispatcher before it is ever treated as a path. A handful
 * of literal values make it open a modal, substitute the global CTA, or
 * capture a lead before handing the visitor off. They are ordinary strings an
 * editor types into an ordinary field, and nothing — not the panel, not the
 * API, not the database — validates them.
 *
 * Without this table the link tools treat `modal-dialog-consultation` as a
 * slug, fail to find a page, and report a working button as a dead link. Worse,
 * an agent asked to "add a button that opens the consultation form" has no way
 * to learn the literal and writes a plausible URL that silently never opens
 * anything.
 *
 * Source of truth on the site side:
 *   src/lib/url.ts                          (reserved values, locale skipping)
 *   src/components/ConsultationLink.tsx     (the dispatch order)
 *   src/components/common/ContentDialogTriggers.tsx  (rich-text anchors)
 */

export type LinkValueKind =
  | "global-cta"
  | "consultation-modal"
  | "multi-page-form-modal"
  | "lead-popup-anchor"
  | "lead-gated-external"
  | "no-link";

export interface LinkValueSpec {
  kind: LinkValueKind;
  /** What the site does when a link carries this value. */
  effect: string;
  /** Where the value works. Not every field runs through the dispatcher. */
  worksIn: "dispatched-link-fields" | "rich-text-content";
}

/** Fields that render through `ConsultationLink` and honour the sentinels. */
export const DISPATCHED_LINK_FIELDS = [
  "card.button_url",
  "hero.button_url",
  "hero_feature.url",
  "slider_slide.button_url",
  "slider_slide.cta_url",
  "process.button_url",
  "package_section.button_url",
  "promotional_landing.button_url",
  "promotional_landing.read_more_url",
  "promotional_landing.contact_url",
  "google_map_section.cta_button_url",
  "contact_form.button_url",
  "multi_page_form.cta_button_url",
  "global_setting.cta_url",
  "global_setting.popup_button_url",
  "link.button_url",
  "footer.cta_button_url",
  "footer_section_item.url (bottom sections only)",
] as const;

/**
 * Fields that look identical in the panel but render through a plain link, so
 * a sentinel typed here produces a 404 instead of a modal.
 */
export const UNDISPATCHED_LINK_FIELDS = [
  "header_item.url",
  "footer_section_item.url (top sections)",
] as const;

/** Exact values. Compared against the raw stored string. */
export const RESERVED_LINK_VALUES: Record<string, LinkValueSpec> = {
  cta_url: {
    kind: "global-cta",
    effect:
      "Replaced at render time with the brand's cta_url from global settings. The literal string, not a placeholder — no braces, no percent signs.",
    worksIn: "dispatched-link-fields",
  },
  consultation: {
    kind: "consultation-modal",
    effect: "Opens the seven-step consultation wizard.",
    worksIn: "dispatched-link-fields",
  },
  "modal-dialog-consultation": {
    kind: "consultation-modal",
    effect:
      "Opens the seven-step consultation wizard. Loads the multi-page form whose form_code is this same string.",
    worksIn: "dispatched-link-fields",
  },
  "modal-dialog-medical-history": {
    kind: "multi-page-form-modal",
    effect:
      "Opens the medical-history form modal, loaded by this form_code.",
    worksIn: "dispatched-link-fields",
  },
  "#": {
    kind: "no-link",
    effect: "Renders an inert link. Skips locale prefixing.",
    worksIn: "dispatched-link-fields",
  },
  "#get-free-consultation": {
    kind: "lead-popup-anchor",
    effect:
      "Inside rich-text content only: opens the lead popup. Matched by an exact CSS attribute selector, so any variation is a dead anchor.",
    worksIn: "rich-text-content",
  },
  "#dialog=get-free-consultation": {
    kind: "lead-popup-anchor",
    effect:
      "Second accepted spelling of the rich-text lead-popup anchor.",
    worksIn: "rich-text-content",
  },
};

/**
 * Prefix convention: any link starting with this opens a multi-page form, and
 * the WHOLE href is sent as the form_code. The form's own code must therefore
 * start with the prefix too, or the modal opens on a skeleton forever.
 */
export const MODAL_DIALOG_PREFIX = "modal-dialog-";

/**
 * Hosts that make the site show a lead-capture popup before handing the
 * visitor off. Anchored the same way the site anchors them — a near miss like
 * `web.whatsapp.com` or `www.wa.me` skips the popup and the lead is lost.
 */
export const LEAD_GATED_PATTERNS: readonly RegExp[] = [
  /^https?:\/\/api\.whatsapp\.com/i,
  /^https?:\/\/wa\.link/i,
  /^https?:\/\/wa\.me/i,
  /^https?:\/\/destakesk\.github\.io/i,
];

export interface LinkValueMatch {
  reserved: true;
  value: string;
  kind: LinkValueKind;
  effect: string;
  worksIn: LinkValueSpec["worksIn"];
  /** For the modal-dialog prefix, the form_code the site will request. */
  formCode?: string;
}

/**
 * Classify a stored link value. Returns null for an ordinary URL or path,
 * which is what the callers should then resolve normally.
 */
export function classifyLinkValue(href: string): LinkValueMatch | null {
  const raw = (href ?? "").trim();
  if (!raw) return null;

  const exact = RESERVED_LINK_VALUES[raw];
  if (exact) {
    return {
      reserved: true,
      value: raw,
      kind: exact.kind,
      effect: exact.effect,
      worksIn: exact.worksIn,
      ...(raw.startsWith(MODAL_DIALOG_PREFIX) ? { formCode: raw } : {}),
    };
  }

  if (raw.startsWith(MODAL_DIALOG_PREFIX)) {
    return {
      reserved: true,
      value: raw,
      kind: "multi-page-form-modal",
      effect:
        `Opens the multi-page form whose form_code is exactly '${raw}'. Create that form first — an unknown code leaves the modal on a loading skeleton.`,
      worksIn: "dispatched-link-fields",
      formCode: raw,
    };
  }

  if (LEAD_GATED_PATTERNS.some((p) => p.test(raw))) {
    return {
      reserved: true,
      value: raw,
      kind: "lead-gated-external",
      effect:
        "Shows the lead-capture popup first, then hands the visitor off. Only these exact hosts are gated; a near miss sends the visitor straight out and the lead is lost.",
      worksIn: "dispatched-link-fields",
    };
  }

  return null;
}

/** True when a value must be stored verbatim rather than localised. */
export function isReservedLinkValue(href: string): boolean {
  return classifyLinkValue(href) !== null;
}

/** The literal an agent should write to get a given behaviour. */
export const LINK_VALUE_RECIPES: Record<string, string> = {
  "open the consultation wizard": "modal-dialog-consultation",
  "open the medical history form": "modal-dialog-medical-history",
  "open a specific multi-page form": "modal-dialog-<that form's code>",
  "use the brand's global CTA link": "cta_url",
  "open the lead popup from inside body text": "#get-free-consultation",
  "render an inert link": "#",
};
