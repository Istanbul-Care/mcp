import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get, post } from "../api/client.js";
import type { ProjectId } from "../config/projects.js";
import { ok, guard, projectParam } from "./helpers.js";

/**
 * Brand-wide content work that runs as a backend job: links that point at a
 * redirected address, and site-wide search / replace. Both were possible
 * only by hand, one post at a time (WEB #73, #75 — the content team handed
 * them to development for that reason).
 */

const POLL_MS = 3000;

const waitParam = z
  .number()
  .int()
  .min(0)
  .max(300)
  .default(90)
  .describe(
    "How long to wait for the job before answering (seconds). A big brand can take a few " +
      "minutes; if it is still running, the answer has the job id for the get_* tool.",
  );

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `read` until the job is done or `waitSeconds` pass. */
async function waitFor<T extends { status?: string }>(
  read: () => Promise<T>,
  waitSeconds: number,
): Promise<T | null> {
  const deadline = Date.now() + waitSeconds * 1000;
  let last: T | null = null;
  while (Date.now() < deadline) {
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
    last = await read();
    if (last?.status === "completed" || last?.status === "failed") return last;
  }
  return last;
}

// ---- relink ---------------------------------------------------------------

interface RelinkJob {
  id: number;
  status: string;
  params?: Record<string, unknown>;
  progress?: { total: number; done: number; current?: string | null };
  summary?: Record<string, unknown> | null;
  error?: string | null;
}

async function readRelinkJob(project: ProjectId, jobId: number): Promise<RelinkJob> {
  const res = await get<{ data: RelinkJob }>(project, `/admin/redirects/relink/${jobId}`);
  return res.data;
}

/** The job, with its long lists cut down to what an answer can carry. */
function relinkReport(job: RelinkJob | null, jobId: number) {
  if (!job) return { job_id: jobId, status: "unknown" };
  const s = (job.summary ?? {}) as Record<string, unknown>;
  const byUrl = (s.by_url ?? {}) as Record<string, number>;
  const newUrl = (s.new_url ?? {}) as Record<string, string>;
  const top = Object.entries(byUrl)
    .slice(0, 60)
    .map(([old, links]) => ({ old, new: newUrl[old] ?? null, links }));
  return {
    job_id: job.id ?? jobId,
    status: job.status,
    progress: job.progress,
    dry_run: s.dry_run ?? job.params?.dry_run,
    links_rewritten: s.rewritten_occurrences,
    rows_touched: s.rewritten_rows,
    by_column: s.by_column,
    redirects: s.redirects,
    redirects_linked: s.redirects_linked,
    skipped: s.skipped,
    skipped_examples: s.skipped_examples,
    top_old_addresses: top.length ? top : undefined,
    examples: Array.isArray(s.examples) ? (s.examples as unknown[]).slice(0, 20) : undefined,
    error: job.error ?? undefined,
    note:
      job.status === "completed" || job.status === "failed"
        ? undefined
        : "Still running: call get_relink_job with this job_id.",
  };
}

// ---- bulk search / replace -------------------------------------------------

interface BulkMatch {
  entity: string;
  table: string;
  row_id: number;
  parent_id?: number | null;
  language_id?: number | null;
  column: string;
  old_value?: string | null;
  new_value?: string | null;
  snippet?: string | null;
}

interface BulkJob {
  id: number;
  kind: string;
  status: string;
  progress?: { total: number; done: number; current?: string | null };
  summary?: { per_entity?: Record<string, unknown>; matched_rows?: number; matched_occurrences?: number } | null;
  matches?: BulkMatch[] | null;
  error?: string | null;
}

/** Around the first difference of a replace, or the search's own snippet. */
function shortMatch(m: BulkMatch) {
  const base = {
    entity: m.entity,
    row_id: m.row_id,
    parent_id: m.parent_id ?? undefined,
    language_id: m.language_id ?? undefined,
    column: m.column,
  };
  if (m.old_value != null && m.new_value != null) {
    const a = m.old_value;
    const b = m.new_value;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const from = Math.max(0, i - 60);
    return { ...base, before: a.slice(from, i + 120), after: b.slice(from, i + 120) };
  }
  return { ...base, snippet: m.snippet ?? undefined };
}

function bulkReport(job: BulkJob | null, jobId: number, maxMatches: number) {
  if (!job) return { job_id: jobId, status: "unknown" };
  return {
    job_id: job.id ?? jobId,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    matched_rows: job.summary?.matched_rows,
    matched_occurrences: job.summary?.matched_occurrences,
    per_entity: job.summary?.per_entity,
    matches: (job.matches ?? []).slice(0, maxMatches).map(shortMatch),
    error: job.error ?? undefined,
    note:
      job.status === "completed" || job.status === "failed"
        ? undefined
        : "Still running: call get_bulk_job with this job_id.",
  };
}

const entitiesParam = z
  .array(z.string())
  .optional()
  .describe(
    "Which kinds of content to scan, e.g. ['post', 'card', 'page', 'faq', 'header_item', " +
      "'footer_section_item']; leave out for all. get_bulk_job_registry lists every name.",
  );

const fieldsParam = z
  .record(z.array(z.string()))
  .optional()
  .describe("Per kind, only these columns, e.g. {\"post\": [\"content\"]}.");

export function registerBulkContentTools(server: McpServer): void {
  server.registerTool(
    "relink_redirected_links",
    {
      title: "Point links at the address their redirect ends at",
      description:
        "Finds every stored link (post and page bodies, cards, FAQs, menus, footers, buttons, " +
        "canonicals...) to an address that has a redirect, and rewrites it to the address the " +
        "redirect ends at (chains followed), so no link costs a redirect hop. dry_run (the " +
        "default) only counts: links per old address, examples, and the redirects left out " +
        "and why — 'home' (it ends at a home page, which usually means the page is gone: " +
        "decide where those links should go and use bulk_replace_content), 'other_language', " +
        "'external', 'loop'. Run it again with dry_run false to write; the pages re-bake by " +
        "themselves. A redirect saved with create_redirect / update_redirect relinks its own " +
        "old address automatically, so this is for redirects saved earlier. Runs as a job. " +
        "Requires login (admin or site_admin).",
      inputSchema: {
        project: projectParam,
        dry_run: z.boolean().default(true).describe("Only count (default). false = rewrite."),
        include_home_targets: z
          .boolean()
          .default(false)
          .describe("Also point links at a home page when that is where the redirect ends."),
        wait_seconds: waitParam,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project, dry_run, include_home_targets, wait_seconds }) =>
      guard(async () => {
        const started = await post<{ job_id: number }>(project, "/admin/redirects/relink", {
          dry_run: dry_run ?? true,
          include_home_targets: include_home_targets ?? false,
        });
        const jobId = started.job_id;
        const job = await waitFor(() => readRelinkJob(project, jobId), wait_seconds ?? 90);
        return ok({ project, ...relinkReport(job, jobId) });
      }),
  );

  server.registerTool(
    "get_relink_job",
    {
      title: "Read a relink job",
      description:
        "The state of a relink_redirected_links job (or the relink a redirect save queued): " +
        "progress, then what it changed or — for a dry run — would change. Requires login.",
      inputSchema: { project: projectParam, job_id: z.number().int() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, job_id }) =>
      guard(async () => ok({ project, ...relinkReport(await readRelinkJob(project, job_id), job_id) })),
  );

  server.registerTool(
    "bulk_search_content",
    {
      title: "Search all of a brand's content",
      description:
        "Finds text anywhere in a brand's content — post, page and service texts, cards, FAQs, " +
        "menus, footers, forms, settings, media alt texts — e.g. every place that links to an " +
        "address or mentions an old name. Plain text, not a pattern; up to 20,000 terms at " +
        "once. Read-only. Runs as a job. Requires login (admin or site_admin).",
      inputSchema: {
        project: projectParam,
        terms: z
          .array(z.string().min(1).max(2000))
          .min(1)
          .max(20000)
          .describe("What to look for, e.g. ['href=\"/es/sonrisa-de-hollywood/\"']."),
        case_sensitive: z.boolean().default(false),
        entities: entitiesParam,
        fields: fieldsParam,
        max_matches: z.number().int().min(1).max(500).default(100).describe("Matches to list in the answer."),
        wait_seconds: waitParam,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, terms, case_sensitive, entities, fields, max_matches, wait_seconds }) =>
      guard(async () => {
        const started = await post<{ job_id: number }>(project, "/admin/content/bulk-search", {
          rules: terms.map((find) => ({ find, case_sensitive: case_sensitive ?? false })),
          entities,
          fields,
          limit_matches_per_entity: Math.max(max_matches ?? 100, 50),
        });
        const jobId = started.job_id;
        const job = await waitFor(
          () => get<BulkJob>(project, `/admin/content/bulk-jobs/${jobId}`),
          wait_seconds ?? 90,
        );
        return ok({ project, ...bulkReport(job, jobId, max_matches ?? 100) });
      }),
  );

  server.registerTool(
    "bulk_replace_content",
    {
      title: "Replace text across all of a brand's content",
      description:
        "Replaces text everywhere in a brand's content (the same places bulk_search_content " +
        "looks), e.g. a link to a page that is gone, in every post, card and menu at once. " +
        "Plain text, applied wherever it appears — so make each find specific: for a link, " +
        "include the quote, href=\"/es/old-page/\" → href=\"/es/new-page/\", or '/es/old/' " +
        "would also change '/es/old/more/'. dry_run (the default) only shows what would change " +
        "(before/after around each change); run again with dry_run false to write — the " +
        "pages re-bake by themselves. Slugs are never rewritten. Runs as a job. Requires login " +
        "(admin or site_admin).",
      inputSchema: {
        project: projectParam,
        rules: z
          .array(
            z.object({
              find: z.string().min(1).max(2000),
              replace: z.string().max(2000),
              case_sensitive: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(20000),
        entities: entitiesParam,
        fields: fieldsParam,
        dry_run: z.boolean().default(true).describe("Only show (default). false = write."),
        max_matches: z.number().int().min(1).max(500).default(100).describe("Changes to list in the answer."),
        wait_seconds: waitParam,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ project, rules, entities, fields, dry_run, max_matches, wait_seconds }) =>
      guard(async () => {
        const started = await post<{ job_id: number }>(project, "/admin/content/bulk-replace", {
          rules: rules.map((r) => ({ ...r, case_sensitive: r.case_sensitive ?? false })),
          entities,
          fields,
          dry_run: dry_run ?? true,
          limit_matches_per_entity: Math.max(max_matches ?? 100, 50),
        });
        const jobId = started.job_id;
        const job = await waitFor(
          () => get<BulkJob>(project, `/admin/content/bulk-jobs/${jobId}`),
          wait_seconds ?? 90,
        );
        return ok({ project, dry_run: dry_run ?? true, ...bulkReport(job, jobId, max_matches ?? 100) });
      }),
  );

  server.registerTool(
    "get_bulk_job",
    {
      title: "Read a bulk search / replace job",
      description: "Progress and results of a bulk_search_content or bulk_replace_content job. Requires login.",
      inputSchema: {
        project: projectParam,
        job_id: z.number().int(),
        max_matches: z.number().int().min(1).max(500).default(100),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project, job_id, max_matches }) =>
      guard(async () =>
        ok({
          project,
          ...bulkReport(
            await get<BulkJob>(project, `/admin/content/bulk-jobs/${job_id}`),
            job_id,
            max_matches ?? 100,
          ),
        }),
      ),
  );

  server.registerTool(
    "get_bulk_job_registry",
    {
      title: "List what bulk search / replace can reach",
      description:
        "Every kind of content (and its columns) the bulk tools scan — the names for their " +
        "entities and fields. Requires login.",
      inputSchema: { project: projectParam },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project }) =>
      guard(async () => {
        const res = await get<{ data: unknown }>(project, "/admin/content/bulk-jobs/registry");
        return ok({ project, registry: res.data });
      }),
  );
}
