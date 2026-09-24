import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { post } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { coerceSlug } from "../lib/slug.js";
import { ok, guard, projectParam } from "./helpers.js";

const slugField = z
  .string()
  .min(1)
  .max(255)
  .describe("Lowercase ASCII, hyphens only.");

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
