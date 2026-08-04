import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post } from "../api/client.js";
import { getProject, type ProjectId } from "../config/projects.js";
import type { Envelope } from "../api/types.js";
import { ok, fail, guard, projectParam, ensureWritable, resolveLanguageIds } from "./helpers.js";

interface FooterItem {
  id: number;
  label?: string | null;
  button_text?: string | null;
}
interface FooterSection {
  id: number;
  title?: string | null;
  items?: FooterItem[];
}
interface FooterTranslation {
  language: { id: number; code: string };
  cta_button_text?: string | null;
  sections?: FooterSection[];
}
interface FooterDetail {
  id: number;
  name?: string | null;
  is_default?: boolean;
  translations?: FooterTranslation[];
}
interface FooterListData {
  footers: FooterDetail[];
}

const str = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value.trim() : "";

/** Pull one footer in a single language, expanded to its section/item tree. */
async function readFooter(
  project: ProjectId,
  footerId: number,
  languageId: number,
): Promise<FooterTranslation | null> {
  const response = await get<Envelope<FooterDetail>>(project, `/admin/footers/${footerId}`, {
    language_id: languageId,
  });
  const translations = response.data.translations ?? [];
  return translations.find((t) => t.language.id === languageId) ?? null;
}

export function registerFooterTools(server: McpServer): void {
  server.registerTool(
    "footer_worklist",
    {
      title: "Read a footer's source text for translating",
      description:
        "The footer is a nested tree (footer CTA + sections + items), so it has its own flow " +
        "instead of translation_worklist. Returns each footer that is missing the target " +
        "language, with its source-language text (cta_button_text, each section title, each " +
        "item label / button_text) keyed by the source section/item ids. Translate those and " +
        "pass them to save_footer. Requires login.",
      inputSchema: {
        project: projectParam,
        target_language_code: z.string().min(2).describe("The language to produce, e.g. 'ar'."),
        source_language_code: z
          .string()
          .optional()
          .describe("Language to translate FROM. Defaults to the brand's default language."),
        overwrite: z
          .boolean()
          .default(false)
          .describe(
            "Return footers even if the target language already exists. Needed to re-fill " +
              "after the footer's section/item structure changed (an existing translation row " +
              "may pre-date the new sections/items).",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, target_language_code, source_language_code, overwrite }) =>
      guard(async () => {
        const source = (source_language_code ?? getProject(project).defaultLanguage).toLowerCase();
        const target = target_language_code.toLowerCase();
        const ids = await resolveLanguageIds(project, [source, target]);
        const sourceId = ids.get(source);
        const targetId = ids.get(target);
        if (sourceId === undefined || targetId === undefined) {
          return fail(`Both '${source}' and '${target}' must be active languages.`);
        }

        const list = await get<Envelope<FooterListData>>(project, "/admin/footers", {
          limit: 100,
        });
        const work: Record<string, unknown>[] = [];

        for (const footer of list.data.footers ?? []) {
          const hasTarget = (footer.translations ?? []).some(
            (t) => t.language.code.toLowerCase() === target,
          );
          if (hasTarget && !overwrite) continue;

          const src = await readFooter(project, footer.id, sourceId);
          if (!src) continue;

          work.push({
            footer_id: footer.id,
            name: footer.name,
            source_language_code: source,
            fields: {
              ...(str(src.cta_button_text) ? { cta_button_text: str(src.cta_button_text) } : {}),
            },
            sections: (src.sections ?? []).map((section) => ({
              source_section_id: section.id,
              ...(str(section.title) ? { title: str(section.title) } : {}),
              items: (section.items ?? []).map((item) => ({
                source_item_id: item.id,
                ...(str(item.label) ? { label: str(item.label) } : {}),
                ...(str(item.button_text) ? { button_text: str(item.button_text) } : {}),
              })),
            })),
          });
        }

        return ok({
          project,
          source_language_code: source,
          target_language_code: target,
          returned: work.length,
          footers: work,
          note:
            work.length === 0
              ? "Every footer already has this language."
              : "Translate the text values (cta_button_text, section title, item label / " +
                "button_text), keep the same source_section_id / source_item_id keys, and pass " +
                "them to save_footer. URLs and non-text fields are cloned from the source.",
        });
      }),
  );

  const itemSchema = z.object({
    source_item_id: z.number().int(),
    label: z.string().optional(),
    button_text: z.string().optional(),
  });
  const sectionSchema = z.object({
    source_section_id: z.number().int(),
    title: z.string().optional(),
    items: z.array(itemSchema).default([]),
  });

  server.registerTool(
    "save_footer",
    {
      title: "Write a footer translation (bulk)",
      description:
        "Saves a full footer translation for one language in a single call via the backend's " +
        "bulk endpoint. Pass the translated text from footer_worklist with the same " +
        "source_section_id / source_item_id keys. The backend clones the section/item " +
        "structure from the source language and applies your text; omitted text keeps the " +
        "source value, and URLs / non-text fields are copied. Requires login and a " +
        "write-enabled brand.",
      inputSchema: {
        project: projectParam,
        footer_id: z.number().int(),
        language_code: z.string().min(2).describe("The language this translation is IN."),
        source_language_code: z
          .string()
          .optional()
          .describe("Language to clone the structure FROM. Defaults to the brand's default."),
        cta_button_text: z.string().optional(),
        sections: z.array(sectionSchema).default([]),
        replace_existing: z
          .boolean()
          .default(true)
          .describe("Replace the target translation if it already exists (else 400)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({
      project,
      footer_id,
      language_code,
      source_language_code,
      cta_button_text,
      sections,
      replace_existing,
    }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        const source = (source_language_code ?? getProject(project).defaultLanguage).toLowerCase();
        const target = language_code.toLowerCase();
        const ids = await resolveLanguageIds(project, [source, target]);
        const sourceId = ids.get(source);
        const targetId = ids.get(target);
        if (sourceId === undefined || targetId === undefined) {
          return fail(`Both '${source}' and '${target}' must be active languages.`);
        }

        const response = await post<{ message?: string; data?: unknown }>(
          project,
          `/admin/footers/${footer_id}/translations/bulk`,
          {
            source_language_id: sourceId,
            target_language_id: targetId,
            cta_button_text,
            sections,
            replace_existing,
          },
        );
        return ok({
          project,
          footer_id,
          language_code: target,
          saved: true,
          detail: response.message ?? "Footer translation written.",
        });
      }),
  );
}
