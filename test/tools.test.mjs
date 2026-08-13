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
  ]) {
    register(server);
  }
  // Seed auth + write gate so the write tools proceed.
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
    schema_data: { "@type": "Service" },
    is_default: true,
  });
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/seo-schemas"));
  assert.equal(lastBody().is_default, true);
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
