/**
 * Taking content down, putting it back, and moving many rows at once.
 *
 * The panel has two different ways to remove something and they are not
 * interchangeable:
 *
 *   deactivate  — a soft delete. The row stays, its URL stops resolving
 *                 (the backend nulls every full_path so the page 404s before
 *                 the next recompute), and restore brings it back intact.
 *   delete      — permanent, with the translations and the relations.
 *
 * Anything an editor might want back is a deactivate. Delete is for content
 * that was never meant to exist. Either way the page cache is invalidated by
 * the backend, so nothing here needs a cache step afterwards.
 *
 * Taking a page down is also an SEO decision: a URL that used to rank should
 * get a redirect (create_redirect) rather than a bare 404, and a page that is
 * only temporarily wrong is better left up with robots_index off — which is
 * what the bulk tools at the bottom are for.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerWrite } from "./helpers.js";

const languageId = z
  .number()
  .int()
  .describe("Numeric language id — call list_languages, not a language code.");

interface Kind {
  /** Singular, for tool names and the id parameter. */
  entity: string;
  /** URL segment. */
  collection: string;
  /** Human label. */
  label: string;
}

const KINDS: Kind[] = [
  { entity: "post", collection: "posts", label: "blog post" },
  { entity: "page", collection: "pages", label: "page" },
  { entity: "service", collection: "services", label: "service" },
];

export function registerLifecycleTools(server: McpServer): void {
  for (const { entity, collection, label } of KINDS) {
    const idParam = `${entity}_id`;

    registerWrite(server, {
      name: `deactivate_${entity}`,
      title: `Take a ${label} offline`,
      description:
        `Soft-deletes the ${label}: it disappears from the site and its URL stops resolving, ` +
        `but every translation is kept and restore_${entity} brings it back. This is what to ` +
        `use unless the content was a mistake. If the URL had traffic, add a redirect to ` +
        `wherever the content moved.`,
      params: { [idParam]: z.number().int() },
      method: "post",
      path: (a) => `/admin/${collection}/${a[idParam]}/deactivate`,
      destructive: true,
      echo: [idParam],
    });

    registerWrite(server, {
      name: `restore_${entity}`,
      title: `Put a ${label} back online`,
      description: `Undoes deactivate_${entity}: the ${label} and its URL come back.`,
      params: { [idParam]: z.number().int() },
      method: "post",
      path: (a) => `/admin/${collection}/${a[idParam]}/restore`,
      echo: [idParam],
    });

    registerWrite(server, {
      name: `delete_${entity}`,
      title: `Delete a ${label} permanently`,
      description:
        `Removes the ${label} and every translation of it for good. There is no undo — ` +
        `prefer deactivate_${entity} for anything that was once live.`,
      params: { [idParam]: z.number().int() },
      method: "delete",
      path: (a) => `/admin/${collection}/${a[idParam]}`,
      destructive: true,
      echo: [idParam],
    });
  }

  // ---- Services: the half posts already had ------------------------------
  registerWrite(server, {
    name: "update_service",
    title: "Update a service",
    description:
      "Edits a service's own fields: publication status, categories, images, the cards that " +
      "make up its body, and its position. Text is per-language — use " +
      "update_service_translation. Publishing is just status: 'published'.",
    params: {
      service_id: z.number().int(),
      status: z.enum(["draft", "published", "scheduled"]).optional(),
      scheduled_at: z
        .string()
        .optional()
        .describe("ISO timestamp. Required when status is 'scheduled'."),
      category_ids: z.array(z.number().int()).optional().describe("Replaces the whole set."),
      card_ids: z
        .array(z.number().int())
        .optional()
        .describe("Replaces the whole set, in this order."),
      featured_image_id: z.number().int().optional(),
      banner_image_id: z.number().int().optional(),
      allow_comments: z.boolean().optional(),
      sort_order: z.number().int().optional(),
    },
    method: "put",
    path: (a) => `/admin/services/${a.service_id}`,
    body: (a) => ({
      status: a.status,
      scheduled_at: a.scheduled_at,
      category_ids: a.category_ids,
      card_ids: a.card_ids,
      featured_image_id: a.featured_image_id,
      banner_image_id: a.banner_image_id,
      allow_comments: a.allow_comments,
      sort_order: a.sort_order,
    }),
    checks: (a) =>
      a.status === "scheduled" && !a.scheduled_at
        ? "status 'scheduled' needs scheduled_at, or the service never goes live."
        : null,
    echo: ["service_id"],
  });

  registerWrite(server, {
    name: "publish_service",
    title: "Publish a service",
    description:
      "Flips a service to published. Run audit_service first — the same SEO checks that " +
      "gate a blog post apply here.",
    params: { service_id: z.number().int() },
    method: "put",
    path: (a) => `/admin/services/${a.service_id}`,
    body: () => ({ status: "published" }),
    echo: ["service_id"],
  });

  registerWrite(server, {
    name: "unpublish_service",
    title: "Unpublish a service",
    description:
      "Returns a service to draft. The row and its translations stay; the URL stops " +
      "resolving.",
    params: { service_id: z.number().int() },
    method: "put",
    path: (a) => `/admin/services/${a.service_id}`,
    body: () => ({ status: "draft" }),
    destructive: true,
    echo: ["service_id"],
  });

  // ---- Bulk edits ---------------------------------------------------------
  registerWrite(server, {
    name: "bulk_update_posts",
    title: "Change many blog posts at once",
    description:
      "Applies the same change to a list of posts — status, categories, or the robots flags. " +
      "Anything per-language (title, excerpt, robots) needs language_id. The response names " +
      "the ids that failed and why, so check it rather than assuming all of them landed.",
    params: {
      post_ids: z.array(z.number().int()).min(1),
      status: z.enum(["draft", "published", "scheduled"]).optional(),
      scheduled_at: z.string().optional(),
      category_ids: z.array(z.number().int()).optional(),
      author_id: z.number().int().optional(),
      reviewer_id: z.number().int().optional(),
      robots_index: z.boolean().optional().describe("false = tell search engines not to index."),
      robots_follow: z.boolean().optional(),
      language_id: z
        .number()
        .int()
        .optional()
        .describe("Required with robots_index or robots_follow."),
    },
    method: "put",
    path: () => "/admin/posts/bulk-update",
    body: (a) => ({
      post_ids: a.post_ids,
      status: a.status,
      scheduled_at: a.scheduled_at,
      category_ids: a.category_ids,
      author_id: a.author_id,
      reviewer_id: a.reviewer_id,
      robots_index: a.robots_index,
      robots_follow: a.robots_follow,
      language_id: a.language_id,
    }),
    checks: (a) =>
      (a.robots_index !== undefined || a.robots_follow !== undefined) &&
      a.language_id === undefined
        ? "The robots flags are per-language — pass language_id."
        : null,
  });

  registerWrite(server, {
    name: "bulk_update_pages",
    title: "Change many pages' robots flags",
    description:
      "Sets robots_index / robots_follow on a list of pages, for one language. This is the " +
      "gentle way to take a page out of search without taking it off the site.",
    params: {
      page_ids: z.array(z.number().int()).min(1),
      robots_index: z.boolean().optional(),
      robots_follow: z.boolean().optional(),
      language_id: languageId,
    },
    method: "put",
    path: () => "/admin/pages/bulk-update",
    body: (a) => ({
      page_ids: a.page_ids,
      robots_index: a.robots_index,
      robots_follow: a.robots_follow,
      language_id: a.language_id,
    }),
  });

  registerWrite(server, {
    name: "bulk_update_services",
    title: "Change many services at once",
    description:
      "Applies a status change or the robots flags to a list of services. The robots flags " +
      "are per-language.",
    params: {
      service_ids: z.array(z.number().int()).min(1),
      status: z.enum(["draft", "published", "scheduled"]).optional(),
      scheduled_at: z.string().optional(),
      robots_index: z.boolean().optional(),
      robots_follow: z.boolean().optional(),
      language_id: z
        .number()
        .int()
        .optional()
        .describe("Required with robots_index or robots_follow."),
    },
    method: "put",
    path: () => "/admin/services/bulk-update",
    body: (a) => ({
      service_ids: a.service_ids,
      status: a.status,
      scheduled_at: a.scheduled_at,
      robots_index: a.robots_index,
      robots_follow: a.robots_follow,
      language_id: a.language_id,
    }),
    checks: (a) =>
      (a.robots_index !== undefined || a.robots_follow !== undefined) &&
      a.language_id === undefined
        ? "The robots flags are per-language — pass language_id."
        : null,
  });
}
