#!/usr/bin/env node
/**
 * Diff `src/lib/translatable.ts` against the backend's OpenAPI spec.
 *
 * The registry is what makes "translate everywhere" mean everywhere. When the
 * backend grows a new translatable entity or a new column on an existing one,
 * a sweep would silently skip it — this script turns that into a visible
 * failure instead.
 *
 *   npm run build
 *   node scripts/check-translatable.mjs [path/to/api.yml]
 *
 * Defaults to ../ICFrontend/api.yml, which is the generated spec of the live
 * API. Exits non-zero on drift.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { SURFACES, UNCOVERED } from "../dist/lib/translatable.js";

const here = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(
  process.argv[2] ?? join(here, "..", "..", "ICFrontend", "api.yml"),
);

/** `/v1/admin/heroes/{hero_id}/translations` -> `/admin/heroes/{}/translations` */
function normalize(path) {
  return path.replace(/^\/v1/, "").replace(/\{[^}]*\}/g, "{}");
}

function deref(spec, node) {
  return node && node.$ref
    ? spec.components.schemas[node.$ref.split("/").pop()]
    : node;
}

function requestFields(spec, operation) {
  const schema = deref(
    spec,
    operation?.requestBody?.content?.["application/json"]?.schema,
  );
  return Object.keys(schema?.properties ?? {}).filter(
    (name) => name !== "language_id" && name !== "language_code",
  );
}

let spec;
try {
  spec = JSON.parse(readFileSync(specPath, "utf8"));
} catch (error) {
  console.error(`Cannot read the OpenAPI spec at ${specPath}`);
  console.error(String(error.message ?? error));
  console.error("Pass the path explicitly: node scripts/check-translatable.mjs <api.yml>");
  process.exit(2);
}

const specCreatePaths = new Map();
for (const [path, item] of Object.entries(spec.paths)) {
  if (!/\/translations$/.test(path) || !item.post) continue;
  specCreatePaths.set(normalize(path), { path, fields: requestFields(spec, item.post) });
}

/**
 * Embedded surfaces: an entity that carries a `translations` array in its
 * create/update body but has NO /translations endpoint. `link` and
 * `before_after_ai_step` are the two today — this is exactly the shape that
 * slips past a /translations-only scan, so catch it explicitly.
 */
function bodyHasTranslations(operation) {
  const schema = deref(
    spec,
    operation?.requestBody?.content?.["application/json"]?.schema,
  );
  return Boolean(schema?.properties?.translations);
}
const specEmbeddedUpdates = new Map();
for (const [path, item] of Object.entries(spec.paths)) {
  // The row-level PUT (e.g. /admin/links/{id}) that owns the translations.
  if (!item.put || !/\/\{[a-z_]+\}$/.test(path)) continue;
  if (!bodyHasTranslations(item.put)) continue;
  // Skip if a /translations endpoint also exists — then it's a normal surface.
  const collection = path.replace(/\/\{[a-z_]+\}$/, "");
  const hasEndpoint = Object.keys(spec.paths).some((p) =>
    normalize(p) === normalize(`${collection}/{id}/translations`),
  );
  if (!hasEndpoint) specEmbeddedUpdates.set(normalize(path), path);
}

const problems = [];
const covered = new Set();
const coveredEmbedded = new Set();

for (const surface of SURFACES) {
  if (surface.write.mode === "embedded") {
    // No /translations endpoint — the rows live inside the entity's own PUT.
    const putPath = normalize(surface.write.put);
    const exists = Object.keys(spec.paths).some(
      (path) => normalize(path) === putPath && spec.paths[path].put,
    );
    if (!exists) {
      problems.push(`${surface.type}: no PUT ${surface.write.put} in the spec`);
    }
    coveredEmbedded.add(putPath);
    continue;
  }

  const key = normalize(surface.write.create);
  const found = specCreatePaths.get(key);
  if (!found) {
    problems.push(`${surface.type}: registry points at ${surface.write.create}, absent from the spec`);
    continue;
  }
  covered.add(key);

  const registryFields = new Set(surface.fields.map((field) => field.name));
  // A slug is derived, not sent by the caller, so the registry names it `slug`
  // while the spec does too — nothing special needed there.
  const missing = found.fields.filter((name) => !registryFields.has(name));
  const extra = [...registryFields].filter((name) => !found.fields.includes(name));

  if (missing.length > 0) {
    problems.push(`${surface.type}: spec has fields the registry ignores: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    problems.push(`${surface.type}: registry has fields the spec does not accept: ${extra.join(", ")}`);
  }
}

const skipped = [];
for (const [key, found] of specCreatePaths) {
  if (covered.has(key)) continue;
  if (UNCOVERED[key]) {
    skipped.push(`${found.path} — ${UNCOVERED[key]}`);
    continue;
  }
  problems.push(`no surface registered for ${found.path}`);
}

for (const [key, path] of specEmbeddedUpdates) {
  if (coveredEmbedded.has(key)) continue;
  if (UNCOVERED[key]) {
    skipped.push(`${path} (embedded) — ${UNCOVERED[key]}`);
    continue;
  }
  problems.push(`embedded-translation entity not registered: PUT ${path} carries a translations array with no /translations endpoint`);
}

const surfaceCount = SURFACES.length;
for (const note of skipped) console.log(`skipped: ${note}`);

if (problems.length === 0) {
  console.log(`OK — ${surfaceCount} translatable surfaces match ${specPath}`);
  process.exit(0);
}

console.error(`${problems.length} drift(s) between the registry and ${specPath}:\n`);
for (const problem of problems) console.error(`  - ${problem}`);
console.error(
  "\nUpdate src/lib/translatable.ts. A surface that is genuinely out of scope " +
    "should still be listed with a comment saying why.",
);
process.exit(1);
