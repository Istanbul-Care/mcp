import { z } from "zod";
import { PROJECT_IDS, isProjectId, type ProjectId } from "../config/projects.js";
import { get } from "../api/client.js";
import type { Envelope, LanguageListData } from "../api/types.js";

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

const languageCache = new Map<ProjectId, { codes: string[]; at: number }>();
const LANGUAGE_TTL_MS = 10 * 60_000;

export async function getActiveLanguageCodes(project: ProjectId): Promise<string[]> {
  const cached = languageCache.get(project);
  if (cached && Date.now() - cached.at < LANGUAGE_TTL_MS) return cached.codes;

  const response = await get<Envelope<LanguageListData>>(
    project,
    "/admin/languages",
    { limit: 100, is_active: true },
    false,
  );
  const codes = response.data.languages.map((language) => language.code.toLowerCase());
  languageCache.set(project, { codes, at: Date.now() });
  return codes;
}
