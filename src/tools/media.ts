/**
 * Media — the image/video library.
 *
 * The backend is fully upload-capable (`POST /admin/media` for files,
 * `/admin/media/external` for external URLs / videos), it just had no MCP
 * surface. These tools give the agent that surface: browse the library, upload a
 * local image, or reference an external video, then use the returned id as a
 * post's `featured_image_id` or an in-page image.
 *
 * Alt text: the upload takes the default-language `alt` directly. Alt in OTHER
 * languages is a translation surface — fill it with translation_worklist /
 * save_translations (type "media"), same as any other translatable row.
 */

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, postForm } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { ok, fail, guard, projectParam, ensureWritable } from "./helpers.js";

interface MediaItem {
  id: number;
  media_type: string;
  url?: string | null;
  thumbnail_url?: string | null;
  original_filename?: string | null;
  width?: number | null;
  height?: number | null;
  size_bytes?: number | null;
}

interface MediaListResponse {
  status: string;
  data: MediaItem[];
  total: number;
  page: number;
  total_pages: number;
}

/** Guess a MIME type from the file extension for the multipart part. */
const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
};

function mimeFor(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function summarise(item: MediaItem): Record<string, unknown> {
  return {
    id: item.id,
    type: item.media_type,
    url: item.url,
    thumbnail_url: item.thumbnail_url,
    filename: item.original_filename,
    ...(item.width && item.height ? { dimensions: `${item.width}x${item.height}` } : {}),
  };
}

export function registerMediaTools(server: McpServer): void {
  server.registerTool(
    "list_media",
    {
      title: "Browse the media library",
      description:
        "Lists images and videos in a brand's media library, so an existing asset can be " +
        "reused (as a post's featured image or an in-page image) instead of re-uploading. " +
        "Search by filename/alt. Requires login.",
      inputSchema: {
        project: projectParam,
        search: z.string().optional().describe("Matches filename or alt text."),
        media_type: z.enum(["image", "video"]).optional(),
        limit: z.number().int().min(1).max(100).default(20),
        page: z.number().int().min(1).default(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, ...query }) =>
      guard(async () => {
        const response = await get<MediaListResponse>(project, "/admin/media", query);
        // Media list puts the rows in `data` and pagination beside it.
        const items = Array.isArray(response.data) ? response.data : [];
        return ok({
          project,
          total: response.total,
          page: response.page,
          total_pages: response.total_pages,
          media: items.map(summarise),
        });
      }),
  );

  server.registerTool(
    "upload_media",
    {
      title: "Upload an image to the media library",
      description:
        "Uploads a local image file into a brand's media library and returns its id — use " +
        "that id as a post's featured_image_id or an in-page image. Converts to WebP by " +
        "default. Provide alt text in the brand's default language here; other languages are " +
        "filled later via the translation tools (type 'media'). Requires login and a " +
        "write-enabled brand.",
      inputSchema: {
        project: projectParam,
        file_path: z
          .string()
          .describe("Absolute path to the image file on this machine."),
        alt: z
          .string()
          .optional()
          .describe("Alt text in the brand's default language. Strongly recommended for SEO."),
        name: z.string().optional().describe("Display name; defaults to the filename."),
        convert_to_webp: z.boolean().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, file_path, alt, name, convert_to_webp }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        let bytes: Buffer;
        try {
          bytes = readFileSync(file_path);
        } catch (error) {
          return fail(
            `Cannot read '${file_path}': ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        const form = new FormData();
        const filename = basename(file_path);
        form.append("file", new Blob([bytes], { type: mimeFor(file_path) }), filename);
        if (alt) form.append("alt", alt);
        form.append("name", name ?? filename);
        form.append("convert_to_webp", String(convert_to_webp));

        const response = await postForm<Envelope<MediaItem>>(project, "/admin/media", form);
        return ok({
          project,
          uploaded: true,
          ...summarise(response.data),
          ...(alt ? {} : { note: "No alt text set — add one for SEO/accessibility." }),
        });
      }),
  );

  server.registerTool(
    "add_external_media",
    {
      title: "Reference an external video or image URL",
      description:
        "Registers an external URL (e.g. a YouTube video, or an image already hosted " +
        "elsewhere) as a media item without downloading it. Returns the media id. For " +
        "uploading a local image file, use upload_media instead. Requires login and a " +
        "write-enabled brand.",
      inputSchema: {
        project: projectParam,
        external_url: z.string().url().describe("The external URL, e.g. a YouTube link."),
        media_type: z.enum(["video", "image"]).default("video"),
        alt: z.string().optional().describe("Alt text / description in the default language."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, external_url, media_type, alt }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        const form = new FormData();
        // The endpoint takes a JSON blob under the `request` multipart field.
        form.append("request", JSON.stringify({ external_url, media_type, alt: alt ?? null }));

        const response = await postForm<Envelope<MediaItem>>(
          project,
          "/admin/media/external",
          form,
        );
        return ok({ project, added: true, ...summarise(response.data) });
      }),
  );
}
