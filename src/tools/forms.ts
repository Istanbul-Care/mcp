/**
 * Forms — the contact form and the multi-step lead form.
 *
 * Backend has full CRUD; the MCP only translated them. These tools create and
 * delete them so a page can have a form attached (and removed).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post, del } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { getProject, type ProjectId } from "../config/projects.js";
import { ok, guard, projectParam, resolveLanguageIds } from "./helpers.js";

interface Created {
  id: number;
}

export function registerFormTools(server: McpServer): void {
  server.registerTool(
    "create_contact_form",
    {
      title: "Create a contact form",
      description:
        "Creates a contact form in ONE language, with its title, description, field labels and " +
        "submit button. Attach it to a page afterwards. Add other languages with the " +
        "translation tools. Requires login.",
      inputSchema: {
        project: projectParam,
        language_id: z.number().int(),
        title: z.string(),
        description: z.string(),
        full_name_verbose_name: z.string(),
        email_verbose_name: z.string(),
        language_verbose_name: z.string(),
        number_verbose_name: z.string(),
        service_category_verbose_name: z.string(),
        check_box_text: z.string().describe("Consent checkbox text; HTML links allowed."),
        privacy_and_policy: z.string(),
        button_text: z.string(),
        button_url: z.string(),
        thankyou_page_url: z.string().optional(),
        background_image_id: z.number().int().optional(),
        image_id: z.number().int().optional(),
        forward_to_email: z.string().optional().describe("Where submissions are e-mailed."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) =>
      guard(async () => {
        const response = await post<Envelope<Created>>(project, "/admin/contact-form", body);
        return ok({ project, created: true, contact_form_id: response.data.id });
      }),
  );

  server.registerTool(
    "delete_contact_form",
    {
      title: "Delete a contact form",
      description:
        "Permanently deletes a contact form (and its translations). Requires login.",
      inputSchema: { project: projectParam, contact_form_id: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ project, contact_form_id }) =>
      guard(async () => {
        await del(project, `/admin/contact-form/${contact_form_id}`);
        return ok({ project, contact_form_id, deleted: true });
      }),
  );

  server.registerTool(
    "create_multi_page_form",
    {
      title: "Create a multi-step form",
      description:
        "Creates a multi-page lead form in ONE language (the chat-style customer-service " +
        "widget). Add other languages with the translation tools. Requires login.",
      inputSchema: {
        project: projectParam,
        language_id: z.number().int(),
        customer_service_name: z.string(),
        customer_service_status: z.string(),
        customer_service_description: z.string(),
        cta_text: z.string(),
        cta_button_text: z.string(),
        cta_button_url: z.string().optional(),
        prev_button_text: z.string(),
        next_button_text: z.string(),
        thankyou_page_url: z.string().optional(),
        avatar_media_id: z.number().int().optional(),
        forward_to_email: z.string().optional(),
        send_to_zapier: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, ...body }) =>
      guard(async () => {
        const response = await post<Envelope<Created>>(project, "/admin/multi-page-form", body);
        return ok({ project, created: true, multi_page_form_id: response.data.id });
      }),
  );

  server.registerTool(
    "delete_multi_page_form",
    {
      title: "Delete a multi-step form",
      description:
        "Permanently deletes a multi-page form (and its translations). Requires login.",
      inputSchema: { project: projectParam, multi_page_form_id: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ project, multi_page_form_id }) =>
      guard(async () => {
        await del(project, `/admin/multi-page-form/${multi_page_form_id}`);
        return ok({ project, multi_page_form_id, deleted: true });
      }),
  );

  /*
   * The service-category dropdown.
   *
   * These options hang off the contact form, one row per (form, language) —
   * they are NOT the `service_category` taxonomy, and the translation registry
   * cannot see them. A language with no rows gets an EMPTY dropdown in the
   * public payload rather than an error, so the form silently loses a field.
   */
  server.registerTool(
    "contact_form_options_worklist",
    {
      title: "Read a contact form's service-dropdown options for translating",
      description:
        "Returns each contact form whose service-category dropdown is empty in the target " +
        "language, with the source-language options to translate. These options live on the " +
        "form (one row per form + language), so translation_worklist does NOT cover them and a " +
        "missing language renders as an empty dropdown, not an error. Translate only `name` " +
        "and pass the rows to save_contact_form_options. Requires login.",
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
          .describe("Return forms even if the target language already has options."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, target_language_code, source_language_code, overwrite }) =>
      guard(async () => {
        const source = (source_language_code ?? getProject(project).defaultLanguage).toLowerCase();
        const target = target_language_code.toLowerCase();
        const ids = await resolveLanguageIds(project, [source, target]);
        const sourceId = ids.get(source)!;
        const targetId = ids.get(target)!;

        const list = await get<Envelope<{ contact_form: { id: number }[] }>>(
          project,
          "/admin/contact-form",
          { limit: 100 },
        );
        const work: Record<string, unknown>[] = [];

        for (const form of list.data.contact_form ?? []) {
          const existing = await readServiceOptions(project, form.id, targetId);
          if (existing.length > 0 && !overwrite) continue;

          const options = await readServiceOptions(project, form.id, sourceId);
          if (options.length === 0) continue;

          work.push({
            contact_form_id: form.id,
            source_language_code: source,
            already_present: existing.length,
            options: options.map((option) => ({
              code: option.code,
              name: option.name,
              sort_order: option.sort_order,
              zapier_custom_id: option.zapier_custom_id ?? null,
            })),
          });
        }

        return ok({
          project,
          source_language_code: source,
          target_language_code: target,
          returned: work.length,
          forms: work,
          note:
            work.length === 0
              ? "Every contact form already has service options in this language."
              : "Translate ONLY `name`. Send `code`, `sort_order` and `zapier_custom_id` back " +
                "unchanged — `code` is the value submitted with the lead and must match the " +
                "other languages, or lead routing and Zapier mapping break.",
        });
      }),
  );

  server.registerTool(
    "save_contact_form_options",
    {
      title: "Write a contact form's service-dropdown options for one language",
      description:
        "Creates the service-category dropdown options for one contact form in one language. " +
        "Pass the rows from contact_form_options_worklist with `name` translated and `code` / " +
        "`sort_order` / `zapier_custom_id` unchanged. Requires login.",
      inputSchema: {
        project: projectParam,
        contact_form_id: z.number().int(),
        language_code: z.string().min(2).describe("The language these options are IN."),
        options: z
          .array(
            z.object({
              name: z.string().min(1).describe("The translated label shown in the dropdown."),
              code: z
                .string()
                .min(1)
                .describe("Language-INVARIANT value submitted with the lead. Copy it verbatim."),
              sort_order: z.number().int().default(0),
              zapier_custom_id: z.string().nullable().optional(),
            }),
          )
          .min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, contact_form_id, language_code, options }) =>
      guard(async () => {

        const target = language_code.toLowerCase();
        const ids = await resolveLanguageIds(project, [target]);
        const languageId = ids.get(target)!;

        const saved: number[] = [];
        const failed: { code: string; error: string }[] = [];
        for (const option of options) {
          try {
            const response = await post<Envelope<Created>>(
              project,
              `/admin/contact-form/${contact_form_id}/service-options`,
              {
                language_id: languageId,
                name: option.name,
                code: option.code,
                sort_order: option.sort_order,
                ...(option.zapier_custom_id === undefined
                  ? {}
                  : { zapier_custom_id: option.zapier_custom_id }),
              },
            );
            saved.push(response.data.id);
          } catch (error) {
            failed.push({
              code: option.code,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return ok({
          project,
          contact_form_id,
          language_code: target,
          saved: saved.length,
          failed: failed.length,
          option_ids: saved,
          ...(failed.length > 0 ? { failures: failed } : {}),
        });
      }),
  );
}

interface ServiceOption {
  id: number;
  name: string;
  code: string;
  sort_order: number;
  zapier_custom_id?: string | null;
}

async function readServiceOptions(
  project: ProjectId,
  formId: number,
  languageId: number,
): Promise<ServiceOption[]> {
  const response = await get<Envelope<ServiceOption[]>>(
    project,
    `/admin/contact-form/${formId}/service-options`,
    { language_id: languageId },
  );
  return response.data ?? [];
}
