import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get } from "../api/client.js";
import type {
  Envelope,
  PostDetail,
  PostListData,
  ServiceListData,
  ServiceDetail,
} from "../api/types.js";
import { auditSlug } from "../lib/slug.js";
import { auditLinks } from "./content-quality.js";
import {
  ok,
  guard,
  projectParam,
  getActiveLanguageCodes,
} from "./helpers.js";

const PAGE_SIZE = 50;

export function registerBulkAuditTools(server: McpServer): void {
  server.registerTool(
    "audit_brand",
    {
      title: "Audit every post (and service slugs) in a brand",
      description:
        "Sweeps a brand's content and returns only the items with problems: posts whose slug " +
        "is invalid or whose body links need fixing / are dead, and services whose slug is " +
        "invalid. Use it to scope the old-content cleanup, then fix each with fix_post_links " +
        "or update_(post|service)_translation. Read-only. Bounded by max_posts / max_services; " +
        "it reports when a cap truncated coverage. Requires login.",
      inputSchema: {
        project: projectParam,
        include_services: z
          .boolean()
          .default(true)
          .describe("Also check service slugs (services have no body links to audit)."),
        status: z
          .enum(["draft", "scheduled", "published"])
          .optional()
          .describe("Restrict to one publish status; omit for all."),
        max_posts: z.number().int().min(1).max(1000).default(200),
        max_services: z.number().int().min(1).max(1000).default(200),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, include_services, status, max_posts, max_services }) =>
      guard(async () => {
        const locales = await getActiveLanguageCodes(project);

        const flaggedPosts: unknown[] = [];
        let postsScanned = 0;
        let postsTotal = 0;
        let page = 1;

        while (postsScanned < max_posts) {
          const list = await get<Envelope<PostListData>>(project, "/admin/posts", {
            status,
            limit: PAGE_SIZE,
            page,
          });
          postsTotal = list.data.total;
          if (list.data.posts.length === 0) break;

          for (const summary of list.data.posts) {
            if (postsScanned >= max_posts) break;
            postsScanned += 1;

            let contentByLang: Map<string, string> | null = null;
            try {
              const detail = await get<Envelope<PostDetail>>(
                project,
                `/admin/posts/${summary.id}`,
                { language_id: summary.translations[0]?.language.id },
              );
              contentByLang = new Map(
                detail.data.translations.map((t) => [t.language.code, t.content ?? ""]),
              );
            } catch {
              contentByLang = null;
            }

            const issues: unknown[] = [];
            for (const t of summary.translations) {
              const slug = auditSlug(t.slug, t.title);
              const content = contentByLang?.get(t.language.code);
              const links =
                content !== undefined
                  ? await auditLinks(project, content, t.language.code, locales)
                  : null;
              const needsFix = links?.filter((l) => l.status === "needs_fix").length ?? 0;
              const dead = links?.filter((l) => l.status === "dead").length ?? 0;
              const linksAudited = links !== null;

              if (slug.needs_review || needsFix > 0 || dead > 0) {
                issues.push({
                  language: t.language.code,
                  language_id: t.language.id,
                  slug: t.slug,
                  slug_valid: slug.valid,
                  slug_transliteration_bug: slug.transliteration_bug,
                  suggested_slug: slug.needs_review ? slug.suggested : undefined,
                  links_needs_fix: needsFix,
                  links_dead: dead,
                  ...(linksAudited ? {} : { links_not_audited: true }),
                });
              }
            }
            if (issues.length > 0) {
              flaggedPosts.push({ post_id: summary.id, status: summary.status, issues });
            }
          }

          if (page >= list.data.total_pages) break;
          page += 1;
        }

        const flaggedServices: unknown[] = [];
        let servicesScanned = 0;
        let servicesTotal = 0;

        if (include_services) {
          let spage = 1;
          while (servicesScanned < max_services) {
            const list = await get<Envelope<ServiceListData>>(
              project,
              "/admin/services",
              { status, limit: PAGE_SIZE, page: spage },
            );
            servicesTotal = list.data.total;
            if (list.data.services.length === 0) break;

            for (const summary of list.data.services) {
              if (servicesScanned >= max_services) break;
              servicesScanned += 1;

              const issues = summary.translations
                .map((t) => ({ t, audit: auditSlug(t.slug, t.title) }))
                .filter(({ audit }) => audit.needs_review)
                .map(({ t, audit }) => ({
                  language: t.language.code,
                  language_id: t.language.id,
                  slug: t.slug,
                  slug_valid: audit.valid,
                  slug_transliteration_bug: audit.transliteration_bug,
                  suggested_slug: audit.suggested,
                }));
              if (issues.length > 0) {
                flaggedServices.push({ service_id: summary.id, issues });
              }
            }

            if (spage >= list.data.total_pages) break;
            spage += 1;
          }
        }

        const postsTruncated = postsScanned < postsTotal;
        const servicesTruncated =
          include_services && servicesScanned < servicesTotal;

        return ok({
          project,
          posts: {
            scanned: postsScanned,
            total: postsTotal,
            truncated: postsTruncated,
            flagged: flaggedPosts,
          },
          services: include_services
            ? {
                scanned: servicesScanned,
                total: servicesTotal,
                truncated: servicesTruncated,
                flagged: flaggedServices,
              }
            : { skipped: true },
          ...(postsTruncated || servicesTruncated
            ? {
                warning:
                  "Coverage was truncated by a cap — raise max_posts / max_services to scan " +
                  "the rest. The un-scanned items are NOT known to be clean.",
              }
            : {}),
        });
      }),
  );
}
