/**
 * The "fold a page's cards into its rich-text body" command.
 *
 * Pages were historically composed as a stack of content cards: one card per
 * section, each holding a heading and a slab of HTML. That renders fine but the
 * text is scattered across a dozen rows, invisible to the page's own editor and
 * duplicated in every language. This command turns that stack into ONE
 * page_content block.
 *
 * The assembly itself is deliberately NOT the agent's job — `fold_page_cards`
 * concatenates the cards' HTML byte for byte, so nothing can be silently
 * reworded on the way across. What the agent decides is which cards are prose,
 * which language is the source, and when the live page may change.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { PROJECTS, PROJECT_IDS } from "../config/projects.js";

export function registerCardsToPageContentPrompt(server: McpServer): void {
  server.registerPrompt(
    "cards_to_page_content",
    {
      title: "Convert a page's cards into its page_content block",
      description:
        "Takes a page whose body is a stack of content cards and folds those cards into " +
        "the page's single rich-text page_content block, texts moved word for word. Widget " +
        "cards (whatsapp, sliders, galleries, word clouds) stay attached; only the prose " +
        "cards move. The source language is written first, the rest are machine-translated " +
        "from it, and the folded cards are detached — never deleted.",
      argsSchema: {
        project: z
          .string()
          .describe(`Brand the page belongs to. One of: ${PROJECT_IDS.join(", ")}.`),
        page_id: z
          .string()
          .describe("Page id — the number in the admin URL /dashboard/pages/<id>/edit."),
        language: z
          .string()
          .optional()
          .describe("Source language to fold, e.g. 'en'. Defaults to the brand's default."),
        translate: z
          .string()
          .optional()
          .describe("'no' to stop after the source language instead of translating the rest."),
        keep_cards: z
          .string()
          .optional()
          .describe("'yes' to leave the folded cards attached to the page (preview only)."),
      },
    },
    ({ project, page_id, language, translate, keep_cards }) => {
      const source = language ?? PROJECTS[project as keyof typeof PROJECTS]?.defaultLanguage ?? "en";
      const detach = keep_cards?.toLowerCase() !== "yes";
      const translateStep =
        translate?.toLowerCase() === "no"
          ? [
              `6. Stop here — I asked not to translate. Tell me that only '${source}' has a body`,
              "   and that auto_translate({ entity_type: 'page', ... }) fills the rest later.",
            ].join("\n")
          : [
              `6. Fill the other languages from '${source}': auto_translate({ project:`,
              `   "${project}", entity_type: "page", id: ${page_id}, source_language_code:`,
              `   "${source}", overwrite: true }) — overwrite is required, because the other`,
              "   languages already have a translation row and would otherwise be left with",
              "   an empty body. Poll auto_translate_status until it finishes and report any",
              "   language that failed.",
            ].join("\n");
      const detachStep = detach
        ? [
            "7. Only now detach the folded cards — the text must exist in every language",
            "   first, or a language ends up with neither cards nor body. Show me the list",
            "   and wait for my go-ahead, then re-run fold_page_cards with dry_run:false,",
            "   overwrite:true and detach_cards:true, or call update_page with `cards` set",
            "   to the cards that were NOT folded. Do NOT call delete_card: the cards stay",
            "   in the library until I say otherwise, and may be attached to other pages.",
          ].join("\n")
        : [
            "7. Leave the cards attached — I asked to keep them. Warn me that the page now",
            "   renders the same text twice, and that fold_page_cards with",
            "   detach_cards:true drops them when I am happy.",
          ].join("\n");

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Convert page ${page_id} on the '${project}' brand from a stack of cards to a`,
                "single page_content block.",
                "",
                "Follow these steps exactly:",
                "",
                `1. auth_status. If '${project}' holds no valid token, run the login flow:`,
                "   login, tell me where the one-time code went, wait for me to paste it,",
                "   submit_otp. Do not continue until you are authenticated.",
                "",
                `2. get_page({ project: "${project}", page_id: ${page_id} }) — note its`,
                "   languages, whether page_content is already enabled, and whether any",
                "   translation reports content_chars > 0. If one does, tell me before",
                "   touching it: folding REPLACES that body.",
                "",
                `3. get_page_cards({ project: "${project}", page_id: ${page_id},`,
                `   language_code: "${source}" }) to see the stack in render order. Sort out`,
                "   which cards are prose and which are not:",
                "   - 'content' and 'default' cards are prose — they fold in.",
                "   - 'whatsapp', 'media_slider', 'vertical_slider', 'testimonial_gallery'",
                "     and 'word_cloud' are widgets. Their text means nothing outside their",
                "     own rendering, so they stay attached to the page untouched.",
                "   Tell me if anything looks like it should not move.",
                "",
                `4. Preview: fold_page_cards({ project: "${project}", page_id: ${page_id},`,
                `   language_codes: ["${source}"], dry_run: true }). The tool concatenates the`,
                "   cards' own HTML — title as a heading, description verbatim, images and",
                "   buttons kept — so the text is MOVED, not re-authored. Never rebuild that",
                "   HTML yourself: retyping it is how wording quietly drifts. Check the",
                "   preview and the card list, then show me what it will write.",
                "",
                `5. Write it: the same call with dry_run:false. Re-read get_page and confirm`,
                `   '${source}' now reports content_chars matching, and that page_content is`,
                "   enabled at the position the cards used to hold.",
                "",
                translateStep,
                "",
                detachStep,
                "",
                "8. Report: which cards folded in (id + title), which stayed and why, the",
                "   body size per language, and the public URL to check. Mention that the",
                "   detached cards still exist in the card library.",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
