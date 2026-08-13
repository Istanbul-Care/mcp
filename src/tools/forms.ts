/**
 * Forms — the contact form and the multi-step lead form.
 *
 * Backend has full CRUD; the MCP only translated them. These tools create and
 * delete them so a page can have a form attached (and removed).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { post, del } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { ok, fail, guard, projectParam, ensureWritable } from "./helpers.js";

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
        "translation tools. Requires login and a write-enabled brand.",
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
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        const response = await post<Envelope<Created>>(project, "/admin/contact-form", body);
        return ok({ project, created: true, contact_form_id: response.data.id });
      }),
  );

  server.registerTool(
    "delete_contact_form",
    {
      title: "Delete a contact form",
      description:
        "Permanently deletes a contact form (and its translations). Requires login and a " +
        "write-enabled brand.",
      inputSchema: { project: projectParam, contact_form_id: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ project, contact_form_id }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
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
        "widget). Add other languages with the translation tools. Requires login and a " +
        "write-enabled brand.",
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
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        const response = await post<Envelope<Created>>(project, "/admin/multi-page-form", body);
        return ok({ project, created: true, multi_page_form_id: response.data.id });
      }),
  );

  server.registerTool(
    "delete_multi_page_form",
    {
      title: "Delete a multi-step form",
      description:
        "Permanently deletes a multi-page form (and its translations). Requires login and a " +
        "write-enabled brand.",
      inputSchema: { project: projectParam, multi_page_form_id: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ project, multi_page_form_id }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);
        await del(project, `/admin/multi-page-form/${multi_page_form_id}`);
        return ok({ project, multi_page_form_id, deleted: true });
      }),
  );
}
