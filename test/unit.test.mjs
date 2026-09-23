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
import {
  classifyLinkValue,
  isReservedLinkValue,
} from "../dist/lib/link-values.js";
import {
  splitLinkSuffix,
  hrefOf,
  withHref,
  ANCHOR_RE,
} from "../dist/lib/links.js";
import { checkVocabulary, VOCABULARIES } from "../dist/lib/vocabularies.js";
import { pruned } from "../dist/tools/helpers.js";
import {
  checkWordCloudDescription,
  checkFocusKeyword,
  checkCurrency,
  checkEmbedId,
  checkQueryParameters,
  checkSchemaData,
} from "../dist/lib/field-formats.js";

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

// --- Reserved link values -------------------------------------------------
// The site reads certain link fields as instructions before treating them as
// URLs. Resolving one as a path reports a working modal trigger as a dead
// link, so these matchers have to stay exact.

test("classifyLinkValue: recognises the global CTA substitution", () => {
  assert.equal(classifyLinkValue("cta_url")?.kind, "global-cta");
});

test("classifyLinkValue: both consultation spellings open the wizard", () => {
  assert.equal(classifyLinkValue("consultation")?.kind, "consultation-modal");
  assert.equal(
    classifyLinkValue("modal-dialog-consultation")?.kind,
    "consultation-modal",
  );
});

test("classifyLinkValue: the modal-dialog prefix carries the form code", () => {
  const match = classifyLinkValue("modal-dialog-pre-assessment");
  assert.equal(match?.kind, "multi-page-form-modal");
  assert.equal(match?.formCode, "modal-dialog-pre-assessment");
});

test("classifyLinkValue: rich-text lead anchors are reserved", () => {
  assert.equal(classifyLinkValue("#get-free-consultation")?.worksIn, "rich-text-content");
  assert.equal(
    classifyLinkValue("#dialog=get-free-consultation")?.kind,
    "lead-popup-anchor",
  );
});

test("classifyLinkValue: only the exact lead-gated hosts are gated", () => {
  assert.equal(classifyLinkValue("https://wa.me/905551234567")?.kind, "lead-gated-external");
  assert.equal(classifyLinkValue("https://wa.link/abc")?.kind, "lead-gated-external");
  // A near miss must NOT be reported as gated — the site would send the
  // visitor straight out and the lead would be lost.
  assert.equal(classifyLinkValue("https://web.whatsapp.com/send"), null);
  assert.equal(classifyLinkValue("https://www.wa.me/905551234567"), null);
});

test("classifyLinkValue: an ordinary path is not reserved", () => {
  assert.equal(classifyLinkValue("/hair-transplant/cost/"), null);
  assert.equal(isReservedLinkValue("/hair-transplant/cost/"), false);
});

// --- Link parsing ---------------------------------------------------------

test("splitLinkSuffix: keeps a query string for reattachment", () => {
  assert.deepEqual(splitLinkSuffix("/blog?blog-category=hair"), {
    base: "/blog",
    suffix: "?blog-category=hair",
  });
});

test("splitLinkSuffix: keeps a fragment for reattachment", () => {
  assert.deepEqual(splitLinkSuffix("/about#team"), { base: "/about", suffix: "#team" });
});

test("hrefOf: reads double, single and unquoted hrefs", () => {
  assert.equal(hrefOf('<a href="/a/b">'), "/a/b");
  assert.equal(hrefOf("<a class='x' href='/a/b'>"), "/a/b");
  assert.equal(hrefOf("<a href=/a/b >"), "/a/b");
});

test("withHref: swaps the target and keeps every other attribute", () => {
  assert.equal(
    withHref('<a class="btn" href="/old/" target="_blank">', "/new/"),
    '<a class="btn" href="/new/" target="_blank">',
  );
});

test("ANCHOR_RE: finds single-quoted anchors too", () => {
  const html = `<a href="/one">A</a> <a href='/two'>B</a>`;
  assert.equal([...html.matchAll(ANCHOR_RE)].length, 2);
});

// --- Vocabularies ---------------------------------------------------------

test("checkVocabulary: accepts a value the site renders", () => {
  assert.equal(checkVocabulary("card_type", "content").ok, true);
});

test("checkVocabulary: rejects a value the site has no branch for", () => {
  assert.equal(checkVocabulary("card_type", "banner").ok, false);
});

test("checkVocabulary: rejects panel options the site never renders", () => {
  // Both are selectable in the admin panel but fall through on the site.
  assert.equal(checkVocabulary("card_type", "media_slider").ok, false);
  assert.equal(checkVocabulary("hero_style", "coverflow").ok, false);
});

test("checkVocabulary: slider style is capitalised", () => {
  assert.equal(checkVocabulary("slider_style", "Timeline").ok, true);
  assert.equal(checkVocabulary("slider_style", "timeline").ok, false);
});

test("checkVocabulary: a menu item must be custom_button to keep its submenu", () => {
  assert.equal(checkVocabulary("header_item_type", "custom_button").ok, true);
  assert.equal(checkVocabulary("header_item_type", "link").ok, false);
});

test("checkVocabulary: an empty or unknown field never blocks a write", () => {
  assert.equal(checkVocabulary("card_type", "").ok, true);
  assert.equal(checkVocabulary("card_type", undefined).ok, true);
  assert.equal(checkVocabulary("not_a_vocabulary", "anything").ok, true);
});

test("every vocabulary states what happens on an unknown value", () => {
  for (const [name, vocab] of Object.entries(VOCABULARIES)) {
    assert.ok(vocab.values.length > 0, `${name} has no values`);
    assert.ok(vocab.on_unknown, `${name} does not say what an unknown value does`);
    assert.ok(vocab.applies_to, `${name} does not say what it applies to`);
  }
});

// --- Parsed text columns --------------------------------------------------
// These columns look like free text everywhere but the site runs a parser over
// them and swallows the error, so a malformed value renders as nothing.

test("checkWordCloudDescription: rejects HTML where JSON is required", () => {
  assert.equal(checkWordCloudDescription("<p>Why choose us</p>").ok, false);
});

test("checkWordCloudDescription: accepts the badge array the site expects", () => {
  const badges = JSON.stringify([{ title: "Experience", description: "15 years" }]);
  assert.equal(checkWordCloudDescription(badges).ok, true);
});

test("checkWordCloudDescription: rejects entries with no title", () => {
  assert.equal(checkWordCloudDescription(JSON.stringify([{ description: "x" }])).ok, false);
});

test("checkFocusKeyword: one keyword, whichever separator was used", () => {
  // The audit substring-matches the WHOLE stored value, so a pipe list is no
  // better than a comma list — both fail every keyword check forever.
  assert.equal(checkFocusKeyword("hair transplant").ok, true);
  assert.equal(checkFocusKeyword("hair transplant|fue|turkey").ok, false);
  assert.equal(checkFocusKeyword("hair transplant, fue, turkey").ok, false);
});

test("checkFocusKeyword: the message names the keyword to keep", () => {
  // An editor fixing 200 posts needs the answer, not the diagnosis.
  const result = checkFocusKeyword("hair transplant cost,hair transplant cost turkey");
  assert.match(result.message, /'hair transplant cost'/);
});

test("checkCurrency: only an ISO-4217 code renders a symbol", () => {
  assert.equal(checkCurrency("USD").ok, true);
  assert.equal(checkCurrency("€").ok, false);
  assert.equal(checkCurrency("Euro").ok, false);
  assert.equal(checkCurrency("usd ").ok, false);
});

test("checkEmbedId: a dotted media type stores the bare video id", () => {
  assert.equal(checkEmbedId("youtube.short", "https://youtube.com/shorts/abc").ok, false);
  assert.equal(checkEmbedId("youtube.short", "abc").ok, true);
  // An ordinary video is a real URL and must not be flagged.
  assert.equal(checkEmbedId("video", "https://cdn.example/clip.mp4").ok, true);
});

test("checkQueryParameters: flags keys the site always overwrites", () => {
  assert.equal(checkQueryParameters("category_id=3").ok, true);
  assert.equal(checkQueryParameters("category_id=3&limit=5").ok, false);
});

test("checkSchemaData: structured data must carry its context", () => {
  assert.equal(checkSchemaData({ "@type": "Service" }).ok, false);
  assert.equal(
    checkSchemaData({ "@context": "https://schema.org", "@type": "Service" }).ok,
    true,
  );
  // An empty block means "no schema", not a broken one.
  assert.equal(checkSchemaData({}).ok, true);
});

test("slide type: the three the site branches on", () => {
  for (const type of ["timeline", "showcase", "image"]) {
    assert.equal(checkVocabulary("slide_type", type).ok, true);
  }
  assert.equal(checkVocabulary("slide_type", "carousel").ok, false);
});

test("slide type: the vocabulary warns about the styleless mixed slider", () => {
  // The site's fallback collects the timeline half by looking for type
  // 'image', so a styleless slider holding real 'timeline' slides loses them.
  // Anyone reading this vocabulary has to be told that, not just the values.
  assert.match(VOCABULARIES.slide_type.note, /drops every timeline slide/);
});

test("footer platform: only the four the API accepts", () => {
  assert.equal(checkVocabulary("footer_section_platform", "instagram").ok, true);
  assert.equal(checkVocabulary("footer_section_platform", "twitter").ok, false);
});

test("pruned: a field the caller left out is not sent", () => {
  // Every structural update builds its body by naming all the optional
  // fields. Without this, a PUT that changes an icon would blank the label.
  assert.deepEqual(pruned({ label: "Call us", url: undefined, order: 0 }), {
    label: "Call us",
    order: 0,
  });
});

test("pruned: an explicit null still goes through", () => {
  // Clearing a field is a real intent, and distinct from omitting it.
  assert.deepEqual(pruned({ logo_id: null }), { logo_id: null });
});
