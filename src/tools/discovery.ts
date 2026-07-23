/** Read-only lookups an agent needs before it can write anything sensible. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get } from "../api/client.js";
import { PROJECTS, PROJECT_IDS, getProject } from "../config/projects.js";
import type {
  Envelope,
  LanguageListData,
  PostCategoryListData,
  TagListData,
  PublicSearchData,
} from "../api/types.js";
import { ok, guard, projectParam } from "./helpers.js";

export function registerDiscoveryTools(server: McpServer): void {
  server.registerTool(
    "list_projects",
    {
      title: "List brands",
      description:
        "Every brand this server can talk to, with its API host, public site URL and the " +
        "locale that carries no URL prefix. Needs no authentication.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      guard(async () =>
        ok(
          PROJECT_IDS.map((id) => {
            const project = getProject(id);
            return {
              id: project.id,
              name: project.name,
              short_name: project.shortName,
              api_base_url: project.apiBaseUrl,
              frontend_url: project.frontendUrl,
              default_language: project.defaultLanguage,
            };
          }),
        ),
      ),
  );

  server.registerTool(
    "list_languages",
    {
      title: "List a brand's languages",
      description:
        "Active languages for a brand, with the numeric ids that post translations key " +
        "off. Needs no authentication.",
      inputSchema: {
        project: projectParam,
        include_inactive: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, include_inactive }) =>
      guard(async () => {
        const response = await get<Envelope<LanguageListData>>(
          project,
          "/admin/languages",
          { limit: 100, is_active: include_inactive ? undefined : true },
          false,
        );
        return ok({
          project,
          default_language: getProject(project).defaultLanguage,
          languages: response.data.languages.map((language) => ({
            id: language.id,
            code: language.code,
            name: language.name,
            is_active: language.is_active,
            order: language.order,
          })),
        });
      }),
  );

  server.registerTool(
    "list_post_categories",
    {
      title: "List blog categories",
      description:
        "Blog categories with every translation, so a draft can be filed under the right " +
        "category ids. Requires login.",
      inputSchema: {
        project: projectParam,
        search: z.string().optional(),
        language_id: z.number().int().optional(),
        limit: z.number().int().min(1).max(100).default(100),
        page: z.number().int().min(1).default(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, search, language_id, limit, page }) =>
      guard(async () => {
        const response = await get<Envelope<PostCategoryListData>>(
          project,
          "/admin/post-categories",
          { search, language_id, limit, page },
        );
        return ok({
          project,
          total: response.data.total,
          categories: response.data.categories.map((category) => ({
            id: category.id,
            translations: category.translations.map((translation) => ({
              language: translation.language.code,
              name: translation.name,
              slug: translation.slug,
            })),
          })),
        });
      }),
  );

  server.registerTool(
    "list_tags",
    {
      title: "List blog tags",
      description: "Tags with every translation, for attaching tag ids to a post. Requires login.",
      inputSchema: {
        project: projectParam,
        search: z.string().optional(),
        language_id: z.number().int().optional(),
        limit: z.number().int().min(1).max(100).default(100),
        page: z.number().int().min(1).default(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, search, language_id, limit, page }) =>
      guard(async () => {
        const response = await get<Envelope<TagListData>>(project, "/admin/tags", {
          search,
          language_id,
          limit,
          page,
        });
        return ok({
          project,
          total: response.data.total,
          tags: response.data.tags.map((tag) => ({
            id: tag.id,
            translations: tag.translations.map((translation) => ({
              language: translation.language.code,
              name: translation.name,
              slug: translation.slug,
            })),
          })),
        });
      }),
  );

  server.registerTool(
    "search_content",
    {
      title: "Search published content",
      description:
        "Free-text search across published posts, services and pages by title and slug. " +
        "This is the tool for finding internal-link targets — it only ever returns live " +
        "content, so it cannot suggest a link to a draft. `path` is already the routable " +
        "URL path for that language (container prefix and category chain applied), so it " +
        "can be used as a link target directly. Needs no authentication.",
      inputSchema: {
        project: projectParam,
        query: z.string().min(1),
        language_code: z
          .string()
          .optional()
          .describe("Restrict to one language; omit to search all of them."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Max results per type (post / service / page)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, query, language_code, limit }) =>
      guard(async () => {
        const path = language_code
          ? `/${encodeURIComponent(language_code)}/public-search`
          : "/public-search";
        const response = await get<Envelope<PublicSearchData>>(
          project,
          path,
          { q: query, limit },
          false,
        );
        return ok({
          project,
          query: response.data.query,
          total: response.data.total,
          results: response.data.results.map((item) => ({
            type: item.type,
            id: item.id,
            title: item.title,
            path: item.slug,
            language: item.language_code,
            excerpt: item.excerpt,
          })),
          note:
            "`path` is language-specific and already routable. To link to the same content " +
            "in a different language, feed the path to resolve_internal_link.",
        });
      }),
  );
}

export const KNOWN_PROJECT_COUNT = Object.keys(PROJECTS).length;
