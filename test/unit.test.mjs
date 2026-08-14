// Pure-logic unit tests — no network, no auth. Run: npm test (node --test).
// These cover the real algorithms: slug handling, the translatable registry's
// integrity, and the coverage math. Tests import the COMPILED output in dist/,
// so run `npm run build` first.

import { test } from "node:test";
import assert from "node:assert/strict";

import { slugify, isValidSlug, coerceSlug, auditSlug } from "../dist/lib/slug.js";
import {
  SURFACES,
  SURFACE_TYPES,
  getSurface,
  fillPath,
  LLM_SURFACES,
  MANUAL_SURFACES,
} from "../dist/lib/translatable.js";
import { findTranslation, measureCoverage } from "../dist/lib/translation-scan.js";

test("slugify: lowercases, hyphenates, strips accents", () => {
  assert.equal(slugify("Hello World"), "hello-world");
  assert.equal(slugify("Haartransplantation für Männer"), "haartransplantation-fur-manner");
  assert.equal(slugify("  Trim__me  "), "trim-me");
});

test("slugify: non-Latin script yields empty (the Arabic case)", () => {
  assert.equal(slugify("زراعة الشعر"), "");
});

test("slugify: apostrophes are removed, not hyphenated", () => {
  assert.equal(slugify("What You'll Really Pay"), "what-youll-really-pay");
  assert.equal(slugify("What You’ll Really Pay"), "what-youll-really-pay");
  assert.equal(slugify("Perché scegliere l'Albania"), "perche-scegliere-lalbania");
  assert.equal(slugify("Rock ’n’ Roll"), "rock-n-roll");
});

test("slugify: stroked letters transliterate instead of vanishing", () => {
  assert.equal(slugify("Łupież vs Sucha Skóra Głowy"), "lupiez-vs-sucha-skora-glowy");
  assert.equal(slugify("włosów"), "wlosow");
});

test("isValidSlug: only lowercase ascii + hyphens", () => {
  assert.ok(isValidSlug("hair-transplant"));
  assert.ok(!isValidSlug("Hair-Transplant"));
  assert.ok(!isValidSlug("has space"));
  assert.ok(!isValidSlug("für"));
});

test("coerceSlug: fixes an invalid slug and flags it", () => {
  assert.deepEqual(coerceSlug("hair-transplant"), { slug: "hair-transplant", corrected: false });
  const fixed = coerceSlug("Für Männer");
  assert.equal(fixed.corrected, true);
  assert.ok(isValidSlug(fixed.slug));
});

test("auditSlug: flags a transliteration bug (accents dropped to a hyphen)", () => {
  // "für" would generate "fur"; a stored "f-r" is the classic dropped-accent bug.
  const bad = auditSlug("f-r", "für");
  assert.ok(bad.transliteration_bug || bad.needs_review);
});

test("registry: SURFACE_TYPES are unique and non-empty", () => {
  assert.ok(SURFACE_TYPES.length >= 30);
  assert.equal(new Set(SURFACE_TYPES).size, SURFACE_TYPES.length);
});

test("registry: LLM surfaces are exactly post/service/page", () => {
  assert.deepEqual(
    LLM_SURFACES.map((s) => s.type).sort(),
    ["page", "post", "service"],
  );
  assert.ok(MANUAL_SURFACES.every((s) => s.llm === null));
});

test("registry: every surface's titleField is one of its own fields", () => {
  for (const surface of SURFACES) {
    const names = surface.fields.map((f) => f.name);
    assert.ok(
      names.includes(surface.titleField),
      `${surface.type}: titleField '${surface.titleField}' not in fields`,
    );
  }
});

test("registry: getSurface throws on an unknown type", () => {
  assert.throws(() => getSurface("does-not-exist"), /Unknown content type/);
  assert.equal(getSurface("post").type, "post");
});

test("fillPath: substitutes {id} / {parent} / {language}", () => {
  assert.equal(
    fillPath("/admin/headers/{parent}/items/{id}/translations/{language}", {
      parent: 6,
      id: 18,
      language: 45,
    }),
    "/admin/headers/6/items/18/translations/45",
  );
  assert.equal(fillPath("/admin/posts/{id}/translations", { id: 9 }), "/admin/posts/9/translations");
});

test("findTranslation: matches language code case-insensitively", () => {
  const row = {
    id: 1,
    label: "x",
    translations: [
      { languageId: 22, languageCode: "en", values: {} },
      { languageId: 45, languageCode: "ar", values: {} },
    ],
  };
  assert.ok(findTranslation(row, "AR"));
  assert.ok(findTranslation(row, "en"));
  assert.equal(findTranslation(row, "de"), undefined);
});

test("measureCoverage: counts missing, unsourced, and complete rows", () => {
  const surface = { type: "faq", label: "FAQ", llm: null };
  const rows = [
    // has en source, missing ar
    { id: 1, label: "a", translations: [{ languageId: 22, languageCode: "en", values: {} }] },
    // has en + ar → complete
    {
      id: 2,
      label: "b",
      translations: [
        { languageId: 22, languageCode: "en", values: {} },
        { languageId: 45, languageCode: "ar", values: {} },
      ],
    },
    // no en source → unsourced
    { id: 3, label: "c", translations: [{ languageId: 45, languageCode: "ar", values: {} }] },
  ];
  const cov = measureCoverage(surface, rows, "en", ["ar"]);
  assert.equal(cov.total, 3);
  assert.equal((cov.missing.ar ?? []).length, 1);
  assert.equal(cov.missing.ar[0].id, 1);
  assert.equal(cov.unsourced.length, 1);
  assert.equal(cov.unsourced[0].id, 3);
});
