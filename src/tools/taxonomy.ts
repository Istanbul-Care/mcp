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
  .optional()
  .describe(`${CATEGORY_ICON_TEXT} null removes it; leave it out to keep the current one.`);

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
    title: "Set a blog category's icon",
    description:
      "Sets or removes a blog category's icon — the picture beside its name where a header " +
      "menu lists blog categories (a header item of item_type post_category). Names and " +
      "slugs are per-language: change them with the translation tools (type 'post_category').",
    params: {
      category_id: z.number().int().describe("From list_post_categories."),
      icon_media_id: categoryIconUpdate,
    },
    method: "put",
    path: (a) => `/admin/post-categories/${a.category_id}`,
    body: (a) => ({ icon_media_id: a.icon_media_id }),
    echo: ["category_id", "icon_media_id"],
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
