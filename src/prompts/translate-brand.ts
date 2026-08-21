/**
 * The one-shot "translate this brand into <language>" command.
 *
 * Registered as an MCP prompt so it surfaces as a slash command in the client
 * rather than as one more tool the model has to piece together. The sweep is
 * three loops — the backend's LLM for posts/services/pages, the agent itself for
 * everything else, and the footer's own nested flow — and getting them in the
 * right order matters, so the order lives here instead of in whoever happens to
 * be asking. The footer has its own step because it is the one surface
 * translation_worklist cannot reach, which makes it the easiest one to miss.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { PROJECT_IDS } from "../config/projects.js";

export function registerTranslatePrompt(server: McpServer): void {
  server.registerPrompt(
    "translate_brand",
    {
      title: "Translate a whole brand into a language",
      description:
        "Fill one language across every translatable surface of a brand: posts, services " +
        "and pages via the backend's machine translation, and everything else — taxonomy, " +
        "heroes, sliders, cards, packages, processes, forms, menus, footers, global " +
        "settings — translated by you and written back.",
      argsSchema: {
        project: z
          .string()
          .describe(`Brand id. One of: ${PROJECT_IDS.join(", ")}.`),
        language: z.string().describe("Target language code, e.g. 'ar'."),
        source_language: z
          .string()
          .optional()
          .describe("Language to translate FROM. Defaults to the brand's default language."),
      },
    },
    ({ project, language, source_language }) => {
      const from = source_language
        ? `, source_language_code: "${source_language}"`
        : "";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Translate the '${project}' brand into '${language}', everywhere.`,
                "",
                "Work in this order and do not skip the checks:",
                "",
                `1. auth_status. If '${project}' is not logged in, call login and ask me for`,
                "   the one-time code — the backend mails one on every login.",
                "",
                `2. translation_coverage({ project: "${project}", target_language_codes:`,
                `   ["${language}"]${from} }) to see the size of the job. Report the totals to me`,
                "   before writing anything.",
                "",
                `3. translate_everything({ project: "${project}", target_language_codes:`,
                `   ["${language}"]${from} }) for posts, services and pages. Then poll`,
                "   translate_everything_status until finished:true — each poll also starts the",
                "   next queued entities, so the sweep stalls if you stop polling. Leave a",
                "   minute or two between polls; these are real LLM jobs on a worker with no",
                "   queue behind it.",
                "",
                "4. For every other content type, loop:",
                `     translation_worklist({ project: "${project}", target_language_code:`,
                `     "${language}"${from} })`,
                `   translate each item's fields into ${language} yourself, then`,
                `     save_translations({ project: "${project}", language_code: "${language}",`,
                "     items: [...] })",
                "   Repeat until more_remaining is 0.",
                "",
                "   When translating: keep HTML tags and their attributes exactly as they are",
                "   and translate only the text between them. Do not translate brand names,",
                "   clinic names or medical trademarks. Do not invent values for fields that",
                "   were not in the worklist — slugs, URLs, prices, icons and phone numbers",
                "   are handled for you.",
                "",
                "   Cards are the exception to `more_remaining`: the admin card list filters",
                "   translations to one language, so the worklist cannot see which cards are",
                "   already done and will keep handing you the same newest ids. Track cards by",
                `   id instead — list_cards({ project: "${project}", language_id: <${language} id> })`,
                "   reports how many already have the language, and paging list_cards with and",
                "   without language_id tells you which ids are still missing.",
                "",
                "5. The footer is a nested tree (CTA + sections + items), so translation_worklist",
                "   does not carry it. Do it with its own pair:",
                `     footer_worklist({ project: "${project}", target_language_code: "${language}"${from} })`,
                `   translate each title / label / button_text into ${language}, keeping the same`,
                "   source_section_id and source_item_id keys, then",
                `     save_footer({ project: "${project}", footer_id: <id>, language_code: "${language}", ... })`,
                "   Repeat until footer_worklist returns 0. Skipping this leaves the footer in",
                "   the source language on every page of the site.",
                "",
                `6. Finish with translation_coverage again and show me what is still missing`,
                "   and why. Anything auto-translated was created as a draft — tell me what",
                "   needs review before it goes live rather than publishing it yourself.",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
