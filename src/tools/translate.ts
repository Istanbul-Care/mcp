/**
 * Translation, in three layers:
 *
 *   1. `auto_translate*` — drive the backend's own LLM translation of a single
 *      post / service / page.
 *   2. `translate_everything` + `_status` — sweep a whole brand, throttled.
 *   3. `translation_coverage`, `translation_worklist`, `save_translations` —
 *      the other 27 surfaces, which no endpoint translates for us. The agent
 *      pulls source strings and writes back its own rendering.
 *
 * Everything is keyed by language code, never hard-coded to a language: doing
 * Arabic and doing Greek next month are the same call with a different string.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post, put, ApiError } from "../api/client.js";
import { getProject, type ProjectId } from "../config/projects.js";
import { slugify } from "../lib/slug.js";
import { resolveInternalLink } from "../lib/links.js";
import {
  SURFACES,
  SURFACE_TYPES,
  getSurface,
  fillPath,
  type TranslatableSurface,
} from "../lib/translatable.js";
import {
  fetchSurfaceRows,
  findTranslation,
  measureCoverage,
  type SurfaceRow,
  type TranslationRow,
} from "../lib/translation-scan.js";
import {
  countByStatus,
  getBatch,
  isFinished,
  listBatches,
  newBatchId,
  saveBatch,
  type Batch,
  type BatchItem,
} from "../lib/translate-batch.js";
import {
  ok,
  fail,
  guard,
  projectParam,
  ensureWritable,
  getActiveLanguageCodes,
  resolveLanguageIds,
} from "./helpers.js";

/** The three entities the backend can machine-translate on its own. */
const LLM_ENTITIES = {
  post: { segment: "posts", flags: ["translate_faqs"] },
  service: { segment: "services", flags: ["translate_cards"] },
  page: { segment: "pages", flags: ["translate_cards", "translate_faqs"] },
} as const;

type LlmEntity = keyof typeof LLM_ENTITIES;

const entityTypeParam = z
  .enum(["post", "service", "page"])
  .describe("Which entity the auto-translate endpoints act on.");

interface AutoTranslateAccepted {
  job_id: number;
  status_url: string;
  target_language_codes: string[];
}

interface AutoTranslateJobStatus {
  job_id: number;
  status: string;
  total: number;
  done: number;
  current?: string | null;
  languages: Record<string, { status: string; error?: string | null }>;
  error?: string | null;
}

function autoTranslateBody(
  entityType: LlmEntity,
  source: string,
  targets: string[] | undefined,
  overwrite: boolean,
  translateFaqs: boolean | undefined,
  translateCards: boolean | undefined,
): Record<string, unknown> {
  const supported: readonly string[] = LLM_ENTITIES[entityType].flags;
  const body: Record<string, unknown> = {
    source_language_code: source,
    target_language_codes: targets,
    overwrite,
  };
  // Omitted flags fall through to the backend's defaults, which are `true` for
  // both — a sweep that silently skipped FAQs and cards would not be "every
  // where" in any useful sense.
  if (supported.includes("translate_faqs") && translateFaqs !== undefined) {
    body.translate_faqs = translateFaqs;
  }
  if (supported.includes("translate_cards") && translateCards !== undefined) {
    body.translate_cards = translateCards;
  }
  return body;
}

/** Start one auto-translate job. Returns the job id. */
async function startJob(
  project: ProjectId,
  entityType: LlmEntity,
  entityId: number,
  body: Record<string, unknown>,
): Promise<AutoTranslateAccepted> {
  return post<AutoTranslateAccepted>(
    project,
    `/admin/${LLM_ENTITIES[entityType].segment}/${entityId}/auto-translate`,
    body,
  );
}

async function readJob(
  project: ProjectId,
  segment: string,
  entityId: number,
  jobId?: number,
): Promise<AutoTranslateJobStatus> {
  const response = await get<{ data: AutoTranslateJobStatus }>(
    project,
    `/admin/${segment}/${entityId}/auto-translate/status`,
    { job_id: jobId },
  );
  return response.data;
}

/**
 * Resolve the languages a sweep should fill.
 *
 * Omitting them means "every active language except the source", which is what
 * makes this generic — Arabic today is `["ar"]`, the full set is no argument.
 */
async function resolveTargets(
  project: ProjectId,
  source: string,
  requested: string[] | undefined,
): Promise<string[]> {
  const active = await getActiveLanguageCodes(project);
  const wanted = (requested ?? active).map((code) => code.toLowerCase());
  const targets = wanted.filter((code) => code !== source.toLowerCase());

  const unknown = targets.filter((code) => !active.includes(code));
  if (unknown.length > 0) {
    throw new Error(
      `Not an active language on '${project}': ${unknown.join(", ")}. Active: ${active.join(", ")}.`,
    );
  }
  if (targets.length === 0) {
    throw new Error(`No target languages left after excluding the source '${source}'.`);
  }
  return targets;
}

function selectSurfaces(types: string[] | undefined): TranslatableSurface[] {
  if (!types || types.length === 0) return SURFACES;
  return types.map(getSurface);
}

// --- The manual side ---------------------------------------------------------

/** Fields the agent is expected to translate, as opposed to derived or copied. */
function translatableFields(surface: TranslatableSurface): string[] {
  return surface.fields
    .filter((field) => field.kind === "text" || field.kind === "html")
    .map((field) => field.name);
}

async function localizeUrl(
  project: ProjectId,
  value: unknown,
  targetLanguage: string,
  locales: readonly string[],
): Promise<unknown> {
  if (typeof value !== "string" || !value.trim()) return value;
  const resolved = await resolveInternalLink(project, value, targetLanguage, locales);
  // An unresolvable href is almost always external (or already dead); keeping
  // the source value is the conservative move — this is not a link fixer.
  return resolved.resolved && resolved.url ? resolved.url : value;
}

interface ComposeOptions {
  project: ProjectId;
  surface: TranslatableSurface;
  source: TranslationRow;
  supplied: Record<string, unknown>;
  targetLanguage: string;
  locales: readonly string[];
  localizeUrls: boolean;
}

/**
 * Build the translation payload: the agent's text, plus the fields it should
 * not be inventing — slugs derived the way the backend derives them, verbatim
 * columns copied off the source row, internal URLs pointed at the new language.
 */
async function composePayload(options: ComposeOptions): Promise<Record<string, unknown>> {
  const { project, surface, source, supplied, targetLanguage, locales, localizeUrls } =
    options;
  const payload: Record<string, unknown> = {};

  for (const field of surface.fields) {
    const given = supplied[field.name];

    switch (field.kind) {
      case "verbatim": {
        const value = source.values[field.name];
        if (value !== undefined && value !== null) payload[field.name] = value;
        break;
      }
      case "slug": {
        const explicit = typeof given === "string" && given.trim() ? given : "";
        let derived = slugify(explicit || String(supplied[field.from ?? "title"] ?? ""));
        if (!derived) {
          // A non-Latin title (Arabic, Chinese…) slugifies to empty, but the
          // backend still requires a slug on these endpoints. Per product
          // direction the slug may stay Latin, so take the source row's slug and
          // append the language — this keeps it unique whether the entity's slug
          // uniqueness is per-language or global (post/FAQ categories are global,
          // so a bare copy of the English slug would collide).
          const sourceSlug = source.values[field.name];
          const base =
            (typeof sourceSlug === "string" && sourceSlug) ||
            slugify(String(source.values[field.from ?? "title"] ?? ""));
          if (base) derived = `${base}-${targetLanguage}`;
        }
        if (derived) payload[field.name] = derived;
        break;
      }
      case "url": {
        const base = given ?? source.values[field.name];
        payload[field.name] = localizeUrls
          ? await localizeUrl(project, base, targetLanguage, locales)
          : base;
        break;
      }
      default: {
        if (given !== undefined) {
          payload[field.name] =
            typeof given === "string" && field.maxLength && given.length > field.maxLength
              ? given.slice(0, field.maxLength)
              : given;
        }
      }
    }
  }

  // Never post an empty string where the source had nothing.
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) delete payload[key];
  }
  return payload;
}

async function writeTranslation(
  project: ProjectId,
  surface: TranslatableSurface,
  row: SurfaceRow,
  languageCode: string,
  languageId: number,
  payload: Record<string, unknown>,
): Promise<"created" | "updated"> {
  const existing = findTranslation(row, languageCode);

  if (surface.write.mode === "embedded") {
    // The PUT replaces the whole translation set, so every existing row has to
    // be re-sent alongside the new one or it is dropped. Rebuild each kept row
    // from this surface's own fields, keyed the way the endpoint expects.
    const keyOf = (
      languageIdValue: number | null,
      code: string,
    ): Record<string, unknown> =>
      surface.write.key === "language_id"
        ? { language_id: languageIdValue }
        : { language_code: code };

    const fieldNames = surface.fields.map((field) => field.name);
    const kept = row.translations
      .filter((translation) => translation.languageCode !== languageCode.toLowerCase())
      .map((translation) => {
        const kv: Record<string, unknown> = keyOf(
          translation.languageId,
          translation.languageCode,
        );
        for (const name of fieldNames) {
          const value = translation.values[name];
          if (value !== undefined && value !== null) kv[name] = value;
        }
        return kv;
      });

    await put(project, fillPath(surface.write.put, { id: row.id }), {
      translations: [
        ...kept,
        { ...keyOf(languageId, languageCode), ...payload },
      ],
    });
    return existing ? "updated" : "created";
  }

  // When the endpoint has a per-language PUT and the row already exists, update
  // it. Media has no PUT — its POST upserts — so it always falls through to POST.
  if (existing && existing.languageId !== null && surface.write.update) {
    await put(
      project,
      fillPath(surface.write.update, {
        id: row.id,
        parent: row.parentId,
        language: existing.languageId,
      }),
      payload,
    );
    return "updated";
  }

  try {
    await post(project, fillPath(surface.write.create, { id: row.id, parent: row.parentId }), {
      ...payload,
      [surface.write.key]: surface.write.key === "language_id" ? languageId : languageCode,
    });
    return existing ? "updated" : "created";
  } catch (error) {
    // The list endpoint can omit a translation row that the backend actually
    // holds — e.g. a half-written row left by an interrupted run — so `existing`
    // reads false and we POST, which the backend rejects as a duplicate. Fall
    // back to the per-language PUT to update the orphaned row in place.
    if (
      error instanceof ApiError &&
      error.status === 400 &&
      /already exist/i.test(error.detail) &&
      surface.write.update
    ) {
      await put(
        project,
        fillPath(surface.write.update, {
          id: row.id,
          parent: row.parentId,
          language: languageId,
        }),
        payload,
      );
      return "updated";
    }
    throw error;
  }
}

// --- Tools -------------------------------------------------------------------

export function registerTranslateTools(server: McpServer): void {
  server.registerTool(
    "auto_translate",
    {
      title: "Machine-translate one post, service or page",
      description:
        "Starts the backend's LLM translation of a single post, service or page from one " +
        "language into others. Internal links are re-localised, meta comes out at SEO " +
        "sizes, slugs come out ASCII. Returns a job id immediately — poll " +
        "auto_translate_status. By default only fills MISSING languages; set overwrite:true " +
        "to redo existing ones. For a whole brand at once use translate_everything. " +
        "Requires login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        entity_type: entityTypeParam,
        entity_id: z.number().int(),
        source_language_code: z.string().min(2).describe("Language to translate FROM, e.g. 'en'."),
        target_language_codes: z
          .array(z.string())
          .optional()
          .describe("Languages to translate INTO. Omit to fill every missing active language."),
        overwrite: z.boolean().default(false),
        translate_faqs: z
          .boolean()
          .optional()
          .describe("Posts and pages only. Defaults to true server-side."),
        translate_cards: z
          .boolean()
          .optional()
          .describe("Services and pages only — a service's body lives in its cards. Defaults to true server-side."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({
      project,
      entity_type,
      entity_id,
      source_language_code,
      target_language_codes,
      overwrite,
      translate_faqs,
      translate_cards,
    }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        const response = await startJob(
          project,
          entity_type,
          entity_id,
          autoTranslateBody(
            entity_type,
            source_language_code,
            target_language_codes,
            overwrite,
            translate_faqs,
            translate_cards,
          ),
        );
        return ok({
          project,
          entity_type,
          entity_id,
          job_id: response.job_id,
          translating_into: response.target_language_codes,
          note:
            `Running in the background. Poll auto_translate_status({ project: "${project}", ` +
            `entity_type: "${entity_type}", entity_id: ${entity_id}, job_id: ${response.job_id} }). ` +
            `New translations are created as drafts — review and publish separately.`,
        });
      }),
  );

  server.registerTool(
    "auto_translate_status",
    {
      title: "Check an auto-translate job",
      description:
        "Progress and per-language outcome of an auto-translate run on one post, service or " +
        "page. For any language that was not saved, the entry's 'error' explains why. Omit " +
        "job_id for the entity's latest run. Requires login.",
      inputSchema: {
        project: projectParam,
        entity_type: entityTypeParam,
        entity_id: z.number().int(),
        job_id: z.number().int().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, entity_type, entity_id, job_id }) =>
      guard(async () => {
        const job = await readJob(
          project,
          LLM_ENTITIES[entity_type].segment,
          entity_id,
          job_id,
        );
        return ok({
          project,
          entity_type,
          entity_id,
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
        "Reverses an auto-translate run on one post, service or page: translations it " +
        "created are deleted, ones it overwrote are restored from the pre-run snapshot. Omit " +
        "job_id for the latest run, or pass languages to roll back only some. Requires login " +
        "and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        entity_type: entityTypeParam,
        entity_id: z.number().int(),
        job_id: z.number().int().optional(),
        languages: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ project, entity_type, entity_id, job_id, languages }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        const response = await post<{ message: string }>(
          project,
          `/admin/${LLM_ENTITIES[entity_type].segment}/${entity_id}/auto-translate/rollback`,
          { job_id, languages },
        );
        return ok({ project, entity_type, entity_id, rolled_back: true, detail: response.message });
      }),
  );

  server.registerTool(
    "translation_coverage",
    {
      title: "What is untranslated, everywhere",
      description:
        "Sweeps every translatable surface of a brand — posts, services, pages, taxonomy, " +
        "heroes, sliders, packages, price comparisons, processes, promotional landings, " +
        "before/afters, forms, menus, footers, global settings — and reports, per content " +
        "type, how many rows are missing each language. Read-only; this is the tool to run " +
        "before and after a sweep. Slow (it pages through ~30 endpoints). Requires login.",
      inputSchema: {
        project: projectParam,
        source_language_code: z
          .string()
          .optional()
          .describe("Language to translate FROM. Defaults to the brand's default language."),
        target_language_codes: z
          .array(z.string())
          .optional()
          .describe("Languages to check. Omit for every active language."),
        types: z
          .array(z.enum(SURFACE_TYPES))
          .optional()
          .describe("Restrict to some content types. Omit for all of them."),
        include_items: z
          .boolean()
          .default(false)
          .describe("Include the ids and titles of missing rows, not just counts."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, source_language_code, target_language_codes, types, include_items }) =>
      guard(async () => {
        const source = (source_language_code ?? getProject(project).defaultLanguage).toLowerCase();
        const targets = await resolveTargets(project, source, target_language_codes);
        const surfaces = selectSurfaces(types);

        const report: Record<string, unknown>[] = [];
        const failures: Record<string, string> = {};
        const totals: Record<string, number> = {};
        const incomplete: string[] = [];

        for (const surface of surfaces) {
          let rows: SurfaceRow[];
          try {
            const scan = await fetchSurfaceRows(project, surface);
            rows = scan.rows;
            if (scan.truncated) incomplete.push(surface.type);
          } catch (error) {
            failures[surface.type] = error instanceof Error ? error.message : String(error);
            continue;
          }

          const coverage = measureCoverage(surface, rows, source, targets);
          const missingCounts: Record<string, number> = {};
          for (const target of targets) {
            const rowsMissing = coverage.missing[target] ?? [];
            missingCounts[target] = rowsMissing.length;
            totals[target] = (totals[target] ?? 0) + rowsMissing.length;
          }
          if (coverage.total === 0) continue;

          report.push({
            type: surface.type,
            label: surface.label,
            translated_by: surface.llm ? "backend LLM" : "agent",
            rows: coverage.total,
            missing: missingCounts,
            no_source_row: coverage.unsourced.length,
            ...(include_items
              ? {
                  missing_items: Object.fromEntries(
                    targets.map((target) => [
                      target,
                      (coverage.missing[target] ?? []).map((row) => ({
                        id: row.id,
                        parent_id: row.parentId,
                        label: row.label,
                      })),
                    ]),
                  ),
                }
              : {}),
          });
        }

        return ok({
          project,
          source_language_code: source,
          target_language_codes: targets,
          missing_totals: totals,
          by_type: report,
          ...(Object.keys(failures).length > 0 ? { unreadable_types: failures } : {}),
          ...(incomplete.length > 0
            ? {
                partially_read_types: incomplete,
                partial_read_warning:
                  "These types have more rows than the walk reads, so their counts are a " +
                  "floor, not a total. Narrow the sweep with `types` and handle them separately.",
              }
            : {}),
          note:
            "Types marked 'backend LLM' are filled by translate_everything. Types marked " +
            "'agent' have no machine-translation endpoint — pull them with " +
            "translation_worklist and write them back with save_translations.",
        });
      }),
  );

  server.registerTool(
    "translate_everything",
    {
      title: "Translate a whole brand into a language",
      description:
        "The sweep. Finds every post, service and page missing the target language(s) and " +
        "queues the backend's LLM translation for them, a few at a time — the backend runs " +
        "these in-process with no queue of its own, so they must be throttled from here. " +
        "Returns a batch id; poll translate_everything_status, which also starts the next " +
        "ones as slots free up. Content types with no machine-translation endpoint are " +
        "reported, not started — use translation_worklist for those. Requires login and a " +
        "write-enabled brand.",
      inputSchema: {
        project: projectParam,
        target_language_codes: z
          .array(z.string())
          .optional()
          .describe("Languages to fill, e.g. ['ar']. Omit for every active language."),
        source_language_code: z
          .string()
          .optional()
          .describe("Language to translate FROM. Defaults to the brand's default language."),
        types: z
          .array(z.enum(SURFACE_TYPES))
          .optional()
          .describe("Restrict to some content types. Omit for all of them."),
        overwrite: z
          .boolean()
          .default(false)
          .describe("Redo languages that already exist instead of only filling gaps."),
        concurrency: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(2)
          .describe("How many jobs may run at once. The backend has no queue — keep this low."),
        max_items: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(500)
          .describe("Cap on entities queued in one batch."),
        dry_run: z
          .boolean()
          .default(false)
          .describe("Report what would be queued without starting anything."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({
      project,
      target_language_codes,
      source_language_code,
      types,
      overwrite,
      concurrency,
      max_items,
      dry_run,
    }) =>
      guard(async () => {
        if (!dry_run) {
          const blocked = ensureWritable(project);
          if (blocked) return fail(blocked);
        }

        const source = (source_language_code ?? getProject(project).defaultLanguage).toLowerCase();
        const targets = await resolveTargets(project, source, target_language_codes);
        const surfaces = selectSurfaces(types);

        const items: BatchItem[] = [];
        const manual: Record<string, unknown>[] = [];
        const failures: Record<string, string> = {};
        const incomplete: string[] = [];
        let truncated = false;

        for (const surface of surfaces) {
          let rows: SurfaceRow[];
          try {
            const scan = await fetchSurfaceRows(project, surface);
            rows = scan.rows;
            if (scan.truncated) incomplete.push(surface.type);
          } catch (error) {
            failures[surface.type] = error instanceof Error ? error.message : String(error);
            continue;
          }
          const coverage = measureCoverage(surface, rows, source, targets);

          if (surface.llm === null) {
            const missing = Object.values(coverage.missing).reduce(
              (sum, list) => sum + list.length,
              0,
            );
            if (missing > 0) {
              manual.push({ type: surface.type, label: surface.label, missing_rows: missing });
            }
            continue;
          }

          // One job per entity covers all of its missing languages at once.
          const needing = new Map<number, SurfaceRow>();
          for (const target of targets) {
            for (const row of coverage.missing[target] ?? []) needing.set(row.id, row);
          }
          if (overwrite) {
            for (const row of rows) {
              if (findTranslation(row, source)) needing.set(row.id, row);
            }
          }

          for (const row of needing.values()) {
            if (items.length >= max_items) {
              truncated = true;
              break;
            }
            items.push({
              type: surface.type,
              entity: surface.llm,
              id: row.id,
              label: row.label,
              status: "queued",
            });
          }
        }

        if (dry_run) {
          return ok({
            project,
            dry_run: true,
            source_language_code: source,
            target_language_codes: targets,
            would_queue: items.length,
            by_type: countTypes(items),
            manual_types: manual,
            ...(truncated ? { truncated_at: max_items } : {}),
            ...(incomplete.length > 0 ? { partially_read_types: incomplete } : {}),
            ...(Object.keys(failures).length > 0 ? { unreadable_types: failures } : {}),
          });
        }

        const batch: Batch = {
          id: newBatchId(),
          project,
          created_at: new Date().toISOString(),
          source_language_code: source,
          target_language_codes: targets,
          overwrite,
          concurrency,
          items,
        };

        const started = await fillSlots(batch);
        saveBatch(batch);

        return ok({
          project,
          batch_id: batch.id,
          source_language_code: source,
          target_language_codes: targets,
          queued: items.length,
          started_now: started,
          by_type: countTypes(items),
          manual_types: manual,
          ...(truncated ? { truncated_at: max_items } : {}),
          ...(incomplete.length > 0 ? { partially_read_types: incomplete } : {}),
          ...(Object.keys(failures).length > 0 ? { unreadable_types: failures } : {}),
          note:
            items.length === 0
              ? "Nothing to do — every post, service and page already has these languages."
              : `Poll translate_everything_status({ project: "${project}", batch_id: "${batch.id}" }) ` +
                `until it reports finished; each poll starts the next queued entities. ` +
                (manual.length > 0
                  ? `The types under manual_types have no machine-translation endpoint — ` +
                    `translate those with translation_worklist + save_translations.`
                  : ""),
        });
      }),
  );

  server.registerTool(
    "translate_everything_status",
    {
      title: "Poll and advance a brand-wide translation sweep",
      description:
        "Progress of a translate_everything batch. Each call reads the running jobs and " +
        "starts queued ones as slots free up, so poll it until finished:true — the sweep " +
        "does not advance on its own. Omit batch_id for the brand's latest batch. Requires " +
        "login and a write-enabled brand.",
      inputSchema: {
        project: projectParam,
        batch_id: z.string().optional(),
        include_items: z.boolean().default(false).describe("List every entity, not just counts."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, batch_id, include_items }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        const batch = getBatch(project, batch_id);
        if (!batch) {
          const known = listBatches(project).map((candidate) => candidate.id);
          return fail(
            batch_id
              ? `No batch '${batch_id}' for '${project}'. Known: ${known.join(", ") || "none"}.`
              : `No translate_everything batch has been started for '${project}' yet.`,
          );
        }

        for (const item of batch.items) {
          if (item.status !== "running" || item.job_id === undefined) continue;
          try {
            const job = await readJob(
              project,
              LLM_ENTITIES[surfaceEntity(item)].segment,
              item.id,
              item.job_id,
            );
            item.progress = `${job.done}/${job.total}`;
            item.languages = job.languages;
            if (job.status === "completed") item.status = "done";
            else if (job.status === "failed") {
              item.status = "failed";
              item.error = job.error ?? "job failed";
            }
          } catch (error) {
            item.status = "failed";
            item.error = error instanceof Error ? error.message : String(error);
          }
        }

        const started = await fillSlots(batch);
        saveBatch(batch);

        const counts = countByStatus(batch);
        const finished = isFinished(batch);
        const failed = batch.items.filter((item) => item.status === "failed");

        return ok({
          project,
          batch_id: batch.id,
          finished,
          started_now: started,
          counts,
          target_language_codes: batch.target_language_codes,
          ...(failed.length > 0
            ? {
                failures: failed.map((item) => ({
                  type: item.type,
                  id: item.id,
                  label: item.label,
                  error: item.error,
                })),
              }
            : {}),
          ...(include_items ? { items: batch.items } : {}),
          note: finished
            ? "Sweep complete. Translations were created as drafts — review and publish them."
            : `Still going. Poll again in a minute or two; ${counts.queued} queued, ${counts.running} running.`,
        });
      }),
  );

  server.registerTool(
    "translation_worklist",
    {
      title: "Pull source strings that need translating by hand",
      description:
        "The other side of the sweep. For content types with no machine-translation endpoint " +
        "(taxonomy, heroes, sliders, cards, packages, processes, forms, menus, footers, " +
        "global settings…), returns the source strings of rows missing a language, in " +
        "batches. YOU translate the returned `fields` and write them back with " +
        "save_translations — slugs, URLs and non-prose columns are handled for you, so only " +
        "translate what is in `fields`. Requires login.",
      inputSchema: {
        project: projectParam,
        target_language_code: z.string().min(2).describe("The language to produce, e.g. 'ar'."),
        source_language_code: z
          .string()
          .optional()
          .describe("Language to translate FROM. Defaults to the brand's default language."),
        types: z
          .array(z.enum(SURFACE_TYPES))
          .optional()
          .describe("Restrict to some content types. Omit for every agent-translated type."),
        limit: z.number().int().min(1).max(100).default(25).describe("Max rows to return."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, target_language_code, source_language_code, types, limit }) =>
      guard(async () => {
        const source = (source_language_code ?? getProject(project).defaultLanguage).toLowerCase();
        const target = target_language_code.toLowerCase();
        const { items, remaining } = await collectWorklist(project, source, target, types, limit);

        return ok({
          project,
          source_language_code: source,
          target_language_code: target,
          returned: items.length,
          more_remaining: remaining,
          items,
          note:
            items.length === 0
              ? "Nothing left — every agent-translated row already has this language."
              : "Translate each item's `fields` into " +
                `'${target}' and pass them back to save_translations with the same type, id ` +
                "and parent_id. Keep HTML markup intact; translate only the text between " +
                "tags. Then call this tool again for the next batch.",
        });
      }),
  );

  server.registerTool(
    "save_translations",
    {
      title: "Write back translations you produced",
      description:
        "Saves agent-produced translations for the content types that have no " +
        "machine-translation endpoint. Pass the items from translation_worklist with their " +
        "`fields` translated. Slugs are derived the way the backend derives them, internal " +
        "URLs are re-pointed at the target language, and non-prose columns (prices, icons, " +
        "phone numbers, social handles) are copied from the source row — do not send those. " +
        "Creates the language row, or updates it if it already exists. Requires login and a " +
        "write-enabled brand.",
      inputSchema: {
        project: projectParam,
        language_code: z.string().min(2).describe("The language these translations are IN."),
        source_language_code: z
          .string()
          .optional()
          .describe("Language they were translated FROM. Defaults to the brand's default."),
        items: z
          .array(
            z.object({
              type: z.enum(SURFACE_TYPES),
              id: z.number().int(),
              parent_id: z.number().int().optional().describe("Only header menu items need this."),
              fields: z.record(z.string()).describe("Translated field values, keyed by field name."),
            }),
          )
          .min(1)
          .max(50),
        localize_urls: z
          .boolean()
          .default(true)
          .describe("Re-point internal URLs at the target language via the slug lookup."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, language_code, source_language_code, items, localize_urls }) =>
      guard(async () => {
        const blocked = ensureWritable(project);
        if (blocked) return fail(blocked);

        const target = language_code.toLowerCase();
        const source = (source_language_code ?? getProject(project).defaultLanguage).toLowerCase();
        const results = await saveItems(project, target, source, items, localize_urls);

        const saved = results.filter((result) => result.saved === true).length;
        return ok({
          project,
          language_code: target,
          saved,
          failed: results.length - saved,
          results,
          note:
            saved > 0
              ? "Call translation_worklist again for the next batch."
              : "Nothing was saved — see each item's error.",
        });
      }),
  );
}


/** Rough cap on how much source text one worklist call hands back. */
const CHAR_BUDGET = 60_000;

interface WorkItem {
  type: string;
  id: number;
  parent_id?: number;
  label: string;
  fields: Record<string, string>;
}

/**
 * Gather the source strings of agent-translated rows still missing a language.
 * Factored out so translation_worklist can hand them to the agent.
 */
async function collectWorklist(
  project: ProjectId,
  source: string,
  target: string,
  types: string[] | undefined,
  limit: number,
): Promise<{ items: WorkItem[]; remaining: number }> {
  const surfaces = selectSurfaces(types).filter((surface) => surface.llm === null);
  const items: WorkItem[] = [];
  let remaining = 0;
  let budget = CHAR_BUDGET;

  for (const surface of surfaces) {
    let rows: SurfaceRow[];
    try {
      rows = (await fetchSurfaceRows(project, surface)).rows;
    } catch {
      continue;
    }
    const fields = translatableFields(surface);

    for (const row of rows) {
      const sourceRow = findTranslation(row, source);
      if (!sourceRow || findTranslation(row, target)) continue;

      if (items.length >= limit || budget <= 0) {
        remaining += 1;
        continue;
      }

      const values: Record<string, string> = {};
      for (const field of fields) {
        const value = sourceRow.values[field];
        if (typeof value === "string" && value.trim()) values[field] = value;
      }
      if (Object.keys(values).length === 0) continue;

      budget -= JSON.stringify(values).length;
      items.push({
        type: surface.type,
        id: row.id,
        ...(row.parentId === undefined ? {} : { parent_id: row.parentId }),
        label: row.label,
        fields: values,
      });
    }
  }
  return { items, remaining };
}

/** Write already-translated items back. Factored out of save_translations. */
async function saveItems(
  project: ProjectId,
  target: string,
  source: string,
  items: Array<{ type: string; id: number; parent_id?: number; fields: Record<string, string> }>,
  localizeUrls: boolean,
): Promise<Record<string, unknown>[]> {
  const languageIds = await resolveLanguageIds(project, [target]);
  const languageId = languageIds.get(target);
  if (languageId === undefined) throw new Error(`'${target}' is not an active language.`);
  const locales = await getActiveLanguageCodes(project);

  const results: Record<string, unknown>[] = [];
  const byType = new Map<string, typeof items>();
  for (const item of items) {
    const group = byType.get(item.type) ?? [];
    group.push(item);
    byType.set(item.type, group);
  }

  for (const [type, group] of byType) {
    const surface = getSurface(type);
    // One list call per type serves every item of that type: we need the source
    // row's verbatim columns and whether the language row already exists.
    const { rows } = await fetchSurfaceRows(project, surface);
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const item of group) {
      const row = byId.get(item.id);
      if (!row) {
        results.push({ type, id: item.id, saved: false, error: "row not found" });
        continue;
      }
      const sourceRow = findTranslation(row, source);
      if (!sourceRow) {
        results.push({
          type,
          id: item.id,
          saved: false,
          error: `no '${source}' row to copy non-prose fields from`,
        });
        continue;
      }

      try {
        const payload = await composePayload({
          project,
          surface,
          source: sourceRow,
          supplied: item.fields,
          targetLanguage: target,
          locales,
          localizeUrls,
        });
        const outcome = await writeTranslation(
          project,
          surface,
          row,
          target,
          languageId,
          payload,
        );
        results.push({ type, id: item.id, label: row.label, saved: true, outcome });
      } catch (error) {
        results.push({
          type,
          id: item.id,
          saved: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return results;
}

function countTypes(items: BatchItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.type] = (counts[item.type] ?? 0) + 1;
  return counts;
}

const ENTITY_BY_SEGMENT = {
  posts: "post",
  services: "service",
  pages: "page",
} as const satisfies Record<BatchItem["entity"], LlmEntity>;

function surfaceEntity(item: BatchItem): LlmEntity {
  return ENTITY_BY_SEGMENT[item.entity];
}

/**
 * Start queued entities until `concurrency` are in flight. Mutates the batch.
 * Returns how many were started.
 */
async function fillSlots(batch: Batch): Promise<number> {
  let running = batch.items.filter((item) => item.status === "running").length;
  let started = 0;

  for (const item of batch.items) {
    if (running >= batch.concurrency) break;
    if (item.status !== "queued") continue;

    try {
      const response = await startJob(
        batch.project,
        surfaceEntity(item),
        item.id,
        autoTranslateBody(
          surfaceEntity(item),
          batch.source_language_code,
          batch.target_language_codes,
          batch.overwrite,
          undefined,
          undefined,
        ),
      );
      item.status = "running";
      item.job_id = response.job_id;
      running += 1;
      started += 1;
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message : String(error);
    }
  }
  return started;
}
