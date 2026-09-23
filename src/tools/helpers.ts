import { z } from "zod";
import { checkVocabulary } from "../lib/vocabularies.js";
import { PROJECT_IDS, isProjectId, type ProjectId } from "../config/projects.js";
import { get } from "../api/client.js";
import type { Envelope, LanguageListData, LanguageListItem } from "../api/types.js";

export const projectParam = z
  .enum(PROJECT_IDS as [ProjectId, ...ProjectId[]])
  .describe("Which brand to act on. Call list_projects to see them all.");

export function writeAllowed(project: ProjectId): boolean {
  return (process.env.ICMCP_WRITE_PROJECTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(isProjectId)
    .includes(project);
}

export function ensureWritable(project: ProjectId): string | null {
  if (writeAllowed(project)) return null;
  return (
    `Writes to '${project}' are disabled. Add it to the ICMCP_WRITE_PROJECTS ` +
    `environment variable (comma-separated) and restart the server. This is the ` +
    `safety gate that stops the robot from touching a brand nobody opted in.`
  );
}

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
