const TRANSLITERATION_MAP: Record<string, string> = {
  ı: "i",
  İ: "i",
  ß: "ss",
  æ: "ae",
  Æ: "ae",
  œ: "oe",
  Œ: "oe",
  ł: "l",
  Ł: "l",
  ø: "o",
  Ø: "o",
  đ: "d",
  Đ: "d",
  ð: "d",
  Ð: "d",
  þ: "th",
  Þ: "th",
};

const COMBINING_MARKS = /[̀-ͯ]/g;

const APOSTROPHES = /['‘’ʹʻʼʽ`´′]/g;

export function slugify(value: string): string {
  return value
    .split("")
    .map((char) => TRANSLITERATION_MAP[char] ?? char)
    .join("")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  if (!slug) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export function coerceSlug(slug: string): { slug: string; corrected: boolean } {
  if (isValidSlug(slug)) return { slug, corrected: false };
  return { slug: slugify(slug), corrected: true };
}

function legacyAccentDroppedSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface SlugAudit {
  valid: boolean;
  transliteration_bug: boolean;
  suggested: string;
  needs_review: boolean;
}

export function auditSlug(slug: string, title: string): SlugAudit {
  const valid = isValidSlug(slug);
  const suggested = slugify(title);
  const legacy = legacyAccentDroppedSlug(title);
  const transliterationBug = valid && slug === legacy && legacy !== suggested;
  return {
    valid,
    transliteration_bug: transliterationBug,
    suggested,
    needs_review: !valid || transliterationBug,
  };
}
