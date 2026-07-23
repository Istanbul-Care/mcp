import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { resolveInternalLink, hrefToLookupPath } from "../lib/links.js";
import { getProject } from "../config/projects.js";
import { ok, guard, projectParam, getActiveLanguageCodes } from "./helpers.js";

const ANCHOR_RE = /<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis;

export function registerLinkTools(server: McpServer): void {
  server.registerTool(
    "resolve_internal_link",
    {
      title: "Resolve an internal link to its SEO URL",
      description:
        "Turns a slug, path or full URL into the correct public URL for one language — " +
        "container prefix, category chain, locale prefix and trailing slash all applied. " +
        "Use it for every internal link before putting it in content; do not build blog or " +
        "service URLs by hand. Needs no authentication.",
      inputSchema: {
        project: projectParam,
        href: z
          .string()
          .min(1)
          .describe("A bare slug, a site-relative path, or an absolute URL on the brand's domain."),
        target_language: z.string().min(1).describe("Language code the URL should be in."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, href, target_language }) =>
      guard(async () => {
        const locales = await getActiveLanguageCodes(project);
        const normalised = /^(https?:)?\/\//i.test(href) || href.startsWith("/")
          ? href
          : `/${href}`;
        const result = await resolveInternalLink(
          project,
          normalised,
          target_language,
          locales,
        );
        return ok({
          project,
          target_language,
          input: href,
          ...result,
          absolute_url: result.url
            ? `${getProject(project).frontendUrl.replace(/\/+$/, "")}${result.url}`
            : null,
        });
      }),
  );

  server.registerTool(
    "localize_content_links",
    {
      title: "Rewrite every internal link in an HTML block",
      description:
        "Scans HTML for anchors and rewrites each internal one to its correct URL in the " +
        "target language. Links whose target has no translation in that language, or that " +
        "point at nothing, are reported so the caller can unwrap them — the tool never " +
        "silently leaves a dead link in place. Returns the rewritten HTML plus a per-link " +
        "report. Needs no authentication.",
      inputSchema: {
        project: projectParam,
        html: z.string().min(1),
        target_language: z.string().min(1),
        unwrap_unresolved: z
          .boolean()
          .default(false)
          .describe(
            "When true, an unresolvable anchor is replaced by its own text, matching what " +
              "the backend's auto-translate does. When false the anchor is left untouched " +
              "and only reported.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, html, target_language, unwrap_unresolved }) =>
      guard(async () => {
        const locales = await getActiveLanguageCodes(project);
        const { frontendUrl } = getProject(project);

        const anchors = [...html.matchAll(ANCHOR_RE)];
        const uniqueHrefs = [
          ...new Set(
            anchors
              .map((match) => match[1] ?? "")
              .filter((href) => hrefToLookupPath(href, frontendUrl, locales) !== null),
          ),
        ];

        const resolutions = new Map(
          await Promise.all(
            uniqueHrefs.map(
              async (href) =>
                [
                  href,
                  await resolveInternalLink(project, href, target_language, locales),
                ] as const,
            ),
          ),
        );

        const report: Array<{
          href: string;
          action: "rewritten" | "unchanged" | "unwrapped" | "skipped";
          url?: string | null;
          reason?: string;
        }> = [];

        const rewritten = html.replace(
          ANCHOR_RE,
          (whole: string, href: string, inner: string) => {
            const resolution = resolutions.get(href);
            if (!resolution) {
              report.push({ href, action: "skipped", reason: "external or non-page link" });
              return whole;
            }
            if (resolution.resolved && resolution.url) {
              report.push({ href, action: "rewritten", url: resolution.url });
              return `<a href="${resolution.url}">${inner}</a>`;
            }
            if (unwrap_unresolved) {
              report.push({ href, action: "unwrapped", reason: resolution.reason });
              return inner;
            }
            report.push({ href, action: "unchanged", reason: resolution.reason });
            return whole;
          },
        );

        const problems = report.filter(
          (entry) => entry.action === "unchanged" || entry.action === "unwrapped",
        );

        return ok({
          project,
          target_language,
          html: rewritten,
          changed: rewritten !== html,
          summary: {
            anchors_found: anchors.length,
            rewritten: report.filter((entry) => entry.action === "rewritten").length,
            unresolved: problems.length,
            skipped: report.filter((entry) => entry.action === "skipped").length,
          },
          report,
          ...(problems.length > 0
            ? {
                warning:
                  "Some internal links could not be resolved. Fix or remove them before " +
                  "publishing — an unresolved link is usually a dead URL.",
              }
            : {}),
        });
      }),
  );
}
