/**
 * The process block's fields shared by create_process (components.ts) and the
 * edit tools (structure.ts), so both describe the two designs the same way.
 */

import { z } from "zod";

export const PROCESS_STYLE_TEXT =
  "1: the recovery roadmap. 2: the v8 journey on the brand's navy — eyebrow and title with " +
  "the button beside them, then a straight line of numbered step circles ('STEP n' over " +
  "each, the last a filled circle with a star), each step a card with its photo (image_id), " +
  "title and description; on phones the line runs down the left.";

export const processStyleParam = z.union([z.literal(1), z.literal(2)]);

export const PROCESS_EYEBROW_TEXT =
  "Style 2: the small heading over the title, e.g. 'YOUR JOURNEY'.";

export const PROCESS_STEP_IMAGE_TEXT =
  "Style 2: the step's photo, the top of its card (a media id). It is the step's, so the " +
  "same in every language.";
