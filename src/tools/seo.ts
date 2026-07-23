import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { ok, fail, guard, projectParam, ensureWritable } from "./helpers.js";

interface SeoSchemaListData {
  seo_schemas?: Array<Record<string, unknown>>;
  schemas?: Array<Record<string, unknown>>;
  total: number;
}

interface CreatedSchema {
  id: number;
}

export function registerSeoTools(server: McpServer): void {
  server.registerTool(
    "list_seo_schemas",
    {
      title: "List SEO structured-data schemas",
      description:
        "Lists the schema.org templates configured for a brand. Filter by content_type " +
        "'article' to see what blog posts use — the default article schema, plus any " +
        "post-specific ones. Requires login.",
      inputSchema: {
        project: projectParam,
        content_type: z.enum(["article", "service", "page"]).optional(),
        is_default: z.boolean().optional(),
        is_specific: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, ...query }) =>
      guard(async () => {
        const response = await get<Envelope<SeoSchemaListData>>(
          project,
          "/admin/seo-schemas",
          query,
        );
        const rows = response.data.seo_schemas ?? response.data.schemas ?? [];
        return ok({ project, total: response.data.total, schemas: rows });
      }),
  );

  server.registerTool(
    "set_post_seo_schema",
    {
      title: "Give a post custom structured data",
      description:
        "Attaches a post-specific schema.org (JSON-LD) block to a blog post, overriding the " +
        "default article schema for that post. schema_data is raw JSON-LD and may use the " +
        "backend's {{title}} / {{excerpt}} placeholders. Most posts do NOT need this — the " +
        "default article schema already covers them — so use it only when a post needs " +
        "bespoke structured data. Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        post_id: z.number().int().describe("The post this schema is specific to."),
        schema_data: z
          .record(z.unknown())
          .describe("JSON-LD object, e.g. { '@context': 'https://schema.org', '@type': 'Article', … }."),
        language_id: z
          .number()
          .int()
          .optional()
          .describe("Bind the schema to one language; omit for the default language."),
        name: z.string().optional().describe("Optional label for the admin UI."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, post_id, schema_data, language_id, name }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        const response = await post<Envelope<CreatedSchema>>(
          project,
          "/admin/seo-schemas",
          {
            content_type: "article",
            is_specific: true,
            is_default: false,
            specific_id: post_id,
            schema_data,
            language_id,
            name,
          },
        );
        return ok({
          project,
          post_id,
          seo_schema_id: response.data.id,
          attached: true,
        });
      }),
  );
}
