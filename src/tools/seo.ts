import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post, put, del } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { ok, fail, guard, projectParam, ensureWritable } from "./helpers.js";
import { checkSchemaData, ensureFormats } from "../lib/field-formats.js";

interface SeoSchemaListData {
  seo_schemas?: Array<Record<string, unknown>>;
  schemas?: Array<Record<string, unknown>>;
  total: number;
}

interface CreatedSchema {
  id: number;
}

/**
 * Build a schema.org VideoObject JSON-LD block from plain metadata — no vision,
 * no LLM. Google's VideoObject requires name + description + thumbnailUrl +
 * uploadDate; a content or embed URL is strongly recommended. Duration, when
 * given in seconds, is emitted as an ISO-8601 duration (PT#M#S).
 */
function buildVideoObject(meta: {
  name: string;
  description: string;
  thumbnail_url: string;
  upload_date: string;
  content_url?: string;
  embed_url?: string;
  duration_seconds?: number;
}): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: meta.name,
    description: meta.description,
    thumbnailUrl: meta.thumbnail_url,
    uploadDate: meta.upload_date,
  };
  if (meta.content_url) schema.contentUrl = meta.content_url;
  if (meta.embed_url) schema.embedUrl = meta.embed_url;
  if (typeof meta.duration_seconds === "number" && meta.duration_seconds > 0) {
    const total = Math.round(meta.duration_seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    schema.duration = `PT${m}M${s}S`;
  }
  return schema;
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
        const badFormat = ensureFormats([checkSchemaData(schema_data)]);
        if (badFormat) return fail(badFormat);
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

  server.registerTool(
    "create_seo_schema",
    {
      title: "Create an SEO structured-data schema",
      description:
        "Creates a schema.org (JSON-LD) template for a brand. content_type is the surface it " +
        "applies to (service/article/page). Set is_default to make it the fallback for every " +
        "item of that type; set is_specific + specific_id to bind it to one item. schema_data " +
        "is the raw JSON-LD object and may use the backend's {{title}} / {{excerpt}} " +
        "placeholders. For a video block, prefer create_video_schema. Requires login and a " +
        "write-enabled brand.",
      inputSchema: {
        project: projectParam,
        content_type: z
          .enum(["service", "article", "page"])
          .describe("Surface this schema applies to."),
        schema_data: z
          .record(z.unknown())
          .describe("Raw JSON-LD object, e.g. { '@context': 'https://schema.org', '@type': … }."),
        is_default: z.boolean().optional().describe("Fallback for every item of this type."),
        is_specific: z.boolean().optional().describe("Bind to a single item (needs specific_id)."),
        specific_id: z.number().int().optional().describe("The item id when is_specific is true."),
        name: z.string().optional().describe("Optional label for the admin UI."),
        language_id: z.number().int().optional().describe("Bind to one language; omit for default."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        const badFormat = ensureFormats([checkSchemaData(body.schema_data)]);
        if (badFormat) return fail(badFormat);
        const response = await post<Envelope<CreatedSchema>>(
          project,
          "/admin/seo-schemas",
          body,
        );
        return ok({ project, seo_schema_id: response.data.id, created: true });
      }),
  );

  server.registerTool(
    "create_video_schema",
    {
      title: "Attach a VideoObject schema from metadata",
      description:
        "Generates a schema.org VideoObject JSON-LD block from plain video metadata (no vision, " +
        "no AI) and attaches it. Bind it to a page or service via content_type + specific_id, or " +
        "leave it as the default for the content_type. Google needs name, description, a " +
        "thumbnail URL and an upload date; give a content or embed URL too. duration_seconds is " +
        "converted to the required ISO-8601 duration. Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        content_type: z
          .enum(["service", "article", "page"])
          .default("page")
          .describe("Surface the video lives on."),
        specific_id: z
          .number()
          .int()
          .optional()
          .describe("Bind to one page/service id; omit to make it the default for content_type."),
        name: z.string().describe("Video title."),
        description: z.string().describe("Video description."),
        thumbnail_url: z.string().describe("Absolute URL of the thumbnail image."),
        upload_date: z.string().describe("Publish date, ISO-8601 (e.g. 2026-08-13)."),
        content_url: z.string().optional().describe("Direct URL to the video file."),
        embed_url: z.string().optional().describe("Player embed URL (e.g. a YouTube embed)."),
        duration_seconds: z.number().int().optional().describe("Length in seconds → ISO duration."),
        language_id: z.number().int().optional().describe("Bind to one language; omit for default."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, content_type, specific_id, language_id, ...meta }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        const schema_data = buildVideoObject(meta);
        const response = await post<Envelope<CreatedSchema>>(project, "/admin/seo-schemas", {
          content_type,
          schema_data,
          is_specific: specific_id !== undefined,
          is_default: specific_id === undefined,
          specific_id,
          language_id,
          name: meta.name,
        });
        return ok({ project, seo_schema_id: response.data.id, schema_data, attached: true });
      }),
  );

  server.registerTool(
    "update_seo_schema",
    {
      title: "Update an SEO structured-data schema",
      description:
        "Edits an existing schema.org template. Pass only the fields that change; schema_data " +
        "replaces the whole JSON-LD object. Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        schema_id: z.number().int(),
        content_type: z.enum(["service", "article", "page"]).optional(),
        schema_data: z.record(z.unknown()).optional().describe("Replacement JSON-LD object."),
        is_default: z.boolean().optional(),
        is_specific: z.boolean().optional(),
        specific_id: z.number().int().optional(),
        name: z.string().optional(),
        language_id: z.number().int().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, schema_id, ...body }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        const badFormat = ensureFormats([checkSchemaData(body.schema_data)]);
        if (badFormat) return fail(badFormat);
        await put(project, `/admin/seo-schemas/${schema_id}`, body);
        return ok({ project, schema_id, updated: true });
      }),
  );

  server.registerTool(
    "delete_seo_schema",
    {
      title: "Delete an SEO structured-data schema",
      description:
        "Permanently removes a schema.org template. Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        schema_id: z.number().int(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ project, schema_id }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        await del(project, `/admin/seo-schemas/${schema_id}`);
        return ok({ project, schema_id, deleted: true });
      }),
  );
}
