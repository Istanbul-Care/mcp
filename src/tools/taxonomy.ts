import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { post } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { coerceSlug } from "../lib/slug.js";
import { ok, guard, projectParam, registerWrite } from "./helpers.js";

const slugField = z
  .string()
  .min(1)
  .max(255)
  .describe("Lowercase ASCII, hyphens only.");

/**
 * A category's icon is a media row the site draws beside the category's name
 * where a header menu lists categories (a header item of item_type
 * service_category / post_category). On an update, null clears it and
 * leaving the key out keeps it.
 */
const CATEGORY_ICON_TEXT =
  "Icon shown next to this category in the site header's menus (where a header item lists " +
  "categories): a media id from upload_media (an SVG or PNG; square works best).";

const categoryIconUpdate = z
  .number()
  .int()
  .nullable()
  .describe(`${CATEGORY_ICON_TEXT} null removes it.`);

/**
 * A blog category can have a sitemap of its own (Ali, 2026-10-22): its posts
 * leave posts-sitemap.xml for <sitemap_name>-sitemap.xml, and its list page
 * (e.g. the News page) leaves pages-sitemap.xml to head that sitemap.
 */
const RESERVED_SITEMAP_NAMES = ["pages", "posts", "services", "image", "video", "blogs"];

const sitemapNameUpdate = z
  .string()
  .max(40)
  .regex(/^$|^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and hyphens")
  .refine((name) => !RESERVED_SITEMAP_NAMES.includes(name), {
    message: `not one of the site's own sitemaps (${RESERVED_SITEMAP_NAMES.join(", ")})`,
  })
  .nullable()
  .describe(
    "Gives the category's posts a sitemap of their own, <name>-sitemap.xml (e.g. 'news'), and " +
      "takes them out of posts-sitemap.xml. Lowercase letters, digits and hyphens; categories " +
      "may share a name. null or '' puts the posts back in the posts sitemap.",
  );

const sitemapPageUpdate = z
  .number()
  .int()
  .positive()
  .nullable()
  .describe(
    "The page that lists the category's posts (a page id, e.g. the News page). With a sitemap " +
      "name it leaves pages-sitemap.xml and comes first in the category's own sitemap, in every " +
      "language it is indexable in — so that sitemap exists even before any post is indexable. " +
      "null removes it.",
  );

interface CreatedCategory {
  id: number;
}
interface CreatedTag {
  id: number;
}

export function registerTaxonomyTools(server: McpServer): void {
  server.registerTool(
    "create_post_category",
    {
      title: "Create a blog category",
      description:
        "Creates a new blog category in one language. Only use it when list_post_categories " +
        "shows the category you need does not exist. Add sibling-language names with " +
        "add_category_translation. Requires login.",
      inputSchema: {
        project: projectParam,
        name: z.string().min(1).max(255),
        slug: slugField,
        description: z.string().max(500).optional(),
        parent_id: z.number().int().optional().describe("Parent category id for nesting."),
        language_id: z
          .number()
          .int()
          .optional()
          .describe("Language of this first translation; defaults to the brand's default."),
        order: z.number().int().min(0).default(0),
        icon_media_id: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe(`${CATEGORY_ICON_TEXT} Leave it out for no icon.`),
        sitemap_name: sitemapNameUpdate.optional(),
        sitemap_page_id: sitemapPageUpdate.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) =>
      guard(async () => {
        const { slug, corrected } = coerceSlug(body.slug);
        body.slug = slug;
        const response = await post<Envelope<CreatedCategory>>(
          project,
          "/admin/post-categories",
          body,
        );
        return ok({
          project,
          created: true,
          category_id: response.data.id,
          ...(corrected ? { slug_corrected_to: slug } : {}),
        });
      }),
  );

  registerWrite(server, {
    name: "update_post_category",
    title: "Set a blog category's icon and sitemap",
    description:
      "Sets or removes a blog category's icon — the picture beside its name where a header " +
      "menu lists blog categories (a header item of item_type post_category) — and its own " +
      "sitemap: sitemap_name (its posts leave posts-sitemap.xml for <name>-sitemap.xml) and " +
      "sitemap_page_id (the page listing them, which then heads that sitemap). Only the fields " +
      "you pass change; every sitemap is rebuilt when the sitemap fields change. Names and " +
      "slugs are per-language: change them with the translation tools (type 'post_category').",
    params: {
      category_id: z.number().int().describe("From list_post_categories."),
      icon_media_id: categoryIconUpdate.optional(),
      sitemap_name: sitemapNameUpdate.optional(),
      sitemap_page_id: sitemapPageUpdate.optional(),
    },
    checks: (a) =>
      a.icon_media_id === undefined &&
      a.sitemap_name === undefined &&
      a.sitemap_page_id === undefined
        ? "Nothing to change: pass icon_media_id, sitemap_name or sitemap_page_id."
        : null,
    method: "put",
    path: (a) => `/admin/post-categories/${a.category_id}`,
    body: (a) => ({
      icon_media_id: a.icon_media_id,
      sitemap_name: a.sitemap_name === "" ? null : a.sitemap_name,
      sitemap_page_id: a.sitemap_page_id,
    }),
    echo: ["category_id", "icon_media_id", "sitemap_name", "sitemap_page_id"],
  });

  registerWrite(server, {
    name: "update_service_category",
    title: "Set a service category's icon",
    description:
      "Sets or removes a service category's icon — the picture beside its name where a " +
      "header menu lists service categories (a header item of item_type service_category). " +
      "Names and slugs are per-language: change them with the translation tools (type " +
      "'service_category').",
    params: {
      category_id: z.number().int().describe("From list_service_categories."),
      icon_media_id: categoryIconUpdate,
    },
    method: "put",
    path: (a) => `/admin/service-categories/${a.category_id}`,
    body: (a) => ({ icon_media_id: a.icon_media_id }),
    echo: ["category_id", "icon_media_id"],
  });

  server.registerTool(
    "add_category_translation",
    {
      title: "Translate a blog category",
      description:
        "Adds a name/slug for another language to an existing category. Requires login.",
      inputSchema: {
        project: projectParam,
        category_id: z.number().int(),
        language_id: z.number().int(),
        name: z.string().min(1).max(255),
        slug: slugField,
        description: z.string().max(500).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, category_id, ...body }) =>
      guard(async () => {
        const { slug, corrected } = coerceSlug(body.slug);
        body.slug = slug;
        await post(project, `/admin/post-categories/${category_id}/translations`, body);
        return ok({
          project,
          category_id,
          language_id: body.language_id,
          added: true,
          ...(corrected ? { slug_corrected_to: slug } : {}),
        });
      }),
  );

  server.registerTool(
    "create_tag",
    {
      title: "Create a blog tag",
      description:
        "Creates a new blog tag in one language. Only use it when list_tags shows the tag " +
        "does not exist. Add sibling-language names with add_tag_translation. Requires login.",
      inputSchema: {
        project: projectParam,
        name: z.string().min(1).max(255),
        slug: slugField,
        language_id: z
          .number()
          .int()
          .optional()
          .describe("Language of this first translation; defaults to the brand's default."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) =>
      guard(async () => {
        const { slug, corrected } = coerceSlug(body.slug);
        body.slug = slug;
        const response = await post<Envelope<CreatedTag>>(project, "/admin/tags", body);
        return ok({
          project,
          created: true,
          tag_id: response.data.id,
          ...(corrected ? { slug_corrected_to: slug } : {}),
        });
      }),
  );

  server.registerTool(
    "add_tag_translation",
    {
      title: "Translate a blog tag",
      description:
        "Adds a name/slug for another language to an existing tag. Requires login.",
      inputSchema: {
        project: projectParam,
        tag_id: z.number().int(),
        language_id: z.number().int(),
        name: z.string().min(1).max(255),
        slug: slugField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, tag_id, ...body }) =>
      guard(async () => {
        const { slug, corrected } = coerceSlug(body.slug);
        body.slug = slug;
        await post(project, `/admin/tags/${tag_id}/translations`, body);
        return ok({
          project,
          tag_id,
          language_id: body.language_id,
          added: true,
          ...(corrected ? { slug_corrected_to: slug } : {}),
        });
      }),
  );
}
