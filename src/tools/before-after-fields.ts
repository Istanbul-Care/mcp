/**
 * A before/after case's fields, shared by create_before_after's inline
 * gallery_items (components.ts) and create_gallery_item / update_gallery_item
 * (structure.ts), so all three describe a case the same way.
 *
 * A case is one gallery item. style_5 shows each case from several angles
 * (Front, Left, Right, Top…) with a category filter (FUE, DHI, Afro, Women…).
 * Both lists are the brand's own, each name per language — the
 * *_before_after_angle and *_before_after_category tools keep them, and they
 * have to exist before a case can point at them.
 */

import { z } from "zod";

export const caseAngleParam = z
  .number()
  .int()
  .nullable()
  .describe(
    "The angle of the case's own pair (before_media_id / after_media_id), from " +
      "list_before_after_angles. On update: sent = set, null clears it, left out = unchanged.",
  );

export const caseMonthsAfterParam = z
  .number()
  .int()
  .min(0)
  .max(600)
  .nullable()
  .describe(
    "How many months after the operation the after photos were taken (0–600). On update: " +
      "sent = set, null clears it, left out = unchanged.",
  );

export const caseCategoryIdsParam = z
  .array(z.number().int())
  .describe(
    "The categories the case is in (list_before_after_categories) — the style_5 gallery's " +
      "filter; a case can be in several. On update the list sent REPLACES the case's " +
      "categories ([] takes it out of all of them); left out = unchanged.",
  );

export const caseViewsParam = z
  .array(
    z.object({
      angle_id: z.number().int().describe("From list_before_after_angles."),
      before_media_id: z.number().int().nullable().optional().describe("The before photo at this angle (a media id)."),
      after_media_id: z.number().int().nullable().optional().describe("The after photo at this angle (a media id)."),
    }),
  )
  .describe(
    "The case's OTHER angles, each with its own before and after photo. Each angle once per " +
      "case, the own pair's angle_id included (the API refuses a repeat). On update the list " +
      "sent REPLACES every other angle ([] removes them all); left out = unchanged. The site " +
      "shows them in the brand's angle order, the own pair among them.",
  );

/** Every case field, as the create endpoints take them. */
export const caseFields = {
  before_media_id: z.number().int().optional().describe("The before photo (a media id)."),
  after_media_id: z.number().int().optional().describe("The after photo (a media id)."),
  sex: z.string().max(255).optional(),
  technique: z.string().max(255).optional(),
  graft: z.string().max(255).optional(),
  age: z.string().max(255).optional(),
  sort_order: z.number().int().min(0).optional().describe("Lower sorts first."),
  angle_id: caseAngleParam.optional(),
  months_after: caseMonthsAfterParam.optional(),
  category_ids: caseCategoryIdsParam.optional(),
  views: caseViewsParam.optional(),
};

/** The case fields that only style_5 shows, picked off a tool's arguments. */
export function caseTagFields(args: Record<string, unknown>): Record<string, unknown> {
  return {
    angle_id: args.angle_id,
    months_after: args.months_after,
    category_ids: args.category_ids,
    views: args.views,
  };
}

export const BEFORE_AFTER_STYLE_TEXT =
  "style_1 … style_5 (get_vocabularies before_after_style). style_5 = cases by angle: each " +
  "case's photos from several angles with a category filter, using each case's angle_id, " +
  "views, category_ids and months_after — create the angles and categories first " +
  "(create_before_after_angle / create_before_after_category).";
