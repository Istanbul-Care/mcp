// Tool request-shape tests. Boots each tool against a stub MCP server, mocks
// global.fetch, and asserts every write tool issues the right HTTP method, URL
// and body — no live backend needed. Import the COMPILED output in dist/, so
// run `npm run build` first.

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setSession } from "../dist/auth/session.js";
import { registerServiceTools } from "../dist/tools/services.js";
import { registerPageTools } from "../dist/tools/pages.js";
import { registerMediaTools } from "../dist/tools/media.js";
import { registerCardTools } from "../dist/tools/cards.js";
import { registerFormTools } from "../dist/tools/forms.js";
import { registerChatbotTools } from "../dist/tools/chatbot.js";
import { registerHeaderTools } from "../dist/tools/header.js";
import { registerSeoTools } from "../dist/tools/seo.js";
import { registerComponentTools } from "../dist/tools/components.js";
import { registerTranslateTools } from "../dist/tools/translate.js";

const PROJECT = "staging";
const handlers = new Map();
let calls = [];

function fakeServer() {
  return {
    registerTool(name, _def, handler) {
      handlers.set(name, handler);
    },
    registerPrompt() {},
  };
}

/** Invoke a tool by name and return its parsed result. */
async function call(name, args) {
  const handler = handlers.get(name);
  assert.ok(handler, `tool '${name}' is not registered`);
  return handler(args);
}

function lastCall() {
  return calls[calls.length - 1];
}
function lastBody() {
  return JSON.parse(lastCall().body);
}
function isError(result) {
  return result?.isError === true;
}

before(() => {
  // Register every tool onto one stub server.
  const server = fakeServer();
  for (const register of [
    registerServiceTools,
    registerPageTools,
    registerMediaTools,
    registerCardTools,
    registerFormTools,
    registerChatbotTools,
    registerHeaderTools,
    registerSeoTools,
    registerComponentTools,
    registerTranslateTools,
  ]) {
    register(server);
  }
  // Seed auth + write gate so the write tools proceed. Disable session
  // persistence so the fake test token never touches the real session file.
  process.env.ICMCP_PERSIST_SESSIONS = "0";
  process.env.ICMCP_WRITE_PROJECTS = PROJECT;
  setSession(PROJECT, "test-token", 60, {
    id: 1,
    email: "t@t.com",
    full_name: "Test",
    role: "admin",
  });
});

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method, body: opts.body, headers: opts.headers });
    return new Response(JSON.stringify({ status: "success", data: { id: 123, status: "draft" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
});

test("create_service: POST /admin/services with a nested translation", async () => {
  const r = await call("create_service", {
    project: PROJECT,
    language_id: 22,
    title: "All-On-X",
    slug: "all-on-x",
    excerpt: "e",
  });
  assert.ok(!isError(r));
  const c = lastCall();
  assert.equal(c.method, "POST");
  assert.ok(c.url.endsWith("/admin/services"), c.url);
  const body = lastBody();
  assert.equal(body.translation.title, "All-On-X");
  assert.equal(body.translation.language_id, 22);
  assert.equal(body.status, "draft");
});

test("create_page: POST /admin/pages with flat title/slug + coerced slug", async () => {
  const r = await call("create_page", {
    project: PROJECT,
    language_id: 22,
    title: "About",
    slug: "About Us", // should be coerced to about-us
  });
  assert.ok(!isError(r));
  const c = lastCall();
  assert.equal(c.method, "POST");
  assert.ok(c.url.endsWith("/admin/pages"));
  assert.equal(lastBody().slug, "about-us");
});

test("update_page: PUT /admin/pages/{id} replacing a section list", async () => {
  const r = await call("update_page", {
    project: PROJECT,
    page_id: 5,
    cards: [{ id: 10, order: 1 }, { id: 11, order: 2 }],
    featured_image_id: 99,
  });
  assert.ok(!isError(r));
  const c = lastCall();
  assert.equal(c.method, "PUT");
  assert.ok(c.url.endsWith("/admin/pages/5"));
  const body = lastBody();
  assert.equal(body.cards.length, 2);
  assert.equal(body.featured_image_id, 99);
});

test("create_card / update_card / delete_card hit the right verbs and paths", async () => {
  await call("create_card", { project: PROJECT, language_id: 22, title: "Card" });
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/cards"));

  await call("update_card", {
    project: PROJECT,
    card_id: 3,
    translation_update: { language_id: 22, title: "New" },
  });
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/cards/3"));
  assert.equal(lastBody().translation_update.title, "New");

  await call("delete_card", { project: PROJECT, card_id: 3 });
  assert.equal(lastCall().method, "DELETE");
  assert.ok(lastCall().url.endsWith("/admin/cards/3"));
});

test("create_contact_form: POST /admin/contact-form with all labels", async () => {
  await call("create_contact_form", {
    project: PROJECT,
    language_id: 22,
    title: "Reach us",
    description: "d",
    full_name_verbose_name: "Name",
    email_verbose_name: "Email",
    language_verbose_name: "Lang",
    number_verbose_name: "Phone",
    service_category_verbose_name: "Service",
    check_box_text: "ok",
    privacy_and_policy: "pp",
    button_text: "Send",
    button_url: "/x",
  });
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/contact-form"));
  assert.equal(lastBody().email_verbose_name, "Email");
});

test("create_multi_page_form: POST /admin/multi-page-form", async () => {
  await call("create_multi_page_form", {
    project: PROJECT,
    language_id: 22,
    customer_service_name: "Support",
    customer_service_status: "Online",
    customer_service_description: "d",
    cta_text: "Go",
    cta_button_text: "Start",
    prev_button_text: "Back",
    next_button_text: "Next",
  });
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/multi-page-form"));
});

test("update_chatbot_settings: PUT /admin/chatbot/settings", async () => {
  await call("update_chatbot_settings", { project: PROJECT, is_enabled: true, chat_model: "x" });
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/chatbot/settings"));
  assert.equal(lastBody().is_enabled, true);
});

test("add_header_item: POST with a single-language translation array", async () => {
  await call("add_header_item", {
    project: PROJECT,
    header_id: 6,
    language_id: 22,
    label: "About Us",
    url: "/about",
  });
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/headers/6/items"));
  const body = lastBody();
  assert.equal(body.translations[0].label, "About Us");
  assert.equal(body.translations[0].language_id, 22);
});

test("delete_header_item: DELETE /admin/headers/{h}/items/{i}", async () => {
  await call("delete_header_item", { project: PROJECT, header_id: 6, item_id: 18 });
  assert.equal(lastCall().method, "DELETE");
  assert.ok(lastCall().url.endsWith("/admin/headers/6/items/18"));
});

test("list_media: GET /admin/media with search params", async () => {
  await call("list_media", { project: PROJECT, search: "logo", limit: 20, page: 1 });
  assert.equal(lastCall().method, "GET");
  assert.ok(lastCall().url.includes("/admin/media"));
  assert.ok(lastCall().url.includes("search=logo"));
});

test("upload_media: reads a local file and POSTs multipart to /admin/media", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  const file = join(dir, "pic.png");
  writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // fake PNG header bytes
  const r = await call("upload_media", { project: PROJECT, file_path: file, alt: "a logo" });
  assert.ok(!isError(r));
  const c = lastCall();
  assert.equal(c.method, "POST");
  assert.ok(c.url.endsWith("/admin/media"));
  assert.ok(c.body instanceof FormData);
});

test("create_video_schema: builds a VideoObject JSON-LD and POSTs it", async () => {
  const r = await call("create_video_schema", {
    project: PROJECT,
    content_type: "page",
    specific_id: 42,
    name: "Hair Transplant Result",
    description: "12-month timeline.",
    thumbnail_url: "https://x/thumb.jpg",
    upload_date: "2026-08-13",
    embed_url: "https://youtube.com/embed/abc",
    duration_seconds: 95,
  });
  assert.ok(!isError(r));
  const c = lastCall();
  assert.equal(c.method, "POST");
  assert.ok(c.url.endsWith("/admin/seo-schemas"));
  const body = lastBody();
  assert.equal(body.content_type, "page");
  assert.equal(body.is_specific, true);
  assert.equal(body.specific_id, 42);
  assert.equal(body.schema_data["@type"], "VideoObject");
  assert.equal(body.schema_data.duration, "PT1M35S"); // 95s → 1m35s
  assert.equal(body.schema_data.embedUrl, "https://youtube.com/embed/abc");
});

test("create_seo_schema: POST with a raw JSON-LD object", async () => {
  await call("create_seo_schema", {
    project: PROJECT,
    content_type: "service",
    // The site emits schema_data verbatim, so it has to be complete JSON-LD.
    schema_data: { "@context": "https://schema.org", "@type": "Service" },
    is_default: true,
  });
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/seo-schemas"));
  assert.equal(lastBody().is_default, true);
});

test("create_seo_schema: refuses JSON-LD with no @context", async () => {
  const before = lastCall();
  const result = await call("create_seo_schema", {
    project: PROJECT,
    content_type: "service",
    schema_data: { "@type": "Service" },
  });
  // Nothing is sent: an incomplete block would be emitted into the page as-is
  // and silently ignored by search engines.
  assert.equal(lastCall(), before);
  assert.match(JSON.stringify(result), /@context/);
});

test("delete_seo_schema: DELETE /admin/seo-schemas/{id}", async () => {
  await call("delete_seo_schema", { project: PROJECT, schema_id: 7 });
  assert.equal(lastCall().method, "DELETE");
  assert.ok(lastCall().url.endsWith("/admin/seo-schemas/7"));
});

test("create_redirect: POST /admin/redirects forwarding source/target/method", async () => {
  // NB: the stub server bypasses zod, so pass method explicitly (no default applied here).
  await call("create_redirect", {
    project: PROJECT,
    source_url: "/old",
    target_url: "/new",
    method: "301",
  });
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/redirects"));
  const body = lastBody();
  assert.equal(body.source_url, "/old");
  assert.equal(body.method, "301");
});

test("create_hero: wraps text fields into a translation object", async () => {
  await call("create_hero", {
    project: PROJECT,
    language_id: 22,
    clinic_rank: "No.1",
    title: "Best Clinic",
    subtitle: "sub",
    button_text: "Book",
    button_url: "/book",
  });
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/heroes"));
  const body = lastBody();
  assert.equal(body.translation.title, "Best Clinic");
  assert.equal(body.translation.language_id, 22);
});

test("create_google_map_section: nests title/cta into translation", async () => {
  await call("create_google_map_section", {
    project: PROJECT,
    googlemap_url: "https://maps/x",
    phone_number: "+90",
    email: "a@b.c",
    social_media_id: "ic",
    language_id: 22,
    title: "Contact",
    description: "d",
    cta_button_text: "Call",
    cta_button_url: "/call",
  });
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/google-map-sections"));
  assert.equal(lastBody().translation.cta_button_text, "Call");
});

test("create_package: nests title into translation", async () => {
  await call("create_package", { project: PROJECT, language_id: 22, title: "VIP" });
  assert.ok(lastCall().url.endsWith("/admin/packages"));
  assert.equal(lastBody().translation.title, "VIP");
});

test("update_package: PUT /admin/packages/{id} with price", async () => {
  await call("update_package", { project: PROJECT, package_id: 3, price: 2500 });
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/packages/3"));
  assert.equal(lastBody().price, 2500);
});

test("list_price_compares: GET /admin/price-compares", async () => {
  await call("list_price_compares", { project: PROJECT });
  assert.equal(lastCall().method, "GET");
  assert.ok(lastCall().url.includes("/admin/price-compares"));
});

test("delete_before_after: DELETE /admin/before-afters/{id}", async () => {
  await call("delete_before_after", { project: PROJECT, before_after_id: 9 });
  assert.equal(lastCall().method, "DELETE");
  assert.ok(lastCall().url.endsWith("/admin/before-afters/9"));
});

test("create_global_setting: nests contact block into translation", async () => {
  await call("create_global_setting", {
    project: PROJECT,
    robots_txt_content: "User-agent: *",
    llms_txt_content: "# llms",
    site_url: "https://x",
    language_id: 22,
    address: "Istanbul",
    phone_number: "+90",
    cta_text: "Book",
    cta_url: "/book",
  });
  assert.ok(lastCall().url.endsWith("/admin/global-settings"));
  assert.equal(lastBody().translation.address, "Istanbul");
  assert.equal(lastBody().site_url, "https://x");
});

test("write gate: a write tool refuses when the brand is not write-enabled", async () => {
  const saved = process.env.ICMCP_WRITE_PROJECTS;
  process.env.ICMCP_WRITE_PROJECTS = ""; // nothing writable
  try {
    const r = await call("create_card", { project: PROJECT, language_id: 22, title: "x" });
    assert.ok(isError(r), "expected a write-gate error");
    assert.equal(calls.length, 0, "must not hit the network when gated");
  } finally {
    process.env.ICMCP_WRITE_PROJECTS = saved;
  }
});

// --- cards -> page_content ------------------------------------------------

/** Route the stub fetch by URL so multi-request tools can be exercised. */
function routedFetch(routes) {
  return async (url, opts = {}) => {
    const href = String(url);
    calls.push({ url: href, method: opts.method, body: opts.body, headers: opts.headers });
    const path = new URL(href).pathname;
    const match = Object.entries(routes).find(([fragment]) => path.includes(fragment));
    const payload = match ? match[1] : { status: "success", data: {} };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

const LANGUAGES = {
  status: "success",
  data: { languages: [{ id: 22, name: "English", code: "en", icon: "", order: 1, is_active: true }] },
};

test("set_page_content: PUTs the body and re-sends the rest of the translation", async () => {
  globalThis.fetch = routedFetch({
    "/admin/languages": LANGUAGES,
    "/admin/pages/7/translations/22": { status: "success", data: {} },
    "/admin/pages/7": {
      status: "success",
      data: {
        id: 7,
        translations: [
          {
            language: { id: 22, code: "en", name: "English" },
            title: "Cost",
            slug: "cost",
            meta_title: "Cost 2026",
            content: "old",
            robots_index: true,
          },
        ],
      },
    },
  });

  const r = await call("set_page_content", {
    project: PROJECT,
    page_id: 7,
    language_code: "en",
    content: "<h2>Cost</h2>",
    page_content: { enabled: true, order: 3, grid_columns: 12 },
  });
  assert.ok(!isError(r));

  const write = calls.find(
    (c) => c.method === "PUT" && c.url.includes("/admin/pages/7/translations/22"),
  );
  assert.ok(write, "no translation PUT");
  const body = JSON.parse(write.body);
  assert.equal(body.content, "<h2>Cost</h2>");
  // The untouched columns ride along so the PUT cannot clear them.
  assert.equal(body.title, "Cost");
  assert.equal(body.slug, "cost");
  assert.equal(body.meta_title, "Cost 2026");
  assert.equal(body.robots_index, true);

  const block = lastCall();
  assert.equal(block.method, "PUT");
  assert.ok(block.url.endsWith("/admin/pages/7"));
  assert.equal(JSON.parse(block.body).page_content.enabled, true);
});

test("set_page_content: refuses a language the page does not have yet", async () => {
  globalThis.fetch = routedFetch({
    "/admin/languages": LANGUAGES,
    "/admin/pages/7": { status: "success", data: { id: 7, translations: [] } },
  });
  const r = await call("set_page_content", {
    project: PROJECT,
    page_id: 7,
    language_code: "en",
    content: "<p>x</p>",
  });
  assert.ok(isError(r));
  assert.ok(!calls.some((c) => c.method === "PUT"), "must not write");
});

test("get_page_cards: resolves each attached card in render order", async () => {
  globalThis.fetch = routedFetch({
    "/admin/pages/7": {
      status: "success",
      data: {
        id: 7,
        cards: [
          { id: 12, order: 2, grid_columns: 12 },
          { id: 11, order: 1, grid_columns: 6 },
        ],
      },
    },
    "/admin/cards/11": {
      status: "success",
      data: {
        id: 11,
        type: "content",
        translations: [
          { language: { id: 22, code: "en", name: "English" }, title: "First", description: "<p>a</p>" },
          { language: { id: 35, code: "de", name: "Deutsch" }, title: "Erste", description: "<p>b</p>" },
        ],
      },
    },
    "/admin/cards/12": {
      status: "success",
      data: { id: 12, type: "whatsapp", translations: [] },
    },
  });

  const r = await call("get_page_cards", { project: PROJECT, page_id: 7, language_code: "en" });
  assert.ok(!isError(r));
  const data = JSON.parse(r.content[0].text);
  assert.deepEqual(
    data.cards.map((c) => c.id),
    [11, 12],
  );
  assert.equal(data.cards[0].translations.length, 1);
  assert.equal(data.cards[0].translations[0].title, "First");
  assert.equal(data.cards[1].type, "whatsapp");
});

test("fold_page_cards: dry run builds the body without writing anything", async () => {
  const PAGE = {
    status: "success",
    data: {
      id: 9,
      translations: [
        { language: { id: 22, code: "en", name: "English" }, title: "Cost", slug: "cost", content: "" },
      ],
      cards: [
        { id: 21, order: 1, grid_columns: 12 },
        { id: 20, order: 0, grid_columns: 12 },
        { id: 22, order: 2, grid_columns: 6 },
      ],
    },
  };
  const card = (id, type, title, description) => ({
    status: "success",
    data: {
      id,
      type,
      translations: [{ language: { id: 22, code: "en", name: "English" }, title, description }],
    },
  });
  globalThis.fetch = routedFetch({
    "/admin/languages": LANGUAGES,
    "/admin/cards/20": card(20, "default", "First", "<p>one</p>"),
    "/admin/cards/21": card(21, "content", "Second", "<p>two</p>"),
    "/admin/cards/22": card(22, "whatsapp", "Chat", "<p>nope</p>"),
    "/admin/pages/9": PAGE,
  });

  const r = await call("fold_page_cards", { project: PROJECT, page_id: 9, dry_run: true });
  assert.ok(!isError(r));
  const data = JSON.parse(r.content[0].text);
  assert.deepEqual(data.folded_cards.map((c) => c.id), [20, 21]);
  assert.deepEqual(data.kept_cards.map((c) => c.id), [22]);
  assert.ok(data.languages[0].preview.includes("<h2>First</h2>\n<p>one</p>"));
  assert.ok(!calls.some((c) => c.method === "PUT"), "dry run must not write");
});

test("fold_page_cards: writes the body, sets the block and detaches the folded cards", async () => {
  globalThis.fetch = routedFetch({
    "/admin/languages": LANGUAGES,
    "/admin/cards/20": {
      status: "success",
      data: {
        id: 20,
        type: "default",
        translations: [
          { language: { id: 22, code: "en", name: "English" }, title: "First", description: "<p>one</p>" },
        ],
      },
    },
    "/admin/cards/22": { status: "success", data: { id: 22, type: "whatsapp", translations: [] } },
    "/admin/pages/9": {
      status: "success",
      data: {
        id: 9,
        translations: [
          { language: { id: 22, code: "en", name: "English" }, title: "Cost", slug: "cost", content: "" },
        ],
        cards: [
          { id: 20, order: 3, grid_columns: 12 },
          { id: 22, order: 4, grid_columns: 6 },
        ],
      },
    },
  });

  const r = await call("fold_page_cards", {
    project: PROJECT,
    page_id: 9,
    dry_run: false,
    detach_cards: true,
  });
  assert.ok(!isError(r));

  const write = calls.find((c) => c.method === "PUT" && c.url.includes("/translations/22"));
  assert.ok(write, "no body written");
  assert.equal(JSON.parse(write.body).content, "<h2>First</h2>\n<p>one</p>");
  assert.equal(JSON.parse(write.body).slug, "cost");

  const structure = lastCall();
  assert.equal(structure.method, "PUT");
  assert.ok(structure.url.endsWith("/admin/pages/9"));
  const body = JSON.parse(structure.body);
  assert.equal(body.page_content.enabled, true);
  assert.equal(body.page_content.order, 3, "block takes the first folded card's slot");
  assert.deepEqual(body.cards, [{ id: 22, order: 4, grid_columns: 6 }], "widget card survives");
});

test("fold_page_cards: refuses to clobber an existing body without overwrite", async () => {
  globalThis.fetch = routedFetch({
    "/admin/languages": LANGUAGES,
    "/admin/cards/20": {
      status: "success",
      data: {
        id: 20,
        type: "default",
        translations: [
          { language: { id: 22, code: "en", name: "English" }, title: "T", description: "<p>x</p>" },
        ],
      },
    },
    "/admin/pages/9": {
      status: "success",
      data: {
        id: 9,
        translations: [
          { language: { id: 22, code: "en", name: "English" }, title: "Cost", slug: "cost", content: "<p>already here</p>" },
        ],
        cards: [{ id: 20, order: 0, grid_columns: 12 }],
      },
    },
  });

  const r = await call("fold_page_cards", { project: PROJECT, page_id: 9, dry_run: false });
  assert.ok(!isError(r));
  const data = JSON.parse(r.content[0].text);
  assert.match(data.languages[0].skipped, /overwrite/);
  assert.ok(!calls.some((c) => c.method === "PUT"), "must not write");
});

// --- footer coverage ---------------------------------------------------------
// The footer is not a SURFACES row (it is a nested CTA/section/item tree with
// its own footer_worklist / save_footer flow), so translation_coverage used to
// omit it entirely and report "nothing missing" for a surface it never read.

// A project of its own: resolveLanguageIds caches the language list per
// project, and the shared PROJECT is already cached as English-only by the
// tests above.
const FOOTER_PROJECT = "estemoon";

const EN_AR_LANGUAGES = {
  status: "success",
  data: {
    languages: [
      { id: 22, code: "en", name: "English", icon: "", order: 1, is_active: true },
      { id: 45, code: "ar", name: "Arabic", icon: "", order: 2, is_active: true },
    ],
  },
};

test("translation_coverage: reports the footer as its own type", async () => {
  globalThis.fetch = routedFetch({
    "/admin/languages": EN_AR_LANGUAGES,
    "/admin/footers": {
      status: "success",
      data: {
        footers: [
          // en only → missing ar
          { id: 6, name: "Main Page Footer", translations: [{ language: { id: 22, code: "en" } }] },
          // en + ar → complete
          {
            id: 7,
            name: "Landing Footer",
            translations: [
              { language: { id: 22, code: "en" } },
              { language: { id: 45, code: "ar" } },
            ],
          },
        ],
      },
    },
  });

  setSession(FOOTER_PROJECT, "test-token", 60, {
    id: 1,
    email: "t@t.com",
    full_name: "Test",
    role: "admin",
  });
  const r = await call("translation_coverage", {
    project: FOOTER_PROJECT,
    source_language_code: "en",
    target_language_codes: ["ar"],
    types: ["footer"],
    include_items: true,
  });
  assert.ok(!isError(r));
  const out = JSON.parse(r.content[0].text);

  const footer = out.by_type.find((row) => row.type === "footer");
  assert.ok(footer, "coverage did not report a footer row");
  assert.equal(footer.rows, 2);
  assert.equal(footer.missing.ar, 1);
  assert.equal(footer.missing_items.ar[0].id, 6);
  assert.equal(out.missing_totals.ar, 1);

  // Narrowing to the footer must not fall through to sweeping every surface.
  assert.equal(out.by_type.length, 1);
  assert.ok(
    !calls.some((c) => c.url.includes("/admin/faqs")),
    "footer-only sweep still walked other surfaces",
  );
});

test("translation_coverage: footer is included when no types are given", async () => {
  globalThis.fetch = routedFetch({
    "/admin/languages": EN_AR_LANGUAGES,
    "/admin/footers": {
      status: "success",
      data: {
        footers: [
          { id: 6, name: "Main Page Footer", translations: [{ language: { id: 22, code: "en" } }] },
        ],
      },
    },
  });

  setSession(FOOTER_PROJECT, "test-token", 60, {
    id: 1,
    email: "t@t.com",
    full_name: "Test",
    role: "admin",
  });
  const r = await call("translation_coverage", {
    project: FOOTER_PROJECT,
    source_language_code: "en",
    target_language_codes: ["ar"],
  });
  assert.ok(!isError(r));
  const out = JSON.parse(r.content[0].text);
  assert.ok(
    out.by_type.some((row) => row.type === "footer"),
    "an unnarrowed sweep left the footer out",
  );
});

/*
 * The service dropdown is keyed by a query param, not by path, so it needs a
 * fetch that reads language_id — the point of the test is precisely that an
 * empty option list for one language is a gap and not a success.
 */
function serviceOptionFetch({ sourceOptions, targetOptions }) {
  return async (url, opts = {}) => {
    const href = String(url);
    calls.push({ url: href, method: opts.method, body: opts.body, headers: opts.headers });
    const parsed = new URL(href);
    const path = parsed.pathname;
    let payload = { status: "success", data: {} };

    if (path.includes("/admin/languages")) {
      payload = EN_AR_LANGUAGES;
    } else if (path.includes("/service-options")) {
      const languageId = parsed.searchParams.get("language_id");
      payload = {
        status: "success",
        data: languageId === "45" ? targetOptions : sourceOptions,
      };
    } else if (path.includes("/admin/contact-form")) {
      payload = {
        status: "success",
        data: {
          contact_form: [
            {
              id: 3,
              translations: [{ language: { id: 22, code: "en" }, title: "Reach Us Now" }],
            },
          ],
          total: 1,
          page: 1,
          limit: 100,
          total_pages: 1,
        },
      };
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

const EN_SERVICE_OPTIONS = [
  { id: 1, contact_form_id: 3, language_id: 22, name: "Hair Transplant", code: "hair-transplant", sort_order: 0 },
  { id: 10, contact_form_id: 3, language_id: 22, name: "Dental", code: "dental", sort_order: 1 },
];

test("translation_coverage: an empty service dropdown counts as missing", async () => {
  globalThis.fetch = serviceOptionFetch({
    sourceOptions: EN_SERVICE_OPTIONS,
    targetOptions: [],
  });
  setSession(FOOTER_PROJECT, "test-token", 60, {
    id: 1,
    email: "t@t.com",
    full_name: "Test",
    role: "admin",
  });

  const r = await call("translation_coverage", {
    project: FOOTER_PROJECT,
    source_language_code: "en",
    target_language_codes: ["ar"],
    types: ["contact_form_options"],
    include_items: true,
  });
  assert.ok(!isError(r));
  const out = JSON.parse(r.content[0].text);

  const row = out.by_type.find((entry) => entry.type === "contact_form_options");
  assert.ok(row, "coverage did not report the contact form dropdown");
  assert.equal(row.rows, 1);
  assert.equal(row.missing.ar, 1);
  assert.equal(row.missing_items.ar[0].id, 3);
  assert.equal(out.missing_totals.ar, 1);
  assert.equal(out.by_type.length, 1, "narrowing fell through to other surfaces");
});

test("translation_coverage: a filled service dropdown is not reported missing", async () => {
  globalThis.fetch = serviceOptionFetch({
    sourceOptions: EN_SERVICE_OPTIONS,
    targetOptions: [
      { id: 60, contact_form_id: 3, language_id: 45, name: "زراعة الشعر", code: "hair-transplant", sort_order: 0 },
      { id: 61, contact_form_id: 3, language_id: 45, name: "طب الأسنان", code: "dental", sort_order: 1 },
    ],
  });
  setSession(FOOTER_PROJECT, "test-token", 60, {
    id: 1,
    email: "t@t.com",
    full_name: "Test",
    role: "admin",
  });

  const r = await call("translation_coverage", {
    project: FOOTER_PROJECT,
    source_language_code: "en",
    target_language_codes: ["ar"],
    types: ["contact_form_options"],
  });
  assert.ok(!isError(r));
  const out = JSON.parse(r.content[0].text);
  const row = out.by_type.find((entry) => entry.type === "contact_form_options");
  assert.ok(row);
  assert.equal(row.missing.ar, 0);
  assert.equal(out.missing_totals.ar ?? 0, 0);
});

test("save_contact_form_options: posts one row per option and keeps code verbatim", async () => {
  globalThis.fetch = serviceOptionFetch({ sourceOptions: EN_SERVICE_OPTIONS, targetOptions: [] });
  setSession(FOOTER_PROJECT, "test-token", 60, {
    id: 1,
    email: "t@t.com",
    full_name: "Test",
    role: "admin",
  });
  calls.length = 0;

  const savedGate = process.env.ICMCP_WRITE_PROJECTS;
  process.env.ICMCP_WRITE_PROJECTS = `${savedGate},${FOOTER_PROJECT}`;
  const r = await call("save_contact_form_options", {
    project: FOOTER_PROJECT,
    contact_form_id: 3,
    language_code: "ar",
    options: [
      { name: "زراعة الشعر", code: "hair-transplant", sort_order: 0 },
      { name: "طب الأسنان", code: "dental", sort_order: 1 },
    ],
  });
  process.env.ICMCP_WRITE_PROJECTS = savedGate;
  assert.ok(!isError(r), r.content?.[0]?.text);

  const posts = calls.filter((c) => c.method === "POST" && c.url.includes("/service-options"));
  assert.equal(posts.length, 2);
  const bodies = posts.map((c) => JSON.parse(c.body));
  assert.deepEqual(
    bodies.map((b) => b.code),
    ["hair-transplant", "dental"],
    "code must be sent unchanged — it is the value submitted with the lead",
  );
  assert.ok(bodies.every((b) => b.language_id === 45));
});
