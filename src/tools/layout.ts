/**
 * The frames around the content: headers, footers, and the multi-step forms.
 *
 * Two of these hide the same surprise, and it is the reason this module has
 * its own file rather than living with the page components.
 *
 *   A footer's SECTIONS hang off a footer TRANSLATION, not off the footer.
 *   A multi-step form's PAGES hang off a form TRANSLATION, not off the form.
 *
 * So the column layout of the Italian footer is a different set of rows from
 * the English one, and adding a link column in English adds nothing anywhere
 * else. Both create paths below therefore ask for the translation you are
 * building, and say so. Read the parent with get_component first: the ids you
 * need are the translation ids inside it, not the ids the list tools show.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get } from "../api/client.js";
import type { Envelope } from "../api/types.js";
import { ok, guard, projectParam, registerWrite, ensureVocabulary } from "./helpers.js";

const languageId = z
  .number()
  .int()
  .describe("Numeric language id — call list_languages, not a language code.");

const order = z.number().int().min(0).optional().describe("Lower sorts first.");

const logoDimensions = {
  logo_id: z.number().int().optional(),
  logo_width: z.number().int().min(1).max(5000).optional(),
  logo_height: z.number().int().min(1).max(5000).optional(),
  logo_width_mobile: z.number().int().min(1).max(5000).optional(),
  logo_height_mobile: z.number().int().min(1).max(5000).optional(),
};

export function registerLayoutTools(server: McpServer): void {
  // ---- Header shell -------------------------------------------------------
  registerWrite(server, {
    name: "create_header",
    title: "Create a header",
    description:
      "Creates a navigation header — the logo and the bar its menu items hang off. Most " +
      "brands have exactly one, marked default; make another only for a landing page that " +
      "needs a different nav. Add the menu with add_header_item.",
    params: {
      name: z.string(),
      is_default: z.boolean().optional().describe("The header pages use unless told otherwise."),
      ...logoDimensions,
    },
    method: "post",
    path: () => "/admin/headers",
    body: (a) => ({
      name: a.name,
      is_default: a.is_default,
      logo_id: a.logo_id,
      logo_width: a.logo_width,
      logo_height: a.logo_height,
      logo_width_mobile: a.logo_width_mobile,
      logo_height_mobile: a.logo_height_mobile,
    }),
  });

  registerWrite(server, {
    name: "update_header",
    title: "Update a header",
    description:
      "Changes a header's name, logo or default flag. Setting is_default on one header is " +
      "what moves every page onto it.",
    params: {
      header_id: z.number().int(),
      name: z.string().optional(),
      is_default: z.boolean().optional(),
      ...logoDimensions,
    },
    method: "put",
    path: (a) => `/admin/headers/${a.header_id}`,
    body: (a) => ({
      name: a.name,
      is_default: a.is_default,
      logo_id: a.logo_id,
      logo_width: a.logo_width,
      logo_height: a.logo_height,
      logo_width_mobile: a.logo_width_mobile,
      logo_height_mobile: a.logo_height_mobile,
    }),
    echo: ["header_id"],
  });

  registerWrite(server, {
    name: "delete_header",
    title: "Delete a header",
    description:
      "Removes a header and all of its menu items. Pages pointing at it fall back to the " +
      "default header.",
    params: { header_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/headers/${a.header_id}`,
    destructive: true,
    echo: ["header_id"],
  });

  // ---- Footer shell -------------------------------------------------------
  server.registerTool(
    "list_footers",
    {
      title: "List footers",
      description:
        "The footers configured for a brand, with their ids and which one is default. " +
        "Requires login.",
      inputSchema: {
        project: projectParam,
        limit: z.number().int().min(1).max(200).default(50),
        page: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, ...query }) =>
      guard(async () => {
        const response = await get<Envelope<unknown>>(project, "/admin/footers", query);
        return ok({ project, data: response.data });
      }),
  );

  registerWrite(server, {
    name: "create_footer",
    title: "Create a footer",
    description:
      "Creates a footer shell. Its columns are per-language: add a translation, then build " +
      "that language's sections against the translation id.",
    params: {
      name: z.string(),
      is_default: z.boolean().optional(),
      style: z.string().optional().describe("default | premium | editorial."),
      background_image_id: z.number().int().optional(),
      contact_image_id: z.number().int().optional(),
    },
    method: "post",
    path: () => "/admin/footers",
    body: (a) => ({
      name: a.name,
      is_default: a.is_default,
      style: a.style,
      background_image_id: a.background_image_id,
      contact_image_id: a.contact_image_id,
    }),
    checks: (a) => ensureVocabulary([["footer_style", a.style]]),
  });

  registerWrite(server, {
    name: "update_footer",
    title: "Update a footer",
    description: "Changes a footer's name, style, images or default flag.",
    params: {
      footer_id: z.number().int(),
      name: z.string().optional(),
      is_default: z.boolean().optional(),
      style: z.string().optional(),
      background_image_id: z.number().int().optional(),
      contact_image_id: z.number().int().optional(),
    },
    method: "put",
    path: (a) => `/admin/footers/${a.footer_id}`,
    body: (a) => ({
      name: a.name,
      is_default: a.is_default,
      style: a.style,
      background_image_id: a.background_image_id,
      contact_image_id: a.contact_image_id,
    }),
    checks: (a) => ensureVocabulary([["footer_style", a.style]]),
    echo: ["footer_id"],
  });

  registerWrite(server, {
    name: "delete_footer",
    title: "Delete a footer",
    description: "Removes a footer with every language's columns and links.",
    params: { footer_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/footers/${a.footer_id}`,
    destructive: true,
    echo: ["footer_id"],
  });

  registerWrite(server, {
    name: "create_footer_translation",
    title: "Start a footer in one language",
    description:
      "Creates the empty per-language footer that sections then hang off. The response's id " +
      "is the footer_translation_id create_footer_section asks for. save_footer does this and " +
      "the whole column structure in one call — prefer it when cloning a footer into a new " +
      "language.",
    params: {
      footer_id: z.number().int(),
      language_id: languageId,
      cta_button_text: z.string().optional(),
      cta_button_url: z
        .string()
        .optional()
        .describe("Runs through the link dispatcher — see get_link_conventions."),
    },
    method: "post",
    path: (a) => `/admin/footers/${a.footer_id}/translations`,
    body: (a) => ({
      language_id: a.language_id,
      cta_button_text: a.cta_button_text,
      cta_button_url: a.cta_button_url,
    }),
    echo: ["footer_id", "language_id"],
  });

  registerWrite(server, {
    name: "create_footer_section",
    title: "Add a column to a footer",
    description:
      "Adds one column to ONE language's footer. The id is the footer TRANSLATION's id — " +
      "read it from get_component(component: 'footer'), not from list_footers. A section " +
      "with group 'bottom_section' is the only kind whose links run through the modal/CTA " +
      "dispatcher; a top section's links are plain anchors, so a sentinel like " +
      "modal-dialog-consultation typed there 404s.",
    params: {
      footer_translation_id: z.number().int(),
      title: z.string().optional().describe("The column heading."),
      group: z
        .string()
        .optional()
        .describe("top_section (default) or bottom_section."),
      platform: z
        .string()
        .optional()
        .describe("instagram | facebook | youtube | messenger — social columns only."),
      icon_media_id: z.number().int().optional(),
      doctors_image_id: z.number().int().optional(),
      is_active: z.boolean().optional(),
      order,
    },
    method: "post",
    path: (a) => `/admin/footers/translations/${a.footer_translation_id}/sections`,
    body: (a) => ({
      title: a.title,
      group: a.group,
      platform: a.platform,
      icon_media_id: a.icon_media_id,
      doctors_image_id: a.doctors_image_id,
      is_active: a.is_active,
      order: a.order,
    }),
    checks: (a) =>
      ensureVocabulary([
        ["footer_section_group", a.group],
        ["footer_section_platform", a.platform],
      ]),
    echo: ["footer_translation_id"],
  });

  registerWrite(server, {
    name: "update_footer_section",
    title: "Update a footer column",
    description: "Changes one column's heading, group, icon or position.",
    params: {
      section_id: z.number().int(),
      title: z.string().optional(),
      group: z.string().optional(),
      platform: z.string().optional(),
      icon_media_id: z.number().int().optional(),
      doctors_image_id: z.number().int().optional(),
      is_active: z.boolean().optional(),
      order,
    },
    method: "put",
    path: (a) => `/admin/footers/sections/${a.section_id}`,
    body: (a) => ({
      title: a.title,
      group: a.group,
      platform: a.platform,
      icon_media_id: a.icon_media_id,
      doctors_image_id: a.doctors_image_id,
      is_active: a.is_active,
      order: a.order,
    }),
    checks: (a) =>
      ensureVocabulary([
        ["footer_section_group", a.group],
        ["footer_section_platform", a.platform],
      ]),
    echo: ["section_id"],
  });

  registerWrite(server, {
    name: "delete_footer_section",
    title: "Delete a footer column",
    description:
      "Removes one column and its links from ONE language's footer. The other languages keep " +
      "theirs.",
    params: { section_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/footers/sections/${a.section_id}`,
    destructive: true,
    echo: ["section_id"],
  });

  registerWrite(server, {
    name: "create_footer_item",
    title: "Add a link to a footer column",
    description:
      "Adds one row to a footer column. `type` decides the icon and the handling: 'mail' and " +
      "'call' expect a bare address or number in url, 'text' is not a link at all, and 'url' " +
      "renders an Instagram icon whatever the destination is.",
    params: {
      section_id: z.number().int(),
      label: z.string(),
      url: z.string().optional(),
      type: z.string().optional().describe("url | mail | call | text | button."),
      button_text: z.string().optional(),
      is_active: z.boolean().optional(),
      order,
    },
    method: "post",
    path: (a) => `/admin/footers/sections/${a.section_id}/items`,
    body: (a) => ({
      label: a.label,
      url: a.url,
      type: a.type,
      button_text: a.button_text,
      is_active: a.is_active,
      order: a.order,
    }),
    checks: (a) => ensureVocabulary([["footer_item_type", a.type]]),
    echo: ["section_id"],
  });

  registerWrite(server, {
    name: "update_footer_item",
    title: "Update a footer link",
    description: "Changes one footer row's label, destination, type or position.",
    params: {
      section_id: z.number().int(),
      item_id: z.number().int(),
      label: z.string().optional(),
      url: z.string().optional(),
      type: z.string().optional(),
      button_text: z.string().optional(),
      is_active: z.boolean().optional(),
      order,
    },
    method: "put",
    path: (a) => `/admin/footers/sections/${a.section_id}/items/${a.item_id}`,
    body: (a) => ({
      label: a.label,
      url: a.url,
      type: a.type,
      button_text: a.button_text,
      is_active: a.is_active,
      order: a.order,
    }),
    checks: (a) => ensureVocabulary([["footer_item_type", a.type]]),
    echo: ["section_id", "item_id"],
  });

  registerWrite(server, {
    name: "delete_footer_item",
    title: "Delete a footer link",
    description: "Removes one row from a footer column.",
    params: { section_id: z.number().int(), item_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/footers/sections/${a.section_id}/items/${a.item_id}`,
    destructive: true,
    echo: ["section_id", "item_id"],
  });

  // ---- Multi-step forms ---------------------------------------------------
  registerWrite(server, {
    name: "update_multi_page_form",
    title: "Update a multi-step form",
    description:
      "Changes the form's code and where its leads go. form_code is the contract with the " +
      "site: a link whose href is 'modal-dialog-<code>' opens this form, so renaming the code " +
      "breaks every button pointing at the old one while leaving them looking fine.",
    params: {
      multi_page_form_id: z.number().int(),
      form_code: z.string().optional(),
      forward_to_email: z.string().optional(),
      send_to_zapier: z.boolean().optional(),
    },
    method: "put",
    path: (a) => `/admin/multi-page-form/${a.multi_page_form_id}`,
    body: (a) => ({
      form_code: a.form_code,
      forward_to_email: a.forward_to_email,
      send_to_zapier: a.send_to_zapier,
    }),
    echo: ["multi_page_form_id"],
  });

  registerWrite(server, {
    name: "create_form_page",
    title: "Add a step to a multi-step form",
    description:
      "Adds one step to ONE language of the form — steps are per-language, so a step added " +
      "in English does not exist in Italian and that language's form simply has fewer steps. " +
      "The fields and choices go in afterwards with create_form_field / create_form_option.",
    params: {
      multi_page_form_id: z.number().int(),
      language_id: languageId,
      title: z.string(),
      description: z.string().optional(),
      privacy_and_policy_text: z.string().optional(),
      sort_order: order,
    },
    method: "post",
    path: (a) =>
      `/admin/multi-page-form/${a.multi_page_form_id}/translations/${a.language_id}/pages`,
    body: (a) => ({
      title: a.title,
      description: a.description,
      privacy_and_policy_text: a.privacy_and_policy_text,
      sort_order: a.sort_order,
    }),
    echo: ["multi_page_form_id", "language_id"],
  });

  registerWrite(server, {
    name: "update_form_page",
    title: "Update a form step",
    description: "Changes one step's heading, help text or position.",
    params: {
      page_id: z.number().int(),
      title: z.string().optional(),
      description: z.string().optional(),
      privacy_and_policy_text: z.string().optional(),
      sort_order: order,
    },
    method: "put",
    path: (a) => `/admin/multi-page-form/pages/${a.page_id}`,
    body: (a) => ({
      title: a.title,
      description: a.description,
      privacy_and_policy_text: a.privacy_and_policy_text,
      sort_order: a.sort_order,
    }),
    echo: ["page_id"],
  });

  registerWrite(server, {
    name: "delete_form_page",
    title: "Delete a form step",
    description: "Removes one step, with its fields and options, from that language's form.",
    params: { page_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/multi-page-form/pages/${a.page_id}`,
    destructive: true,
    echo: ["page_id"],
  });

  registerWrite(server, {
    name: "create_form_field",
    title: "Add an input to a form step",
    description:
      "Adds one input. field_type is what routes the answer: 'name', 'email', 'mobile' and " +
      "their siblings put the value into the lead record, and anything else is stored as a " +
      "plain answer. A misspelt routing type still renders a text box, and the lead then " +
      "arrives with no phone number.",
    params: {
      page_id: z.number().int(),
      field_type: z
        .string()
        .describe("name | firstName | lastName | email | mobile | phone | date | number | checkbox | 'Large text'."),
      label: z.string(),
      placeholder: z.string().optional(),
      help_text: z.string().optional(),
      is_required: z.boolean().optional(),
      sort_order: order,
    },
    method: "post",
    path: (a) => `/admin/multi-page-form/pages/${a.page_id}/fields`,
    body: (a) => ({
      field_type: a.field_type,
      label: a.label,
      placeholder: a.placeholder,
      help_text: a.help_text,
      is_required: a.is_required,
      sort_order: a.sort_order,
    }),
    checks: (a) => ensureVocabulary([["form_field_type", a.field_type]]),
    echo: ["page_id"],
  });

  registerWrite(server, {
    name: "update_form_field",
    title: "Update a form input",
    description: "Changes one input's type, label, placeholder or required flag.",
    params: {
      field_id: z.number().int(),
      field_type: z.string().optional(),
      label: z.string().optional(),
      placeholder: z.string().optional(),
      help_text: z.string().optional(),
      is_required: z.boolean().optional(),
      sort_order: order,
    },
    method: "put",
    path: (a) => `/admin/multi-page-form/pages/fields/${a.field_id}`,
    body: (a) => ({
      field_type: a.field_type,
      label: a.label,
      placeholder: a.placeholder,
      help_text: a.help_text,
      is_required: a.is_required,
      sort_order: a.sort_order,
    }),
    checks: (a) => ensureVocabulary([["form_field_type", a.field_type]]),
    echo: ["field_id"],
  });

  registerWrite(server, {
    name: "delete_form_field",
    title: "Delete a form input",
    description: "Removes one input from a step.",
    params: { field_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/multi-page-form/pages/fields/${a.field_id}`,
    destructive: true,
    echo: ["field_id"],
  });

  registerWrite(server, {
    name: "create_form_option",
    title: "Add a choice to a form step",
    description:
      "Adds one selectable answer to a step — the cards the visitor taps before moving on.",
    params: {
      page_id: z.number().int(),
      option_text: z.string(),
      sort_order: order,
    },
    method: "post",
    path: (a) => `/admin/multi-page-form/pages/${a.page_id}/options`,
    body: (a) => ({ option_text: a.option_text, sort_order: a.sort_order }),
    echo: ["page_id"],
  });

  registerWrite(server, {
    name: "update_form_option",
    title: "Update a form choice",
    description: "Changes one choice's wording or position.",
    params: {
      option_id: z.number().int(),
      option_text: z.string().optional(),
      sort_order: order,
    },
    method: "put",
    path: (a) => `/admin/multi-page-form/pages/options/${a.option_id}`,
    body: (a) => ({ option_text: a.option_text, sort_order: a.sort_order }),
    echo: ["option_id"],
  });

  registerWrite(server, {
    name: "delete_form_option",
    title: "Delete a form choice",
    description: "Removes one selectable answer from a step.",
    params: { option_id: z.number().int() },
    method: "delete",
    path: (a) => `/admin/multi-page-form/pages/options/${a.option_id}`,
    destructive: true,
    echo: ["option_id"],
  });

  server.registerTool(
    "list_form_submissions",
    {
      title: "List a form's submissions",
      description:
        "The leads a multi-step form has collected, newest first. Use it to check a form is " +
        "actually wired up before pointing buttons at it. Requires login.",
      inputSchema: {
        project: projectParam,
        multi_page_form_id: z.number().int(),
        limit: z.number().int().min(1).max(100).default(20),
        page: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, multi_page_form_id, ...query }) =>
      guard(async () => {
        const response = await get<Envelope<unknown>>(
          project,
          `/admin/multi-page-form/${multi_page_form_id}/submissions`,
          query,
        );
        return ok({ project, multi_page_form_id, data: response.data });
      }),
  );
}
