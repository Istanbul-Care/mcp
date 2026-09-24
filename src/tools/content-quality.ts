import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, put } from "../api/client.js";
import type { Envelope, PostDetail } from "../api/types.js";
import { slugify, isValidSlug, auditSlug } from "../lib/slug.js";
import {
  resolveInternalLink,
  hrefToLookupPath,
  splitLinkSuffix,
  ANCHOR_RE,
  hrefOf,
  withHref,
} from "../lib/links.js";
import { classifyLinkValue } from "../lib/link-values.js";
import { getProject } from "../config/projects.js";
import {
  ok,
  fail,
  guard,
  projectParam,
  getActiveLanguageCodes,
} from "./helpers.js";

/** Matches an anchor and captures its href and inner HTML. */

export interface LinkFinding {
  href: string;
  status: "ok" | "needs_fix" | "dead";
  suggested_url?: string | null;
  reason?: string;
}

export async function auditLinks(
  project: Parameters<typeof getActiveLanguageCodes>[0],
  html: string,
  langCode: string,
  locales: readonly string[],
): Promise<LinkFinding[]> {
  const frontendUrl = getProject(project).frontendUrl;
  const anchors = [...html.matchAll(ANCHOR_RE)];
  const uniqueHrefs = [
    ...new Set(
      anchors
        .map((m) => hrefOf(m[1] ?? "") ?? "")
        .filter((href) => {
          if (!href) return false;
          // A reserved value is an instruction to the site, not a URL — it has
          // no page to resolve and must never be reported as a dead link.
          if (classifyLinkValue(href)) return false;
          return hrefToLookupPath(splitLinkSuffix(href).base, frontendUrl, locales) !== null;
        }),
    ),
  ];

  const findings = await Promise.all(
    uniqueHrefs.map(async (href): Promise<LinkFinding> => {
      const result = await resolveInternalLink(project, href, langCode, locales);
      if (!result.resolved || !result.url) {
        return { href, status: "dead", reason: result.reason };
      }
      const already =
        href === result.url ||
        href === `${frontendUrl.replace(/\/+$/, "")}${result.url}`;
      return already
        ? { href, status: "ok", suggested_url: result.url }
        : { href, status: "needs_fix", suggested_url: result.url };
    }),
  );
  return findings;
}

export function registerContentQualityTools(server: McpServer): void {
  server.registerTool(
    "generate_slug",
    {
      title: "Generate a URL-safe slug",
      description:
        "Turns a title (in any language) into a lowercase ASCII slug, transliterating " +
        "accents correctly — é→e, ș→s, ł→l, ß→ss, Türkçe ç/ğ/ı/ş → c/g/i/s, and so on — " +
        "instead of dropping them. Matches the backend's slug rules, so use it for every " +
        "slug you set on a post, category or tag. Needs no authentication.",
      inputSchema: {
        text: z.string().min(1).describe("The title or phrase to slugify."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ text }) =>
      guard(async () => {
        const slug = slugify(text);
        return ok({ input: text, slug, valid: isValidSlug(slug) });
      }),
  );

  server.registerTool(
    "check_slug",
    {
      title: "Check whether a slug is valid",
      description:
        "Reports whether a slug is already URL-safe (lowercase ASCII words joined by single " +
        "hyphens) and, if not, what it would become. Use it to catch slugs carrying raw " +
        "accents or other invalid characters. Needs no authentication.",
      inputSchema: {
        slug: z.string().min(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ slug }) =>
      guard(async () => {
        const valid = isValidSlug(slug);
        const normalized = slugify(slug);
        return ok({
          slug,
          valid,
          normalized,
          would_change: !valid && normalized !== slug,
        });
      }),
  );

  server.registerTool(
    "audit_post",
    {
      title: "Audit a post's slugs and internal links",
      description:
        "Reads a post and reports, per translation: whether its slug is URL-safe (flagging " +
        "raw accents / invalid characters, with a suggested fix), and every internal body " +
        "link classified as ok, needs_fix (resolves but the link points at the wrong URL — " +
        "e.g. a missing /blog/ prefix or wrong language) or dead (nothing published owns it). " +
        "Read-only. Requires login.",
      inputSchema: {
        project: projectParam,
        post_id: z.number().int(),
        language_id: z
          .number()
          .int()
          .optional()
          .describe("Audit a single translation instead of all of them."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, post_id, language_id }) =>
      guard(async () => {
        const response = await get<Envelope<PostDetail>>(
          project,
          `/admin/posts/${post_id}`,
          { language_id },
        );
        const post = response.data;
        const locales = await getActiveLanguageCodes(project);

        const translations = await Promise.all(
          post.translations.map(async (t) => {
            const slug = auditSlug(t.slug, t.title);
            const links = await auditLinks(
              project,
              t.content ?? "",
              t.language.code,
              locales,
            );
            return {
              language: t.language.code,
              language_id: t.language.id,
              slug: t.slug,
              slug_valid: slug.valid,
              slug_transliteration_bug: slug.transliteration_bug,
              suggested_slug: slug.needs_review ? slug.suggested : undefined,
              links: {
                total: links.length,
                ok: links.filter((l) => l.status === "ok").length,
                needs_fix: links.filter((l) => l.status === "needs_fix").length,
                dead: links.filter((l) => l.status === "dead").length,
                findings: links.filter((l) => l.status !== "ok"),
              },
            };
          }),
        );

        const clean = translations.every(
          (t) =>
            t.slug_valid &&
            !t.slug_transliteration_bug &&
            t.links.needs_fix === 0 &&
            t.links.dead === 0,
        );

        return ok({
          project,
          post_id,
          clean,
          translations,
          note:
            "A slug is flagged when it's invalid OR differs from what its title would " +
            "generate — the latter catches accents dropped to a hyphen (für→f-r) that still " +
            "look valid, though it may also be a deliberate custom slug. Fix links with " +
            "fix_post_links; correct a slug with update_post_translation.",
        });
      }),
  );

  server.registerTool(
    "fix_post_links",
    {
      title: "Rewrite a post translation's internal links",
      description:
        "Localises every internal link in one translation's body to that translation's " +
        "language and writes the result back — the fix companion to audit_post. Dead links " +
        "are left in place (and reported) unless unwrap_unresolved is set, so editor content " +
        "is never silently deleted. Does not touch slug or publish status. Set dry_run to " +
        "preview the change without saving. Requires login.",
      inputSchema: {
        project: projectParam,
        post_id: z.number().int(),
        language_id: z.number().int().describe("Which translation to fix."),
        unwrap_unresolved: z
          .boolean()
          .default(false)
          .describe("Replace a dead link with its text instead of leaving it in place."),
        dry_run: z
          .boolean()
          .default(true)
          .describe("Preview only; do not write. Defaults to true — flip to false to save."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, post_id, language_id, unwrap_unresolved, dry_run }) =>
      guard(async () => {
        if (!dry_run) {
        }

        const response = await get<Envelope<PostDetail>>(
          project,
          `/admin/posts/${post_id}`,
          { language_id },
        );
        const translation = response.data.translations.find(
          (t) => t.language.id === language_id,
        );
        if (!translation) {
          return fail(
            `Post ${post_id} has no translation for language_id ${language_id}.`,
          );
        }

        const langCode = translation.language.code;
        const locales = await getActiveLanguageCodes(project);
        const original = translation.content ?? "";
        const report: Array<{ href: string; action: string; url?: string | null; reason?: string }> = [];

        const frontendUrl = getProject(project).frontendUrl;
        const anchors = [...original.matchAll(ANCHOR_RE)];
        const uniqueHrefs = [
          ...new Set(
            anchors
              .map((m) => hrefOf(m[1] ?? "") ?? "")
              .filter((href) => {
                if (!href) return false;
                if (classifyLinkValue(href)) return false;
                return (
                  hrefToLookupPath(splitLinkSuffix(href).base, frontendUrl, locales) !== null
                );
              }),
          ),
        ];
        const resolutions = new Map(
          await Promise.all(
            uniqueHrefs.map(
              async (href) =>
                [href, await resolveInternalLink(project, href, langCode, locales)] as const,
            ),
          ),
        );

        const rewritten = original.replace(
          ANCHOR_RE,
          (whole: string, openTag: string, inner: string) => {
            const href = hrefOf(openTag);
            if (href === null) return whole;
            const reserved = classifyLinkValue(href);
            if (reserved) {
              report.push({
                href,
                action: "reserved",
                reason: `${reserved.kind} — left verbatim`,
              });
              return whole;
            }
            const res = resolutions.get(href);
            if (!res) {
              return whole;
            }
            if (res.resolved && res.url) {
              if (res.url !== href) {
                report.push({ href, action: "rewritten", url: res.url });
                return `${withHref(openTag, res.url)}${inner}</a>`;
              }
              return whole;
            }
            if (unwrap_unresolved) {
              report.push({ href, action: "unwrapped", reason: res.reason });
              return inner;
            }
            report.push({ href, action: "left_dead", reason: res.reason });
            return whole;
          },
        );

        const changed = rewritten !== original;
        let saved = false;
        if (changed && !dry_run) {
          await put(project, `/admin/posts/${post_id}/translations/${language_id}`, {
            content: rewritten,
          });
          saved = true;
        }

        return ok({
          project,
          post_id,
          language: langCode,
          dry_run,
          changed,
          saved,
          summary: {
            rewritten: report.filter((r) => r.action === "rewritten").length,
            unwrapped: report.filter((r) => r.action === "unwrapped").length,
            left_dead: report.filter((r) => r.action === "left_dead").length,
          },
          report,
          ...(dry_run && changed
            ? { note: "This was a preview. Re-run with dry_run:false to save." }
            : {}),
        });
      }),
  );
}
