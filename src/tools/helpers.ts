import { z } from "zod";
import { checkVocabulary } from "../lib/vocabularies.js";
import { PROJECT_IDS, type ProjectId } from "../config/projects.js";
import { get, post as apiPost, put as apiPut, del as apiDel } from "../api/client.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Envelope, LanguageListData, LanguageListItem } from "../api/types.js";

export const projectParam = z
  .enum(PROJECT_IDS as [ProjectId, ...ProjectId[]])
  .describe("Which brand to act on. Call list_projects to see them all.");

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function ok(payload: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

const languageCache = new Map<
  ProjectId,
  { languages: LanguageListItem[]; at: number }
>();
const LANGUAGE_TTL_MS = 10 * 60_000;

/** Active languages for a brand, with the numeric ids translations key off. */
export async function getActiveLanguages(project: ProjectId): Promise<LanguageListItem[]> {
  const cached = languageCache.get(project);
  if (cached && Date.now() - cached.at < LANGUAGE_TTL_MS) return cached.languages;

  const response = await get<Envelope<LanguageListData>>(
    project,
    "/admin/languages",
    { limit: 100, is_active: true },
    false,
  );
  const languages = response.data.languages;
  languageCache.set(project, { languages, at: Date.now() });
  return languages;
}

export async function getActiveLanguageCodes(project: ProjectId): Promise<string[]> {
  const languages = await getActiveLanguages(project);
  return languages.map((language) => language.code.toLowerCase());
}

/** Resolve language codes to their ids, rejecting anything the brand does not have. */
export async function resolveLanguageIds(
  project: ProjectId,
  codes: string[],
): Promise<Map<string, number>> {
  const languages = await getActiveLanguages(project);
  const byCode = new Map(
    languages.map((language) => [language.code.toLowerCase(), language.id]),
  );
  const resolved = new Map<string, number>();
  const unknown: string[] = [];

  for (const code of codes) {
    const id = byCode.get(code.toLowerCase());
    if (id === undefined) unknown.push(code);
    else resolved.set(code.toLowerCase(), id);
  }

  if (unknown.length > 0) {
    throw new Error(
      `Not an active language on '${project}': ${unknown.join(", ")}. ` +
        `Active: ${[...byCode.keys()].join(", ")}.`,
    );
  }
  return resolved;
}

/**
 * Reject a value the site would not render.
 *
 * These fields are dropdowns in the admin panel and free strings in the
 * database, so a wrong value reaches production without a single error and
 * then renders the wrong block, or nothing. Returns an error string to hand
 * straight to `fail()`, or null when the value is fine.
 */
export function ensureVocabulary(
  checks: Array<[vocabulary: string, value: unknown]>,
): string | null {
  for (const [name, value] of checks) {
    const result = checkVocabulary(name, value);
    if (!result.ok) return result.message ?? `Invalid value for ${name}.`;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * One primitive for every structural write.
 *
 * The admin API is a wide but very regular surface: each component has a
 * parent row, a handful of child collections, and per-language translations,
 * all reached by POST/PUT/DELETE on a predictable path. Writing each of those
 * out by hand is how tools drift apart — one forgets the auth check, another
 * forgets to validate a dropdown value, a third returns a different shape.
 * Everything structural goes through `registerWrite` instead, so the gate,
 * the validation hook and the response shape are written once.
 * ------------------------------------------------------------------ */

export type WriteArgs = Record<string, any>;

/** What the API returns from a create: most nest the row, a few don't. */
interface CreatedRow {
  id?: number;
  data?: { id?: number };
}

export interface WriteSpec {
  /** Tool name, e.g. "create_hero_feature". */
  name: string;
  title: string;
  description: string;
  /** Zod shape WITHOUT `project` — it is added for you. */
  params?: Record<string, z.ZodTypeAny>;
  method: "post" | "put" | "delete";
  /** Build the request path from the call's arguments. */
  path: (args: WriteArgs) => string;
  /** Build the request body. Keys whose value is undefined are dropped. */
  body?: (args: WriteArgs) => unknown;
  /**
   * Reject a value the site cannot render, before it reaches the database.
   * Return an error message, or null when the arguments are fine.
   */
  checks?: (args: WriteArgs) => string | null;
  /** Adds the destructive annotation and names the id in the result. */
  destructive?: boolean;
  /** Extra keys to echo back so the caller can chain the next call. */
  echo?: string[];
}

/** Drop undefined keys so a PUT never blanks a field the caller left out. */
export function pruned(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function registerWrite(server: McpServer, spec: WriteSpec): void {
  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: `${spec.description} Requires login.`,
      inputSchema: { project: projectParam, ...(spec.params ?? {}) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: spec.destructive === true,
        openWorldHint: true,
      },
    },
    async (args: WriteArgs) =>
      guard(async () => {
        const project = args.project as ProjectId;
        const invalid = spec.checks?.(args);
        if (invalid) return fail(invalid);

        const path = spec.path(args);
        const body = spec.body ? pruned(spec.body(args) as Record<string, unknown>) : undefined;

        if (spec.method === "delete") {
          await apiDel(project, path);
          return ok({ project, deleted: true, ...echoed(args, spec.echo) });
        }
        if (spec.method === "put") {
          await apiPut(project, path, body ?? {});
          return ok({ project, updated: true, ...echoed(args, spec.echo) });
        }
        const created = await apiPost<CreatedRow>(project, path, body ?? {});
        return ok({
          project,
          created: true,
          id: created.data?.id ?? created.id,
          ...echoed(args, spec.echo),
        });
      }),
  );
}

function echoed(args: WriteArgs, keys?: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys ?? []) if (args[key] !== undefined) out[key] = args[key];
  return out;
}
