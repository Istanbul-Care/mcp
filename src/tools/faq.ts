import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post, request } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { ok, guard, projectParam } from "./helpers.js";

interface CreatedFaq {
  id: number;
}

interface FaqListData {
  faqs: Array<{
    id: number;
    owner_type: string;
    owner_id: number | null;
    sort_order?: number;
    translations: Array<{
      language: { code: string };
      question: string;
      answer: string;
    }>;
  }>;
  total: number;
}

export function registerFaqTools(server: McpServer): void {
  server.registerTool(
    "list_post_faqs",
    {
      title: "List a post's FAQs",
      description:
        "The FAQs attached to a blog post, with every translation. Requires login.",
      inputSchema: {
        project: projectParam,
        post_id: z.number().int(),
        language_id: z.number().int().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, post_id, language_id }) =>
      guard(async () => {
        const response = await get<Envelope<FaqListData>>(project, "/admin/faqs", {
          owner_type: "post",
          owner_id: post_id,
          language_id,
          limit: 100,
        });
        return ok({
          project,
          post_id,
          total: response.data.total,
          faqs: response.data.faqs.map((faq) => ({
            id: faq.id,
            sort_order: faq.sort_order,
            translations: faq.translations.map((translation) => ({
              language: translation.language.code,
              question: translation.question,
              answer: translation.answer,
            })),
          })),
        });
      }),
  );

  server.registerTool(
    "add_post_faq",
    {
      title: "Add an FAQ to a post",
      description:
        "Creates one question/answer bound to a blog post, in a single language. Call it once " +
        "per FAQ; add other languages with add_faq_translation. The FAQ feeds both the on-page " +
        "block and the post's FAQPage structured data. Requires login.",
      inputSchema: {
        project: projectParam,
        post_id: z.number().int().describe("The owning post."),
        language_id: z
          .number()
          .int()
          .optional()
          .describe("Language of this first translation; defaults to the brand's default."),
        question: z.string().min(1).max(500),
        answer: z.string().min(1),
        sort_order: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, post_id, ...body }) =>
      guard(async () => {
        const response = await post<Envelope<CreatedFaq>>(project, "/admin/faqs", {
          owner_type: "post",
          owner_id: post_id,
          ...body,
        });
        return ok({ project, post_id, faq_id: response.data.id, created: true });
      }),
  );

  server.registerTool(
    "add_faq_translation",
    {
      title: "Translate an FAQ",
      description:
        "Adds a question/answer for another language to an existing FAQ. Requires login.",
      inputSchema: {
        project: projectParam,
        faq_id: z.number().int(),
        language_id: z.number().int(),
        question: z.string().min(1).max(500),
        answer: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, faq_id, ...body }) =>
      guard(async () => {
        await post(project, `/admin/faqs/${faq_id}/translations`, body);
        return ok({ project, faq_id, language_id: body.language_id, added: true });
      }),
  );

  server.registerTool(
    "delete_faq",
    {
      title: "Delete an FAQ",
      description:
        "Removes an FAQ (all its languages) from its post. Requires login.",
      inputSchema: { project: projectParam, faq_id: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ project, faq_id }) =>
      guard(async () => {
        await request(project, "DELETE", `/admin/faqs/${faq_id}`);
        return ok({ project, faq_id, deleted: true });
      }),
  );
}
