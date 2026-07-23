import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post } from "../api/client.js";
import { ok, fail, guard, projectParam, writeAllowed } from "./helpers.js";

interface AutoTranslateAccepted {
  job_id: number;
  status_url: string;
  target_language_codes: string[];
}

interface AutoTranslateJobStatus {
  job_id: number;
  post_id?: number | null;
  status: string;
  total: number;
  done: number;
  current?: string | null;
  languages: Record<string, { status: string; error?: string | null }>;
  error?: string | null;
}

export function registerTranslateTools(server: McpServer): void {
  server.registerTool(
    "auto_translate_post",
    {
      title: "Machine-translate a post into other languages",
      description:
        "Starts a background LLM translation of a post from one language into others. " +
        "Internal links are re-localised to the target language, meta is produced at SEO " +
        "sizes, and slugs come out ASCII. Returns a job id immediately — poll " +
        "auto_translate_status for progress. By default only fills MISSING languages; set " +
        "overwrite:true to redo existing ones. Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        post_id: z.number().int(),
        source_language_code: z.string().min(2).describe("Language to translate FROM, e.g. 'en'."),
        target_language_codes: z
          .array(z.string())
          .optional()
          .describe("Languages to translate INTO. Omit to fill every missing active language."),
        overwrite: z.boolean().default(false),
        translate_faqs: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, post_id, source_language_code, target_language_codes, overwrite, translate_faqs }) =>
      guard(async () => {
        if (!writeAllowed(project)) {
          return fail(
            `Writes to '${project}' are disabled. Add it to ICMCP_WRITE_PROJECTS and restart.`,
          );
        }
        const response = await post<AutoTranslateAccepted>(
          project,
          `/admin/posts/${post_id}/auto-translate`,
          {
            source_language_code,
            target_language_codes,
            overwrite,
            translate_faqs,
          },
        );
        return ok({
          project,
          post_id,
          job_id: response.job_id,
          translating_into: response.target_language_codes,
          note:
            `Running in the background. Poll auto_translate_status({ project: "${project}", ` +
            `post_id: ${post_id}, job_id: ${response.job_id} }). New translations are created ` +
            `as drafts on the post — review and publish separately.`,
        });
      }),
  );

  server.registerTool(
    "auto_translate_status",
    {
      title: "Check an auto-translate job",
      description:
        "Progress and per-language outcome of an auto-translate run. For any language that " +
        "was not saved, the entry's 'error' explains why. Omit job_id for the post's latest " +
        "run. Requires login.",
      inputSchema: {
        project: projectParam,
        post_id: z.number().int(),
        job_id: z.number().int().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, post_id, job_id }) =>
      guard(async () => {
        const response = await get<{ data: AutoTranslateJobStatus }>(
          project,
          `/admin/posts/${post_id}/auto-translate/status`,
          { job_id },
        );
        const job = response.data;
        return ok({
          project,
          post_id,
          job_id: job.job_id,
          status: job.status,
          progress: `${job.done}/${job.total}`,
          current: job.current,
          languages: job.languages,
          error: job.error,
        });
      }),
  );

  server.registerTool(
    "auto_translate_rollback",
    {
      title: "Undo an auto-translate run",
      description:
        "Reverses an auto-translate run: translations it created are deleted, ones it " +
        "overwrote are restored from the pre-run snapshot. Omit job_id for the latest run, " +
        "or pass languages to roll back only some. Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        post_id: z.number().int(),
        job_id: z.number().int().optional(),
        languages: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ project, post_id, job_id, languages }) =>
      guard(async () => {
        if (!writeAllowed(project)) {
          return fail(
            `Writes to '${project}' are disabled. Add it to ICMCP_WRITE_PROJECTS and restart.`,
          );
        }
        const response = await post<{ message: string; data: unknown }>(
          project,
          `/admin/posts/${post_id}/auto-translate/rollback`,
          { job_id, languages },
        );
        return ok({ project, post_id, rolled_back: true, detail: response.message });
      }),
  );
}
