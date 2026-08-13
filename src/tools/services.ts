import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post, put } from "../api/client.js";
import type {
  Envelope,
  ServiceDetail,
  ServiceListData,
  SeoAuditData,
} from "../api/types.js";
import { slugify, isValidSlug, auditSlug, coerceSlug } from "../lib/slug.js";
import { ok, fail, guard, projectParam, ensureWritable } from "./helpers.js";

/** Blocking SEO checks — shared with posts. */
const BLOCKING_CHECKS = new Set([
  "focus_in_seo_title",
  "focus_in_meta_description",
  "focus_in_slug",
  "focus_used_in_content",
  "content_length",
  "has_internal_links",
  "images_have_alt",
]);

export function registerServiceTools(server: McpServer): void {
  server.registerTool(
    "list_services",
    {
      title: "List services",
      description:
        "Services for a brand, including drafts. Each translation carries the composed " +
        "full_path (the routable URL). Requires login.",
      inputSchema: {
        project: projectParam,
        search: z.string().optional(),
        status: z.enum(["draft", "scheduled", "published"]).optional(),
        language_id: z.number().int().optional(),
        category_id: z.number().int().optional(),
        sort_by: z.string().default("created_at"),
        sort_order: z.enum(["asc", "desc"]).default("desc"),
        limit: z.number().int().min(1).max(100).default(20),
        page: z.number().int().min(1).default(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, ...query }) =>
      guard(async () => {
        const response = await get<Envelope<ServiceListData>>(
          project,
          "/admin/services",
          query,
        );
        return ok({
          project,
          total: response.data.total,
          page: response.data.page,
          total_pages: response.data.total_pages,
          services: response.data.services.map((service) => ({
            id: service.id,
            status: service.status,
            categories: service.categories.map((c) => c.name),
            translations: service.translations.map((t) => ({
              language: t.language.code,
              title: t.title,
              slug: t.slug,
              full_path: t.full_path,
            })),
          })),
        });
      }),
  );

  server.registerTool(
    "create_service",
    {
      title: "Create a service (draft)",
      description:
        "Creates a service in ONE language as a draft — invisible on the public site until " +
        "published. A service's body lives in its cards, so pass card_ids to attach existing " +
        "cards (or add them later). The slug is the bare leaf; the site composes the routable " +
        "path from the category chain. Add other languages with the translation tools. " +
        "Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        language_id: z.number().int().describe("Language of this first translation. See list_languages."),
        title: z.string().min(1).max(255),
        slug: z
          .string()
          .min(1)
          .max(255)
          .describe("Lowercase ASCII, hyphens only — the leaf slug, no category prefix."),
        excerpt: z.string().min(1),
        meta_title: z.string().max(255).optional(),
        meta_description: z.string().max(255).optional(),
        focus_keyword: z.string().max(255).optional(),
        canonical_url: z.string().max(255).optional(),
        robots_index: z.boolean().default(true),
        robots_follow: z.boolean().default(true),
        category_ids: z.array(z.number().int()).optional(),
        card_ids: z.array(z.number().int()).optional().describe("Existing cards to attach as the body."),
        featured_image_id: z.number().int().optional(),
        banner_image_id: z.number().int().optional(),
        sort_order: z.number().int().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({
      project,
      language_id,
      category_ids,
      card_ids,
      featured_image_id,
      banner_image_id,
      sort_order,
      ...translation
    }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        const { slug: cleanSlug, corrected } = coerceSlug(translation.slug);
        translation.slug = cleanSlug;

        const response = await post<Envelope<ServiceDetail>>(project, "/admin/services", {
          translation: { language_id, ...translation },
          category_ids,
          card_ids,
          featured_image_id,
          banner_image_id,
          sort_order,
          status: "draft",
        });
        return ok({
          project,
          created: true,
          service_id: response.data.id,
          status: response.data.status,
          ...(corrected ? { slug_corrected_to: cleanSlug } : {}),
          next_steps: [
            "Add other languages: auto_translate or update_service_translation",
            "Attach body cards via card_ids (or the card tools)",
          ],
        });
      }),
  );

  server.registerTool(
    "get_service",
    {
      title: "Read one service",
      description:
        "Full detail for a service: SEO fields, categories and every translation with its " +
        "composed full_path. Requires login.",
      inputSchema: {
        project: projectParam,
        service_id: z.number().int(),
        language_id: z.number().int().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, service_id, language_id }) =>
      guard(async () => {
        const response = await get<Envelope<ServiceDetail>>(
          project,
          `/admin/services/${service_id}`,
          { language_id },
        );
        const service = response.data;
        return ok({
          project,
          id: service.id,
          status: service.status,
          categories: service.categories,
          translations: service.translations.map((t) => ({
            language: t.language.code,
            language_id: t.language.id,
            title: t.title,
            slug: t.slug,
            full_path: t.full_path,
            excerpt: t.excerpt,
            meta_title: t.meta_title,
            meta_description: t.meta_description,
            focus_keyword: t.focus_keyword,
            canonical_url: t.canonical_url,
            robots_index: t.robots_index,
            robots_follow: t.robots_follow,
          })),
        });
      }),
  );

  server.registerTool(
    "seo_audit_service",
    {
      title: "Run the SEO audit on a service",
      description:
        "Runs the backend's SEO checks on a service, split into blocking vs advisory — the " +
        "same gate posts use. Requires login.",
      inputSchema: {
        project: projectParam,
        service_id: z.number().int(),
        language_id: z.number().int().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, service_id, language_id }) =>
      guard(async () => {
        const response = await get<Envelope<SeoAuditData>>(
          project,
          `/admin/services/${service_id}/seo-audit`,
          { language_id },
        );
        const translations = response.data.results.map((t) => {
          const failed = t.checks.filter((c) => !c.passed);
          const blocking = failed.filter((c) => BLOCKING_CHECKS.has(c.name));
          return {
            language: t.language.code,
            passed: t.checks.length - failed.length,
            total: t.checks.length,
            publish_ready: blocking.length === 0,
            blocking_failures: blocking.map((c) => ({ check: c.name, info: c.info })),
            advisory_failures: failed
              .filter((c) => !BLOCKING_CHECKS.has(c.name))
              .map((c) => ({ check: c.name, info: c.info })),
          };
        });
        return ok({
          project,
          service_id,
          publish_ready: translations.every((t) => t.publish_ready),
          translations,
        });
      }),
  );

  server.registerTool(
    "update_service_translation",
    {
      title: "Edit one translation of a service",
      description:
        "Updates the fields of a single service translation (title, slug, meta, excerpt, " +
        "robots). Only pass what changes. Use it to correct an invalid slug found by " +
        "audit_service. Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        service_id: z.number().int(),
        language_id: z.number().int(),
        title: z.string().min(1).max(255).optional(),
        slug: z.string().min(1).max(255).optional(),
        excerpt: z.string().optional(),
        meta_title: z.string().max(255).optional(),
        meta_description: z.string().max(255).optional(),
        focus_keyword: z.string().max(255).optional(),
        canonical_url: z.string().max(255).optional(),
        robots_index: z.boolean().optional(),
        robots_follow: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, service_id, language_id, ...fields }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        let slugCorrected: string | undefined;
        if (fields.slug && !isValidSlug(fields.slug)) {
          slugCorrected = slugify(fields.slug);
          fields.slug = slugCorrected;
        }

        await put(
          project,
          `/admin/services/${service_id}/translations/${language_id}`,
          fields,
        );
        return ok({
          project,
          service_id,
          language_id,
          updated: true,
          ...(slugCorrected ? { slug_corrected_to: slugCorrected } : {}),
        });
      }),
  );

  server.registerTool(
    "audit_service",
    {
      title: "Audit a service's slugs",
      description:
        "Reads a service and reports, per translation, whether its slug is URL-safe " +
        "(flagging raw accents / invalid characters with a suggested fix). Note: a service's " +
        "body links live in its cards, not in the translation, so they are NOT audited here — " +
        "this covers slugs only. Read-only. Requires login.",
      inputSchema: {
        project: projectParam,
        service_id: z.number().int(),
        language_id: z.number().int().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, service_id, language_id }) =>
      guard(async () => {
        const response = await get<Envelope<ServiceDetail>>(
          project,
          `/admin/services/${service_id}`,
          { language_id },
        );
        const translations = response.data.translations.map((t) => {
          const slug = auditSlug(t.slug, t.title);
          return {
            language: t.language.code,
            language_id: t.language.id,
            slug: t.slug,
            slug_valid: slug.valid,
            slug_transliteration_bug: slug.transliteration_bug,
            suggested_slug: slug.needs_review ? slug.suggested : undefined,
          };
        });
        return ok({
          project,
          service_id,
          clean: translations.every((t) => t.slug_valid && !t.slug_transliteration_bug),
          translations,
          note:
            "A slug is flagged when invalid OR different from what its title would generate " +
            "(catches accents dropped to a hyphen, e.g. für→f-r). Body links live in cards " +
            "and are not covered by this audit.",
        });
      }),
  );
}
