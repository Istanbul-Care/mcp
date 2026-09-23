import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post, put } from "../api/client.js";
import type { Envelope, PostDetail, SeoAuditData } from "../api/types.js";
import { getSession } from "../auth/session.js";
import { coerceSlug } from "../lib/slug.js";
import { ok, fail, guard, projectParam, ensureWritable } from "./helpers.js";

const BLOCKING_CHECKS = new Set([
  "focus_in_seo_title",
  "focus_in_meta_description",
  "focus_in_slug",
  "focus_used_in_content",
  "content_length",
  "has_internal_links",
  "images_have_alt",
]);

const translationFields = {
  title: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(255)
    .describe("Lowercase ASCII, hyphens only — the leaf slug, without any /blog/ prefix."),
  excerpt: z.string().min(1),
  content: z.string().min(1).describe("Post body as HTML."),
  meta_title: z.string().max(255).optional(),
  meta_description: z.string().max(255).optional(),
  focus_keyword: z
    .string()
    .max(255)
    .optional()
    .describe(
      "One keyword, or several separated by '|'. The site splits on the pipe — a " +
        "comma-separated list is read as a single long keyword.",
    ),
  canonical_url: z.string().max(255).optional(),
  robots_index: z.boolean().default(true),
  robots_follow: z.boolean().default(true),
  related_description: z.string().max(500).optional(),
};

export function registerAuthoringTools(server: McpServer): void {
  server.registerTool(
    "create_post_draft",
    {
      title: "Create a blog post (draft)",
      description:
        "Creates a new blog post in ONE language as a draft. It never publishes — status is " +
        "always 'draft', so the post is invisible on the public site until publish_post is " +
        "called. Add other languages with add_translation or auto_translate. The slug " +
        "is the bare leaf (no /blog/ prefix); the site composes the routable path. Requires " +
        "login and that the brand is write-enabled.",
      inputSchema: {
        project: projectParam,
        language_id: z
          .number()
          .int()
          .describe("Language of this first translation. See list_languages."),
        ...translationFields,
        featured_image_id: z.number().int().optional(),
        banner_image_id: z.number().int().optional(),
        category_ids: z.array(z.number().int()).optional(),
        tag_ids: z.array(z.number().int()).optional(),
        author_id: z
          .number()
          .int()
          .optional()
          .describe(
            "Public byline (the author shown on the site — separate from the record's " +
              "creator). Defaults to the logged-in account when omitted, so posts are not " +
              "attributed to 'unknown'. Pass a different user id to credit someone else.",
          ),
        reviewer_id: z.number().int().optional(),
        allow_comments: z.boolean().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, language_id, featured_image_id, banner_image_id, category_ids, tag_ids, author_id, reviewer_id, allow_comments, ...translation }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        const resolvedAuthorId = author_id ?? getSession(project)?.user.id;

        const { slug: cleanSlug, corrected: slugCorrected } = coerceSlug(translation.slug);
        translation.slug = cleanSlug;

        const response = await post<Envelope<PostDetail>>(project, "/admin/posts", {
          translation: { language_id, ...translation },
          featured_image_id,
          banner_image_id,
          category_ids,
          tag_ids,
          author_id: resolvedAuthorId,
          reviewer_id,
          allow_comments,
          status: "draft",
        });

        const created = response.data;
        return ok({
          project,
          created: true,
          post_id: created.id,
          status: created.status,
          ...(slugCorrected ? { slug_corrected_to: cleanSlug } : {}),
          next_steps: [
            "Add other languages: add_translation or auto_translate",
            `Check quality: seo_audit_post({ project: "${project}", post_id: ${created.id} })`,
            `Go live once the audit passes: publish_post`,
          ],
        });
      }),
  );

  server.registerTool(
    "add_translation",
    {
      title: "Add a language to a post",
      description:
        "Adds one more language translation to an existing post. Use for hand-written " +
        "translations; for machine translation use auto_translate instead. Requires " +
        "login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        post_id: z.number().int(),
        language_id: z.number().int(),
        ...translationFields,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, post_id, language_id, ...translation }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        const { slug: cleanSlug, corrected } = coerceSlug(translation.slug);
        translation.slug = cleanSlug;

        await post(project, `/admin/posts/${post_id}/translations`, {
          language_id,
          ...translation,
        });
        return ok({
          project,
          post_id,
          language_id,
          added: true,
          ...(corrected ? { slug_corrected_to: cleanSlug } : {}),
        });
      }),
  );

  server.registerTool(
    "update_post_translation",
    {
      title: "Edit one translation of a post",
      description:
        "Updates the fields of a single existing translation. Only pass what changes — " +
        "omitted fields are left as-is. Does not change publish status. Requires login and a " +
        "write-enabled brand.",
      inputSchema: {
        project: projectParam,
        post_id: z.number().int(),
        language_id: z.number().int(),
        title: z.string().min(1).max(255).optional(),
        slug: z.string().min(1).max(255).optional(),
        excerpt: z.string().optional(),
        content: z.string().optional(),
        meta_title: z.string().max(255).optional(),
        meta_description: z.string().max(255).optional(),
        focus_keyword: z.string().max(255).optional(),
        canonical_url: z.string().max(255).optional(),
        robots_index: z.boolean().optional(),
        robots_follow: z.boolean().optional(),
        related_description: z.string().max(500).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, post_id, language_id, ...fields }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        let slugCorrected: string | undefined;
        if (fields.slug !== undefined) {
          const { slug: cleanSlug, corrected } = coerceSlug(fields.slug);
          fields.slug = cleanSlug;
          if (corrected) slugCorrected = cleanSlug;
        }

        await put(
          project,
          `/admin/posts/${post_id}/translations/${language_id}`,
          fields,
        );
        return ok({
          project,
          post_id,
          language_id,
          updated: true,
          ...(slugCorrected ? { slug_corrected_to: slugCorrected } : {}),
        });
      }),
  );

  server.registerTool(
    "set_post_metadata",
    {
      title: "Set a post's categories, tags, related posts or images",
      description:
        "Updates the post-level (not per-translation) fields: categories, tags, related " +
        "posts, images, author, reviewer. Arrays REPLACE the existing set — pass the full " +
        "list, or an empty array to clear. Does not change publish status. Requires login " +
        "and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        post_id: z.number().int(),
        category_ids: z.array(z.number().int()).optional(),
        tag_ids: z.array(z.number().int()).optional(),
        related_post_ids: z
          .array(z.number().int())
          .optional()
          .describe("Ordered; replaces the current related-post list."),
        featured_image_id: z.number().int().nullable().optional(),
        banner_image_id: z.number().int().nullable().optional(),
        author_id: z.number().int().nullable().optional(),
        reviewer_id: z.number().int().nullable().optional(),
        allow_comments: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, post_id, ...fields }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        await put(project, `/admin/posts/${post_id}`, fields);
        return ok({ project, post_id, updated: true });
      }),
  );

  server.registerTool(
    "publish_post",
    {
      title: "Publish (or schedule) a post — SEO-gated",
      description:
        "Takes a draft live. Before flipping status it runs the SEO audit and REFUSES if any " +
        "blocking check fails, so a thin or broken post cannot reach the public site. Pass " +
        "force:true to publish anyway (records why in the response). To schedule instead of " +
        "publishing now, pass scheduled_at as an ISO timestamp. Requires login and a " +
        "write-enabled brand.",
      inputSchema: {
        project: projectParam,
        post_id: z.number().int(),
        scheduled_at: z
          .string()
          .optional()
          .describe("ISO 8601 timestamp to schedule for; omit to publish immediately."),
        force: z
          .boolean()
          .default(false)
          .describe("Bypass the SEO gate. Use only deliberately."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, post_id, scheduled_at, force }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        let auditSummary: unknown = "skipped (force=true)";
        if (!force) {
          const audit = await get<Envelope<SeoAuditData>>(
            project,
            `/admin/posts/${post_id}/seo-audit`,
          );
          const failing = audit.data.results
            .map((translation) => ({
              language: translation.language.code,
              blocking: translation.checks
                .filter((check) => !check.passed && BLOCKING_CHECKS.has(check.name))
                .map((check) => check.name),
            }))
            .filter((entry) => entry.blocking.length > 0);

          if (failing.length > 0) {
            return fail(
              JSON.stringify(
                {
                  project,
                  post_id,
                  published: false,
                  reason: "SEO audit has blocking failures — not published.",
                  failing,
                  hint:
                    "Fix these and retry, or call publish_post with force:true to override.",
                },
                null,
                2,
              ),
            );
          }
          auditSummary = "passed";
        }

        const status = scheduled_at ? "scheduled" : "published";
        await put(project, `/admin/posts/${post_id}`, { status, scheduled_at });

        return ok({
          project,
          post_id,
          published: !scheduled_at,
          scheduled: Boolean(scheduled_at),
          status,
          scheduled_at: scheduled_at ?? null,
          seo_gate: auditSummary,
          forced: force,
        });
      }),
  );

  server.registerTool(
    "unpublish_post",
    {
      title: "Return a post to draft",
      description:
        "Flips a published or scheduled post back to draft, removing it from the public " +
        "site without deleting it. The reversible counterpart to publish_post. Requires " +
        "login and a write-enabled brand.",
      inputSchema: { project: projectParam, post_id: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ project, post_id }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        await put(project, `/admin/posts/${post_id}`, { status: "draft" });
        return ok({ project, post_id, status: "draft", unpublished: true });
      }),
  );
}
