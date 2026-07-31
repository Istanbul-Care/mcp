/**
 * Walking the registry: turn a `TranslatableSurface` into concrete rows and
 * work out which languages each one is missing.
 *
 * Nothing here writes. `translation_coverage` and `translation_worklist` both
 * read through this, so a bug shows up as a wrong report rather than as wrong
 * content.
 */

import { get } from "../api/client.js";
import type { ProjectId } from "../config/projects.js";
import type { Envelope } from "../api/types.js";
import type { TranslatableSurface } from "./translatable.js";

type Row = Record<string, unknown>;

export interface TranslationRow {
  /** Null for surfaces the API keys by code rather than by id. */
  languageId: number | null;
  languageCode: string;
  values: Row;
}

export interface SurfaceRow {
  id: number;
  /** Set only where the write path needs the parent too (header items). */
  parentId?: number;
  label: string;
  translations: TranslationRow[];
}

const PAGE_LIMIT = 100;
/** A runaway list would otherwise walk a brand's whole media library. */
const MAX_PAGES = 50;

function asRow(value: unknown): Row | null {
  return typeof value === "object" && value !== null ? (value as Row) : null;
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => asRow(item) !== null) : [];
}

/**
 * Page through an admin list endpoint and return every row.
 *
 * `truncated` matters: a coverage report that quietly stopped at the page cap
 * would read as "nothing missing" for content it never looked at, which is
 * worse than saying it gave up.
 */
async function listAll(
  project: ProjectId,
  path: string,
  key: string,
): Promise<{ rows: Row[]; truncated: boolean }> {
  const rows: Row[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await get<Envelope<Row | Row[]>>(project, path, {
      page,
      limit: PAGE_LIMIT,
    });
    // A few endpoints (before/after-AI steps) return the rows as `data` itself
    // rather than under a key, and have no pagination envelope at all.
    if (Array.isArray(response.data)) {
      return { rows: asRows(response.data), truncated: false };
    }

    const data = asRow(response.data) ?? {};
    rows.push(...asRows(data[key]));

    const reported = data.total_pages;
    totalPages = typeof reported === "number" && reported > 0 ? reported : 1;
    page += 1;
  } while (page <= totalPages && page <= MAX_PAGES);

  return { rows, truncated: totalPages > MAX_PAGES };
}

/** Descend a dotted child path (`slides.features`), flattening at every step. */
function descend(rows: Row[], child: string): Row[] {
  return child.split(".").reduce<Row[]>(
    (current, key) => current.flatMap((row) => asRows(row[key])),
    rows,
  );
}

/** Header items nest into themselves; flatten the whole tree. */
function flattenRecursive(rows: Row[], key: string): Row[] {
  return rows.flatMap((row) => [row, ...flattenRecursive(asRows(row[key]), key)]);
}

function readTranslations(row: Row): TranslationRow[] {
  return asRows(row.translations).flatMap((translation) => {
    const language = asRow(translation.language);
    const code = language
      ? language.code
      : (translation.language_code ?? translation.languageCode);
    if (typeof code !== "string" || !code) return [];

    const id = language ? language.id : translation.language_id;
    return [
      {
        languageId: typeof id === "number" ? id : null,
        languageCode: code.toLowerCase(),
        values: translation,
      },
    ];
  });
}

function labelFor(row: Row, translations: TranslationRow[], titleField: string): string {
  for (const translation of translations) {
    const value = translation.values[titleField];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80);
  }
  return `#${String(row.id ?? "?")}`;
}

export interface SurfaceScan {
  rows: SurfaceRow[];
  /** True when the list endpoint had more pages than the walk would read. */
  truncated: boolean;
}

/** Every translatable row of one surface, with its existing languages. */
export async function fetchSurfaceRows(
  project: ProjectId,
  surface: TranslatableSurface,
): Promise<SurfaceScan> {
  const { source } = surface;
  const { rows: parents, truncated } = await listAll(project, source.path, source.key);

  // Header items are the one surface whose children are not in the list
  // response — each header has to be re-read in full.
  if (source.detailPath) {
    const rows: SurfaceRow[] = [];
    for (const parent of parents) {
      const parentId = parent.id;
      if (typeof parentId !== "number") continue;

      const detail = await get<Envelope<Row>>(
        project,
        source.detailPath.replace("{id}", String(parentId)),
      );
      const data = asRow(detail.data) ?? {};
      let children = asRows(source.child ? data[source.child] : []);
      if (source.recurse) children = flattenRecursive(children, source.recurse);

      for (const child of children) {
        if (typeof child.id !== "number") continue;
        const translations = readTranslations(child);
        rows.push({
          id: child.id,
          parentId,
          label: labelFor(child, translations, surface.titleField),
          translations,
        });
      }
    }
    return { rows, truncated };
  }

  const target = source.child ? descend(parents, source.child) : parents;
  const rows = target.flatMap((row) => {
    if (typeof row.id !== "number") return [];
    const translations = readTranslations(row);
    return [
      {
        id: row.id,
        label: labelFor(row, translations, surface.titleField),
        translations,
      },
    ];
  });
  return { rows, truncated };
}

export function findTranslation(
  row: SurfaceRow,
  languageCode: string,
): TranslationRow | undefined {
  const wanted = languageCode.toLowerCase();
  return row.translations.find((translation) => translation.languageCode === wanted);
}

export interface SurfaceCoverage {
  type: string;
  label: string;
  llm: boolean;
  total: number;
  /** Rows lacking the language, keyed by language code. */
  missing: Record<string, SurfaceRow[]>;
  /** Rows with no source-language row at all — nothing to translate from. */
  unsourced: SurfaceRow[];
}

export function measureCoverage(
  surface: TranslatableSurface,
  rows: SurfaceRow[],
  sourceLanguage: string,
  targets: string[],
): SurfaceCoverage {
  const missing: Record<string, SurfaceRow[]> = {};
  const unsourced: SurfaceRow[] = [];

  for (const row of rows) {
    if (!findTranslation(row, sourceLanguage)) {
      unsourced.push(row);
      continue;
    }
    for (const target of targets) {
      if (findTranslation(row, target)) continue;
      (missing[target] ??= []).push(row);
    }
  }

  return {
    type: surface.type,
    label: surface.label,
    llm: surface.llm !== null,
    total: rows.length,
    missing,
    unsourced,
  };
}
