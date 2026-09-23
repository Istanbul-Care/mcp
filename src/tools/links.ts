import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  resolveInternalLink,
  hrefToLookupPath,
  splitLinkSuffix,
  ANCHOR_RE,
  hrefOf,
  withHref,
} from "../lib/links.js";
import { getProject } from "../config/projects.js";
import {
  classifyLinkValue,
  DISPATCHED_LINK_FIELDS,
  UNDISPATCHED_LINK_FIELDS,
  LEAD_GATED_PATTERNS,
  LINK_VALUE_RECIPES,
  MODAL_DIALOG_PREFIX,
  RESERVED_LINK_VALUES,
} from "../lib/link-values.js";
import { ok, guard, projectParam, getActiveLanguageCodes } from "./helpers.js";

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
    "get_link_conventions",
    {
      title: "Reserved link values the site acts on",
      description:
        "The literal strings that make a link do something other than navigate: open the " +
        "consultation wizard, open a multi-page form, substitute the brand's global CTA, or " +
        "capture a lead before handing the visitor to WhatsApp. Read this before writing any " +
        "button_url, cta_url or menu URL — these values are not validated anywhere, so a " +
        "near miss renders a 404 or a modal that never opens, with no error. Needs no " +
        "authentication.",
      inputSchema: {
        want: z
          .string()
          .optional()
          .describe(
            "Optional plain-language goal, e.g. 'open the consultation wizard'. Returns the " +
              "exact literal to store.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ want }) =>
      guard(async () => {
        const recipes = Object.entries(LINK_VALUE_RECIPES).map(([goal, literal]) => ({
          goal,
          literal,
        }));
        const asked = want?.trim().toLowerCase();
        const matched = asked
          ? recipes.filter(
              (r) =>
                r.goal.includes(asked) ||
                asked.split(/\s+/).filter((w) => w.length > 3).some((w) => r.goal.includes(w)),
            )
          : [];
        return ok({
          ...(asked ? { asked: want, best_match: matched[0] ?? null, other_matches: matched.slice(1) } : {}),
          exact_values: Object.entries(RESERVED_LINK_VALUES).map(([value, spec]) => ({
            value,
            ...spec,
          })),
          prefix_convention: {
            prefix: MODAL_DIALOG_PREFIX,
            effect:
              "Any link starting with this opens a multi-page form, and the whole link is " +
              "sent as the form_code. Create the form with a matching code first.",
          },
          lead_gated_hosts: LEAD_GATED_PATTERNS.map((p) => p.source),
          where_they_work: DISPATCHED_LINK_FIELDS,
          where_they_do_not_work: {
            fields: UNDISPATCHED_LINK_FIELDS,
            why:
              "These render through a plain link component, so a reserved value here is " +
              "treated as a page path and 404s. The panel gives no hint that the two kinds " +
              "of field differ.",
          },
          recipes,
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
              .map((match) => hrefOf(match[1] ?? "") ?? "")
              .filter((href) => {
                if (!href) return false;
                if (classifyLinkValue(href)) return false; // instruction, not a URL
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
                [
                  href,
                  await resolveInternalLink(project, href, target_language, locales),
                ] as const,
            ),
          ),
        );

        const report: Array<{
          href: string;
          action: "rewritten" | "unchanged" | "unwrapped" | "skipped" | "reserved";
          url?: string | null;
          reason?: string;
        }> = [];

        const rewritten = html.replace(
          ANCHOR_RE,
          (whole: string, openTag: string, inner: string) => {
            const href = hrefOf(openTag);
            if (href === null) {
              report.push({ href: "", action: "skipped", reason: "anchor has no href" });
              return whole;
            }
            const reserved = classifyLinkValue(href);
            if (reserved) {
              report.push({
                href,
                action: "reserved",
                reason: `${reserved.kind} — kept verbatim: ${reserved.effect}`,
              });
              return whole;
            }
            const resolution = resolutions.get(href);
            if (!resolution) {
              report.push({ href, action: "skipped", reason: "external or non-page link" });
              return whole;
            }
            if (resolution.resolved && resolution.url) {
              report.push({ href, action: "rewritten", url: resolution.url });
              return `${withHref(openTag, resolution.url)}${inner}</a>`;
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
            reserved: report.filter((entry) => entry.action === "reserved").length,
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
