import { getProject, type ProjectId } from "../config/projects.js";
import { getToken } from "../auth/session.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly url: string,
  ) {
    super(`${status} ${detail} (${url})`);
    this.name = "ApiError";
  }
}

export class AuthRequiredError extends Error {
  constructor(readonly project: ProjectId) {
    super(
      `Not authenticated for '${project}'. Call login({ project: "${project}" }), ` +
        `then submit_otp with the code e-mailed to the account.`,
    );
    this.name = "AuthRequiredError";
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(project: ProjectId, path: string, query?: Query): string {
  const { apiBaseUrl } = getProject(project);
  const url = new URL(apiBaseUrl.replace(/\/+$/, "") + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** Pull the most useful message out of FastAPI's several error shapes. */
async function extractDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return response.statusText || "request failed";
  try {
    const body = JSON.parse(text) as { detail?: unknown; message?: unknown };
    const detail = body.detail ?? body.message;
    if (typeof detail === "string") return detail;
    if (detail !== undefined) return JSON.stringify(detail);
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return text.slice(0, 500);
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Public endpoints skip the bearer token entirely. */
  auth?: boolean;
  timeoutMs?: number;
}

export async function request<T>(
  project: ProjectId,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { query, body, auth = true, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const url = buildUrl(project, path, query);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (auth) {
    const token = getToken(project);
    if (!token) throw new AuthRequiredError(project);
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    // A 401 on an authenticated call means the JWT died mid-session; say so in
    // the terms the agent needs rather than leaking a bare "Not authenticated".
    if (response.status === 401 && auth) {
      throw new AuthRequiredError(project);
    }
    throw new ApiError(response.status, await extractDetail(response), url);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function get<T>(
  project: ProjectId,
  path: string,
  query?: Query,
  auth = true,
): Promise<T> {
  return request<T>(project, "GET", path, { query, auth });
}

export function post<T>(
  project: ProjectId,
  path: string,
  body?: unknown,
  auth = true,
): Promise<T> {
  return request<T>(project, "POST", path, { body, auth });
}

export function put<T>(
  project: ProjectId,
  path: string,
  body?: unknown,
  auth = true,
): Promise<T> {
  return request<T>(project, "PUT", path, { body, auth });
}

export function del<T>(project: ProjectId, path: string, auth = true): Promise<T> {
  return request<T>(project, "DELETE", path, { auth });
}

/**
 * Multipart POST for the media endpoints, which take file uploads. Deliberately
 * does NOT set Content-Type — fetch derives the multipart boundary from the
 * FormData itself, and an explicit header would break the boundary.
 */
export async function postForm<T>(
  project: ProjectId,
  path: string,
  form: FormData,
  auth = true,
  timeoutMs = 120_000,
): Promise<T> {
  const url = buildUrl(project, path);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (auth) {
    const token = getToken(project);
    if (!token) throw new AuthRequiredError(project);
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    if (response.status === 401 && auth) throw new AuthRequiredError(project);
    throw new ApiError(response.status, await extractDetail(response), url);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Encode a slug path for use as a URL path segment sequence.
 *
 * Encoding the whole slug with `encodeURIComponent` turns `/` into `%2F` and
 * breaks every multi-segment path — services with a category chain and nested
 * pages. Encode per segment so the separators survive.
 */
export function encodeSlugPath(slug: string): string {
  return slug
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}
