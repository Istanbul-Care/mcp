import { get, encodeSlugPath } from "../api/client.js";
import { getProject, type ProjectId } from "../config/projects.js";
import type { Envelope, SlugLookupData } from "../api/types.js";

export interface ResolvedLink {
  resolved: boolean;
  url: string | null;
  type: SlugLookupData["type"] | null;
  id: number | null;
  lookupPath: string;
  reason?: string;
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
  const lookupPath = hrefToLookupPath(href, frontendUrl, knownLocales);

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
    url: buildPublicUrl(project, targetLanguage, fullPath),
    type: data.type,
    id: data.id,
    lookupPath,
  };
}
