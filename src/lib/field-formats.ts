/**
 * Text columns whose contents are parsed.
 *
 * These look like free text in the admin panel and are free text in the
 * database, but the site runs a parser over them. A malformed value never
 * errors — it is swallowed, and the block renders empty, unfiltered, or
 * without its currency symbol.
 *
 * Site-side sources:
 *   cards/WhyChooseUs.tsx (word cloud JSON) · services/seo/api.ts (focus
 *   keyword, canonical) · services/blog/api.ts (query parameters) ·
 *   shared/price.ts (currency) · VideoEmbed.tsx (bare video ids)
 */

export interface FormatCheck {
  ok: boolean;
  message?: string;
}

const ok: FormatCheck = { ok: true };

/**
 * A word-cloud card stores its badges as JSON in the description column. A
 * parse error is caught and discarded on the site, so the card renders with a
 * heading and no words at all.
 */
export function checkWordCloudDescription(value: unknown): FormatCheck {
  if (typeof value !== "string" || !value.trim()) return ok;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      ok: false,
      message:
        "A word_cloud card's description must be JSON, not HTML. Expected an array of " +
        '{"title": "...", "description": "..."}. The site swallows the parse error and ' +
        "renders the card with no words.",
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      message:
        "A word_cloud card's description must be a JSON ARRAY of {title, description} objects.",
    };
  }
  const bad = parsed.findIndex(
    (item) => typeof item !== "object" || item === null || !("title" in item),
  );
  if (bad !== -1) {
    return {
      ok: false,
      message: `Entry ${bad} of the word_cloud description has no "title". Each entry must be {title, description}.`,
    };
  }
  return ok;
}

/**
 * Focus keyword: one keyword, no separator.
 *
 * Three parties disagree about this field and only one of them matters.
 * The admin panel validates it as a comma-separated list of up to ten. The
 * site splits it on the PIPE character to build the `keywords` meta tag,
 * which no search engine has read since 2009. The backend's SEO audit — the
 * one thing that actually gates publishing — never splits it at all:
 * `audit_post_seo` asks whether the WHOLE stored string appears in the meta
 * title, in the meta description, in the slug, and in the first 150 characters
 * of the body, then counts its occurrences for the density score.
 *
 * So any separator at all, comma or pipe, makes five checks fail forever: no
 * meta title contains "hair transplant cost,hair transplant cost germany,…".
 * The content can be perfect and the post still audits as broken, which is
 * exactly the signal an editor then learns to ignore.
 */
export function checkFocusKeyword(value: unknown): FormatCheck {
  if (typeof value !== "string" || !value.trim()) return ok;
  const separator = value.includes("|") ? "|" : value.includes(",") ? "," : null;
  if (!separator) return ok;
  const first = value.split(separator)[0]?.trim() || "the main one";
  return {
    ok: false,
    message:
      `focus_keyword holds several keywords separated by '${separator}'. The SEO audit ` +
      `matches the WHOLE string against the title, the description, the slug and the ` +
      `opening of the body, so it can never pass and the post stays permanently red. ` +
      `Store one keyword — '${first}' — and work the variants into the copy instead. ` +
      `(The panel offers a comma-separated list and the site splits on '|' for the legacy ` +
      `keywords meta tag; neither changes what the audit does.)`,
  };
}

/** ISO-4217. Anything else renders the price as a bare number, silently. */
export function checkCurrency(value: unknown): FormatCheck {
  if (typeof value !== "string" || !value.trim()) return ok;
  if (/^[A-Z]{3}$/.test(value.trim())) return ok;
  return {
    ok: false,
    message:
      `'${value}' is not an ISO-4217 currency code. Use 'USD', 'EUR', 'TRY' — a symbol, a ` +
      "name, or a code with stray spaces makes the price render as a bare number with no " +
      "symbol and no error.",
  };
}

/**
 * For the dotted media types the site interpolates the stored url straight
 * into an embed path, so it must be the bare id rather than a watch URL.
 */
export function checkEmbedId(mediaType: unknown, url: unknown): FormatCheck {
  if (typeof mediaType !== "string" || typeof url !== "string") return ok;
  if (!/^(youtube\.|tiktok\.)/.test(mediaType)) return ok;
  if (!/^https?:\/\//i.test(url)) return ok;
  return {
    ok: false,
    message:
      `A '${mediaType}' media stores the bare video id, not a URL — the site interpolates it ` +
      "into the embed path. Extract the id from the link first.",
  };
}

/**
 * `page` and `limit` are always overwritten by the site, so setting them here
 * does nothing and usually means the author expected them to work.
 */
export function checkQueryParameters(value: unknown): FormatCheck {
  if (typeof value !== "string" || !value.trim()) return ok;
  const params = new URLSearchParams(value.replace(/^\?/, ""));
  const ignored = ["page", "limit"].filter((k) => params.has(k));
  if (ignored.length > 0) {
    return {
      ok: false,
      message:
        `query_parameters sets ${ignored.join(" and ")}, which the site always overwrites. ` +
        "Use the block's own limit field instead, and drop it from the query string.",
    };
  }
  return ok;
}

/** Structured data is emitted verbatim; nothing adds the context for you. */
export function checkSchemaData(value: unknown): FormatCheck {
  if (value === undefined || value === null) return ok;
  const obj =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;
  if (obj === null) {
    return { ok: false, message: "schema_data is not valid JSON." };
  }
  if (typeof obj !== "object" || Array.isArray(obj)) return ok;
  const record = obj as Record<string, unknown>;
  if (Object.keys(record).length === 0) return ok;
  if (!("@context" in record)) {
    return {
      ok: false,
      message:
        'schema_data is emitted into the page verbatim, so it must be complete JSON-LD — ' +
        'add "@context": "https://schema.org". Nothing injects it, and nothing validates ' +
        "the result.",
    };
  }
  return ok;
}

/** Run several checks, returning the first failure's message. */
export function ensureFormats(checks: Array<FormatCheck>): string | null {
  for (const check of checks) {
    if (!check.ok) return check.message ?? "Invalid field format.";
  }
  return null;
}
