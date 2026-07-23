import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get } from "../api/client.js";
import type {
  Envelope,
  PostDetail,
  PostListData,
  SeoAuditData,
} from "../api/types.js";
import { ok, guard, projectParam } from "./helpers.js";

const BLOCKING_CHECKS = new Set([
  "focus_in_seo_title",
  "focus_in_meta_description",
  "focus_in_slug",
  "focus_used_in_content",
  "content_length",
  "has_internal_links",
  "images_have_alt",
]);

export function registerPostTools(server: McpServer): void {
  server.registerTool(
    "list_posts",
    {
      title: "List blog posts",
      description:
        "Blog posts for a brand, including drafts and scheduled ones. Use it to check " +
        "whether a topic already exists before writing a new post, and to find related-post " +
        "candidates. Requires login.",
      inputSchema: {
        project: projectParam,
        search: z.string().optional().describe("Matches title or excerpt."),
        status: z.enum(["draft", "scheduled", "published"]).optional(),
        language_id: z.number().int().optional(),
        category_id: z.number().int().optional(),
        tag_ids: z.string().optional().describe("Comma-separated tag ids."),
        sort_by: z.string().default("created_at"),
        sort_order: z.enum(["asc", "desc"]).default("desc"),
        limit: z.number().int().min(1).max(100).default(20),
        page: z.number().int().min(1).default(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, ...query }) =>
      guard(async () => {
        const response = await get<Envelope<PostListData>>(
          project,
          "/admin/posts",
          query,
        );
        return ok({
          project,
          total: response.data.total,
          page: response.data.page,
          total_pages: response.data.total_pages,
          posts: response.data.posts.map((post) => ({
            id: post.id,
            status: post.status,
            published_at: post.published_at,
            scheduled_at: post.scheduled_at,
            categories: post.categories.map((category) => category.name),
            tags: post.tags.map((tag) => tag.name),
            translations: post.translations.map((translation) => ({
              language: translation.language.code,
              title: translation.title,
              slug: translation.slug,
              full_path: translation.full_path,
              needs_update: translation.need_update,
            })),
          })),
        });
      }),
  );

  server.registerTool(
    "get_post",
    {
      title: "Read one blog post",
      description:
        "Full detail for a post: content HTML, SEO fields, categories, tags, related posts " +
        "and every translation. Requires login.",
      inputSchema: {
        project: projectParam,
        post_id: z.number().int(),
        language_id: z
          .number()
          .int()
          .optional()
          .describe("Return only this translation instead of all of them."),
        include_content: z
          .boolean()
          .default(true)
          .describe("Set false to skip the content HTML when only metadata is needed."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, post_id, language_id, include_content }) =>
      guard(async () => {
        const response = await get<Envelope<PostDetail>>(
          project,
          `/admin/posts/${post_id}`,
          { language_id },
        );
        const post = response.data;
        return ok({
          project,
          id: post.id,
          status: post.status,
          published_at: post.published_at,
          scheduled_at: post.scheduled_at,
          author: post.author_name,
          reviewer: post.reviewer_name,
          featured_image_id: post.featured_image_id,
          featured_image_url: post.featured_image_url,
          categories: post.categories,
          tags: post.tags,
          related_posts: post.related_posts,
          translations: post.translations.map((translation) => ({
            language: translation.language.code,
            language_id: translation.language.id,
            title: translation.title,
            slug: translation.slug,
            full_path: translation.full_path,
            excerpt: translation.excerpt,
            meta_title: translation.meta_title,
            meta_description: translation.meta_description,
            focus_keyword: translation.focus_keyword,
            canonical_url: translation.canonical_url,
            robots_index: translation.robots_index,
            robots_follow: translation.robots_follow,
            revision_number: translation.revision_number,
            needs_update: translation.need_update,
            content: include_content ? translation.content : undefined,
          })),
        });
      }),
  );

  server.registerTool(
    "seo_audit_post",
    {
      title: "Run the SEO audit on a post",
      description:
        "Runs the backend's own SEO checks — focus keyword placement in title, meta " +
        "description, slug and opening copy; word count; internal and external links; image " +
        "alt text; heading structure. This is the gate a draft must clear before it is " +
        "published, so run it after writing and fix whatever it flags. Requires login.",
      inputSchema: {
        project: projectParam,
        post_id: z.number().int(),
        language_id: z.number().int().optional().describe("Audit one translation only."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, post_id, language_id }) =>
      guard(async () => {
        const response = await get<Envelope<SeoAuditData>>(
          project,
          `/admin/posts/${post_id}/seo-audit`,
          { language_id },
        );

        const translations = response.data.results.map((translation) => {
          const failed = translation.checks.filter((check) => !check.passed);
          const blocking = failed.filter((check) => BLOCKING_CHECKS.has(check.name));
          return {
            language: translation.language.code,
            passed: translation.checks.length - failed.length,
            total: translation.checks.length,
            publish_ready: blocking.length === 0,
            blocking_failures: blocking.map((check) => ({
              check: check.name,
              info: check.info,
            })),
            advisory_failures: failed
              .filter((check) => !BLOCKING_CHECKS.has(check.name))
              .map((check) => ({ check: check.name, info: check.info })),
          };
        });

        return ok({
          project,
          post_id,
          publish_ready: translations.every((translation) => translation.publish_ready),
          translations,
          note:
            "publish_ready reflects the checks this server treats as blocking; " +
            "advisory_failures are worth fixing but do not stop a publish.",
        });
      }),
  );
}
