import { get, encodeSlugPath } from "../api/client.js";
import { getProject, type ProjectId } from "../config/projects.js";
import type { Envelope, SlugLookupData } from "../api/types.js";
import { classifyLinkValue, type LinkValueMatch } from "./link-values.js";

export interface ResolvedLink {
  resolved: boolean;
  url: string | null;
  type: SlugLookupData["type"] | null;
  id: number | null;
  lookupPath: string;
  reason?: string;
  /**
   * Set when the value is one of the site's reserved link instructions
   * (see link-values.ts). Such a value is correct as written and must be
   * stored verbatim — it is not a path and not a dead link.
   */
  reserved?: LinkValueMatch;
}

/**
 * Split a query string and/or fragment off a link so it can be reattached
 * after the path is resolved. Losing them silently breaks filtered blog links
 * (`?blog-category=…`) and in-page anchors on translation.
 */
export function splitLinkSuffix(href: string): { base: string; suffix: string } {
  const trimmed = href.trim();
  const cut = trimmed.search(/[?#]/);
  if (cut <= 0) return { base: trimmed, suffix: "" };
  return { base: trimmed.slice(0, cut), suffix: trimmed.slice(cut) };
}

export function hrefToLookupPath(
  href: string,
  frontendUrl: string,
  knownLocales: readonly string[],
): string | null {
  const trimmed = href.trim();
  if (!trimmed || /^(mailto:|tel:|#|javascript:)/i.test(trimmed)) return null;

  let pathname: string;
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (frontendUrl) {
      let base: URL;
      try {
        base = new URL(frontendUrl);
      } catch {
        return null;
      }
      if (url.host !== base.host) return null;
    }
    pathname = url.pathname;
  } else if (trimmed.startsWith("//")) {
    return null;
  } else if (trimmed.startsWith("/")) {
    pathname = trimmed;
  } else {
    return null;
  }

  let segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  if (knownLocales.includes(segments[0]!)) segments = segments.slice(1);
  if (segments.length === 0) return null;
  return segments.join("/");
}


/**
 * Anchor parsing shared by every link tool.
 *
 * The opening tag is kept whole so a rewrite can swap only the href and leave
 * class, target, rel and title alone. Hrefs may be double-quoted,
 * single-quoted or bare — matching only double quotes made single-quoted
 * links invisible.
 */
export const ANCHOR_RE = /(<a\b[^>]*>)([\s\S]*?)<\/a>/gi;
export const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

export function hrefOf(openTag: string): string | null {
  const m = openTag.match(HREF_RE);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

export function withHref(openTag: string, nextHref: string): string {
  return openTag.replace(HREF_RE, (whole) => {
    const quote = whole.includes('"') ? '"' : whole.includes("'") ? "'" : '"';
    return `href=${quote}${nextHref}${quote}`;
  });
}

export function buildPublicUrl(
  project: ProjectId,
  languageCode: string,
  fullPath: string,
): string {
  const { defaultLanguage } = getProject(project);
  const cleaned = fullPath.replace(/^\/+|\/+$/g, "");
  const prefix = languageCode === defaultLanguage ? "" : `/${languageCode}`;
  if (!cleaned) return `${prefix}/`;
  return `${prefix}/${cleaned}/`.replace(/\/{2,}/g, "/");
}

export async function resolveInternalLink(
  project: ProjectId,
  href: string,
  targetLanguage: string,
  knownLocales: readonly string[],
): Promise<ResolvedLink> {
  const { frontendUrl } = getProject(project);

  // A reserved value is an instruction to the site, not a URL. Resolving it
  // as a path would report a working modal trigger as a dead link.
  const reserved = classifyLinkValue(href);
  if (reserved) {
    return {
      resolved: true,
      url: reserved.value,
      type: null,
      id: null,
      lookupPath: "",
      reserved,
      reason: reserved.effect,
    };
  }

  const { base, suffix } = splitLinkSuffix(href);
  const lookupPath = hrefToLookupPath(base, frontendUrl, knownLocales);

  if (lookupPath === null) {
    return {
      resolved: false,
      url: null,
      type: null,
      id: null,
      lookupPath: "",
      reason: "external, non-http, or empty href — nothing to localise",
    };
  }

  let data: SlugLookupData;
  try {
    const response = await get<Envelope<SlugLookupData>>(
      project,
      `/slug-translations/${encodeSlugPath(lookupPath)}`,
      undefined,
      false,
    );
    data = response.data;
  } catch (error) {
    return {
      resolved: false,
      url: null,
      type: null,
      id: null,
      lookupPath,
      reason:
        error instanceof Error && error.message.includes("404")
          ? "no published post, service, or page owns this slug — the link is dead and should be unwrapped"
          : `lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let fullPath: string | undefined = data.translations.find(
    (t) => t.language_code === targetLanguage,
  )?.slug;
  if (data.matched_language_code === targetLanguage) {
    fullPath = data.matched_slug;
  }

  if (!fullPath) {
    return {
      resolved: false,
      url: null,
      type: data.type,
      id: data.id,
      lookupPath,
      reason: `'${data.type}' #${data.id} has no '${targetLanguage}' translation — unwrap the link rather than pointing at another language`,
    };
  }

  return {
    resolved: true,
    url: `${buildPublicUrl(project, targetLanguage, fullPath)}${suffix}`,
    type: data.type,
    id: data.id,
    lookupPath,
  };
}
