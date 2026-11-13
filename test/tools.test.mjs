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
import { registerStructureTools } from "../dist/tools/structure.js";
import { registerLayoutTools } from "../dist/tools/layout.js";
import { registerTaxonomyTools } from "../dist/tools/taxonomy.js";
import { registerDiscoveryTools } from "../dist/tools/discovery.js";
import { registerBulkContentTools } from "../dist/tools/bulk-content.js";
import { VOCABULARIES } from "../dist/lib/vocabularies.js";

const PROJECT = "staging";
const handlers = new Map();
const definitions = new Map();
let calls = [];

function fakeServer() {
  return {
    registerTool(name, def, handler) {
      handlers.set(name, handler);
      definitions.set(name, def);
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
    registerStructureTools,
    registerLayoutTools,
    registerTaxonomyTools,
    registerDiscoveryTools,
    registerBulkContentTools,
  ]) {
    register(server);
  }
  // Seed auth so the write tools proceed. Disable session
  // persistence so the fake test token never touches the real session file.
  process.env.ICMCP_PERSIST_SESSIONS = "0";
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

const STICKY_WHATSAPP = {
  enabled: true,
  urls: {
    en: "https://destakesk.github.io/brand-web-english/",
    it: "https://destakesk.github.io/brand-web-italiano/",
  },
};

test("update_page: sends sticky_whatsapp as given (it replaces the stored one)", async () => {
  const r = await call("update_page", { project: PROJECT, page_id: 5, sticky_whatsapp: STICKY_WHATSAPP });
  assert.ok(!isError(r));
  assert.ok(lastCall().url.endsWith("/admin/pages/5"));
  assert.deepEqual(lastBody().sticky_whatsapp, STICKY_WHATSAPP);
  assert.deepEqual(JSON.parse(r.content[0].text).changed, ["sticky_whatsapp"]);
});

test("create_page: can switch the sticky WhatsApp on from the start", async () => {
  const r = await call("create_page", {
    project: PROJECT,
    language_id: 22,
    title: "Offer",
    slug: "offer",
    sticky_whatsapp: STICKY_WHATSAPP,
  });
  assert.ok(!isError(r));
  assert.deepEqual(lastBody().sticky_whatsapp, STICKY_WHATSAPP);
});

test("get_page: shows the page's sticky WhatsApp, or null when it has none", async () => {
  globalThis.fetch = routedFetch({
    "/admin/pages/8": { status: "success", data: { id: 8, translations: [], sticky_whatsapp: STICKY_WHATSAPP } },
    "/admin/pages/9": { status: "success", data: { id: 9, translations: [] } },
  });
  const on = JSON.parse((await call("get_page", { project: PROJECT, page_id: 8 })).content[0].text);
  assert.deepEqual(on.sticky_whatsapp, STICKY_WHATSAPP);
  const off = JSON.parse((await call("get_page", { project: PROJECT, page_id: 9 })).content[0].text);
  assert.equal(off.sticky_whatsapp, null);
});

test("update_page: the services section takes a style and its categories", async () => {
  const services = { enabled: true, order: 3, grid_columns: 12, style: 2, category_ids: [7, 3] };
  const r = await call("update_page", { project: PROJECT, page_id: 5, services });
  assert.ok(!isError(r));
  assert.deepEqual(lastBody().services, services);
  assert.deepEqual(JSON.parse(r.content[0].text).changed, ["services"]);
});

test("update_page: the blog listing takes a style 1 to 5 (5 = the v8 list)", async () => {
  const blogs = { enabled: true, order: 4, grid_columns: 12, style: 3, query_parameters: "category_id=14" };
  const r = await call("update_page", { project: PROJECT, page_id: 223, blogs });
  assert.ok(!isError(r));
  assert.deepEqual(lastBody().blogs, blogs);
  const schema = definitions.get("update_page").inputSchema.blogs;
  assert.ok(schema.safeParse({ enabled: true, style: 4 }).success);
  assert.ok(schema.safeParse({ enabled: true, style: 5 }).success);
  assert.ok(!schema.safeParse({ enabled: true, style: 6 }).success);
});

test("update_page: a blog page's post design (single_blog_content style 2 = the v8 article)", async () => {
  const single_blog_content = { enabled: true, order: 2, grid_columns: 12, style: 2 };
  const r = await call("update_page", { project: PROJECT, page_id: 40, single_blog_content });
  assert.ok(!isError(r));
  assert.deepEqual(lastBody().single_blog_content, single_blog_content);
  const schema = definitions.get("update_page").inputSchema.single_blog_content;
  assert.ok(schema.safeParse({ enabled: true }).success);
  assert.ok(!schema.safeParse({ enabled: true, style: 3 }).success);
});

const REVIEWS_V8 = {
  enabled: true,
  order: 6,
  grid_columns: 12,
  style: 2,
  average_rating: 4.7,
  total_reviews_text: "1,179",
  years_experience_text: null,
  since_year: 2012,
  countries_text: "30+",
  follow_up_text: "12 mo",
  read_all_url: "https://g.page/r/example/review",
};

test("update_page: the reviews block takes style 2 and its figures, all sent as given", async () => {
  const r = await call("update_page", { project: PROJECT, page_id: 5, reviews: REVIEWS_V8 });
  assert.ok(!isError(r));
  assert.ok(lastCall().url.endsWith("/admin/pages/5"));
  assert.deepEqual(lastBody().reviews, REVIEWS_V8);
  assert.deepEqual(JSON.parse(r.content[0].text).changed, ["reviews"]);
});

test("update_page: the reviews schema keeps every field, so a re-sent block is not reset", () => {
  const schema = definitions.get("update_page").inputSchema.reviews;
  // zod strips keys it does not know; the stored object is replaced by what is
  // sent, so a dropped style or figure would silently go back to its default.
  const parsed = schema.safeParse(REVIEWS_V8);
  assert.ok(parsed.success);
  assert.deepEqual(parsed.data, REVIEWS_V8);
  // get_page shows unset fields as null; sending them back must be accepted.
  const unset = { enabled: true, style: 1, since_year: null, countries_text: null, follow_up_text: null, read_all_url: null, average_rating: null, total_reviews_text: null };
  assert.ok(schema.safeParse(unset).success);
  assert.ok(schema.safeParse({ enabled: true }).success);

  assert.ok(!schema.safeParse({ enabled: true, style: 3 }).success);
  assert.ok(!schema.safeParse({ enabled: true, style: null }).success);
  assert.ok(!schema.safeParse({ enabled: true, since_year: 1899 }).success);
  assert.ok(!schema.safeParse({ enabled: true, since_year: 2101 }).success);
  assert.ok(!schema.safeParse({ enabled: true, since_year: 2012.5 }).success);
  assert.ok(!schema.safeParse({ enabled: true, countries_text: "x".repeat(17) }).success);
  assert.ok(!schema.safeParse({ enabled: true, follow_up_text: "x".repeat(17) }).success);
  assert.ok(!schema.safeParse({ enabled: true, read_all_url: "x".repeat(501) }).success);
  assert.ok(!schema.safeParse({ enabled: true, average_rating: 5.1 }).success);
  // The block's own text says a partial object replaces the stored one.
  assert.match(schema.description, /REPLACES/);
});

test("get_page: shows the reviews block as stored, style and figures included", async () => {
  globalThis.fetch = routedFetch({
    "/admin/pages/8": { status: "success", data: { id: 8, translations: [], reviews: REVIEWS_V8 } },
  });
  const out = JSON.parse((await call("get_page", { project: PROJECT, page_id: 8 })).content[0].text);
  assert.deepEqual(out.feature_blocks.reviews, REVIEWS_V8);
});

test("update_page: the services section accepts only style 1, 2 or 3 and category ids", () => {
  const services = definitions.get("update_page").inputSchema.services;
  assert.ok(services.safeParse({ enabled: true, style: 2, category_ids: [4] }).success);
  assert.ok(services.safeParse({ enabled: true, style: 3, category_ids: [4, 5] }).success);
  assert.ok(!services.safeParse({ enabled: true, style: 4 }).success);
  assert.ok(!services.safeParse({ enabled: true, category_ids: [0] }).success);
});

test("update_hero: sets the spotlight style and its side image (0 removes it)", async () => {
  const r = await call("update_hero", { project: PROJECT, hero_id: 6, style: "spotlight", side_image_id: 42 });
  assert.ok(!isError(r));
  assert.ok(lastCall().url.endsWith("/admin/heroes/6"));
  assert.equal(lastBody().style, "spotlight");
  assert.equal(lastBody().side_image_id, 42);
  await call("update_hero", { project: PROJECT, hero_id: 6, side_image_id: 0 });
  assert.equal(lastBody().side_image_id, 0);
});

test("update_contact_form: makes a form the brand's default", async () => {
  const r = await call("update_contact_form", { project: PROJECT, contact_form_id: 3, is_default: true });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/contact-form/3"));
  assert.deepEqual(lastBody(), { is_default: true });
});

test("update_global_setting: can put the lead form in the popup", async () => {
  const r = await call("update_global_setting", { project: PROJECT, setting_id: 1, popup_show_form: true });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/global-settings/1"));
  assert.deepEqual(lastBody(), { popup_show_form: true });
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

// --- menu icons: header items and the categories a header menu lists -------

test("add_header_item: the icon is sent as icon_media_id beside the translation", async () => {
  const r = await call("add_header_item", {
    project: PROJECT,
    header_id: 6,
    language_id: 22,
    label: "Hair Transplant",
    url: "hair-transplant",
    item_type: "custom_button",
    icon_media_id: 41,
  });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/headers/6/items"));
  const body = lastBody();
  assert.equal(body.icon_media_id, 41);
  assert.equal(body.translations[0].label, "Hair Transplant");

  // No icon given: no key at all, so the item is created without one.
  await call("add_header_item", {
    project: PROJECT,
    header_id: 6,
    language_id: 22,
    label: "About",
    url: "about",
    item_type: "custom_button",
  });
  assert.ok(!("icon_media_id" in lastBody()));
});

test("update_header_item: icon_media_id null clears the icon, leaving it out keeps it", async () => {
  const r = await call("update_header_item", {
    project: PROJECT,
    header_id: 6,
    item_id: 18,
    icon_media_id: null,
  });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/headers/6/items/18"));
  assert.deepEqual(lastBody(), { icon_media_id: null });

  await call("update_header_item", { project: PROJECT, header_id: 6, item_id: 18, order: 2 });
  assert.deepEqual(lastBody(), { order: 2 });

  // The handler is called directly above; the schema must let null through too.
  const icon = definitions.get("update_header_item").inputSchema.icon_media_id;
  assert.ok(icon.safeParse(null).success);
  assert.ok(icon.safeParse(undefined).success);
  assert.ok(!icon.safeParse(1.5).success);
});

test("create_post_category: carries icon_media_id", async () => {
  const r = await call("create_post_category", {
    project: PROJECT,
    name: "Hair Care",
    slug: "hair-care",
    order: 0,
    icon_media_id: 7,
  });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/post-categories"));
  assert.equal(lastBody().icon_media_id, 7);
  assert.equal(lastBody().slug, "hair-care");
});

test("update_service_category / update_post_category: PUT only the icon", async () => {
  const r = await call("update_service_category", {
    project: PROJECT,
    category_id: 12,
    icon_media_id: 9,
  });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/service-categories/12"));
  assert.deepEqual(lastBody(), { icon_media_id: 9 });
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.category_id, 12);
  assert.equal(out.icon_media_id, 9);

  await call("update_post_category", { project: PROJECT, category_id: 4, icon_media_id: null });
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/post-categories/4"));
  assert.deepEqual(lastBody(), { icon_media_id: null });
});

test("update_post_category: the own sitemap fields, only those passed", async () => {
  let r = await call("update_post_category", {
    project: PROJECT,
    category_id: 14,
    sitemap_name: "news",
    sitemap_page_id: 223,
  });
  assert.ok(!isError(r));
  assert.ok(lastCall().url.endsWith("/admin/post-categories/14"));
  assert.deepEqual(lastBody(), { sitemap_name: "news", sitemap_page_id: 223 });

  await call("update_post_category", { project: PROJECT, category_id: 14, sitemap_name: "" });
  assert.deepEqual(lastBody(), { sitemap_name: null });

  r = await call("update_post_category", { project: PROJECT, category_id: 14 });
  assert.ok(isError(r));

  const name = definitions.get("update_post_category").inputSchema.sitemap_name;
  assert.ok(name.safeParse("press-room").success);
  assert.ok(!name.safeParse("posts").success);
  assert.ok(!name.safeParse("News").success);
  assert.ok(!name.safeParse("a_b").success);
});

test("list_service_categories / list_post_categories: each category shows its icon_media_url", async () => {
  const category = (id, icon) => ({
    id,
    parent_id: null,
    icon_media_id: icon ? 9 : null,
    icon_media_url: icon,
    translations: [{ language: { id: 22, code: "en", name: "English" }, name: "FUE", slug: "fue" }],
  });
  const list = {
    status: "success",
    data: {
      categories: [category(1, "/media/icons/fue.svg"), category(2, null)],
      total: 2,
      page: 1,
      limit: 100,
      total_pages: 1,
    },
  };
  globalThis.fetch = routedFetch({ "/admin/service-categories": list, "/admin/post-categories": list });

  for (const tool of ["list_service_categories", "list_post_categories"]) {
    const out = JSON.parse((await call(tool, { project: PROJECT, limit: 100, page: 1 })).content[0].text);
    assert.equal(out.categories[0].icon_media_url, "/media/icons/fue.svg", tool);
    assert.equal(out.categories[1].icon_media_url, null, tool);
  }
});

// --- header buttons: a top-level custom_button item shown as a button -------

test("add_header_item: button_style and button_show_on are sent beside the translation", async () => {
  const r = await call("add_header_item", {
    project: PROJECT,
    header_id: 6,
    language_id: 22,
    label: "Free Consultation",
    url: "consultation",
    item_type: "custom_button",
    button_style: "filled",
    button_show_on: "mobile",
  });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/headers/6/items"));
  const body = lastBody();
  assert.equal(body.button_style, "filled");
  assert.equal(body.button_show_on, "mobile");
  assert.equal(body.translations[0].url, "consultation");

  // Neither given: no keys at all, so the item is created as a plain menu link.
  await call("add_header_item", {
    project: PROJECT,
    header_id: 6,
    language_id: 22,
    label: "About",
    url: "about",
    item_type: "custom_button",
  });
  assert.ok(!("button_style" in lastBody()));
  assert.ok(!("button_show_on" in lastBody()));
});

test("update_header_item: button fields sent when given, null clears them, leaving them out keeps them", async () => {
  const r = await call("update_header_item", {
    project: PROJECT,
    header_id: 6,
    item_id: 18,
    button_style: "outline",
    button_show_on: "desktop",
  });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/headers/6/items/18"));
  assert.deepEqual(lastBody(), { button_style: "outline", button_show_on: "desktop" });

  // null: a plain menu link again, shown on both.
  await call("update_header_item", {
    project: PROJECT,
    header_id: 6,
    item_id: 18,
    button_style: null,
    button_show_on: null,
  });
  assert.deepEqual(lastBody(), { button_style: null, button_show_on: null });

  await call("update_header_item", { project: PROJECT, header_id: 6, item_id: 18, order: 2 });
  assert.deepEqual(lastBody(), { order: 2 });
});

test("add_header_item / update_header_item: the button fields take their listed values or null", () => {
  // The handlers are called directly above; the schemas must let these through too.
  for (const tool of ["add_header_item", "update_header_item"]) {
    const { button_style, button_show_on } = definitions.get(tool).inputSchema;
    for (const value of ["filled", "green", "outline", "icon", null, undefined]) {
      assert.ok(button_style.safeParse(value).success, `${tool} button_style ${value}`);
    }
    for (const value of ["both", "mobile", "desktop", null, undefined]) {
      assert.ok(button_show_on.safeParse(value).success, `${tool} button_show_on ${value}`);
    }
    assert.ok(!button_style.safeParse("primary").success, tool);
    assert.ok(!button_style.safeParse("").success, tool);
    assert.ok(!button_show_on.safeParse("tablet").success, tool);
  }
});

// --- the mega header design: a photo, how an item shows, and its texts -------

test("add_header_item: the mega fields go beside the item, the mega texts in its translation", async () => {
  const r = await call("add_header_item", {
    project: PROJECT,
    header_id: 6,
    language_id: 22,
    label: "Hair Transplant",
    url: "hair-transplant",
    item_type: "custom_button",
    parent_id: 17,
    image_media_id: 52,
    mega_display: "feature",
    description: "FUE and DHI with a lifetime guarantee",
    cta_label: "See prices →",
  });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/headers/6/items"));
  const body = lastBody();
  assert.equal(body.image_media_id, 52);
  assert.equal(body.mega_display, "feature");
  assert.deepEqual(body.translations, [
    {
      language_id: 22,
      label: "Hair Transplant",
      url: "hair-transplant",
      description: "FUE and DHI with a lifetime guarantee",
      cta_label: "See prices →",
    },
  ]);

  // None given: no keys at all, so the item is created as before.
  await call("add_header_item", {
    project: PROJECT,
    header_id: 6,
    language_id: 22,
    label: "About",
    url: "about",
    item_type: "custom_button",
  });
  const plain = lastBody();
  for (const key of ["image_media_id", "mega_display"]) assert.ok(!(key in plain), key);
  assert.deepEqual(plain.translations, [{ language_id: 22, label: "About", url: "about" }]);
});

test("update_header_item: image_media_id and mega_display sent when given, null clears them, leaving them out keeps them", async () => {
  const r = await call("update_header_item", {
    project: PROJECT,
    header_id: 6,
    item_id: 18,
    image_media_id: 52,
    mega_display: "tile",
  });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/headers/6/items/18"));
  assert.deepEqual(lastBody(), { image_media_id: 52, mega_display: "tile" });

  // null: no photo, and automatic display again.
  await call("update_header_item", {
    project: PROJECT,
    header_id: 6,
    item_id: 18,
    image_media_id: null,
    mega_display: null,
  });
  assert.deepEqual(lastBody(), { image_media_id: null, mega_display: null });

  await call("update_header_item", { project: PROJECT, header_id: 6, item_id: 18, order: 2 });
  assert.deepEqual(lastBody(), { order: 2 });
});

test("add_header_item / update_header_item: mega_display takes exactly the vocabulary's values or null", () => {
  const values = VOCABULARIES.header_mega_display.values.map((v) => v.value);
  assert.deepEqual(values, ["column", "promo", "feature", "tile", "link"]);
  for (const tool of ["add_header_item", "update_header_item"]) {
    const { mega_display, image_media_id } = definitions.get(tool).inputSchema;
    for (const value of [...values, null, undefined]) {
      assert.ok(mega_display.safeParse(value).success, `${tool} mega_display ${value}`);
    }
    assert.ok(!mega_display.safeParse("grid").success, tool);
    assert.ok(!mega_display.safeParse("").success, tool);
    assert.ok(image_media_id.safeParse(null).success, tool);
    assert.ok(!image_media_id.safeParse(1.5).success, tool);
  }
  // The button styles the tools take are the vocabulary's, icon among them.
  const styles = VOCABULARIES.header_button_style.values.map((v) => v.value);
  assert.ok(styles.includes("icon"));
  for (const tool of ["add_header_item", "update_header_item"]) {
    const { button_style } = definitions.get(tool).inputSchema;
    for (const value of styles) assert.ok(button_style.safeParse(value).success, `${tool} ${value}`);
  }
});

test("add_header_item: the mega texts keep to the backend's lengths", () => {
  const { description, highlight, cta_label } = definitions.get("add_header_item").inputSchema;
  assert.ok(description.safeParse("x".repeat(500)).success);
  assert.ok(!description.safeParse("x".repeat(501)).success);
  assert.ok(highlight.safeParse("from $1,990").success);
  assert.ok(!highlight.safeParse("x".repeat(101)).success);
  assert.ok(!cta_label.safeParse("x".repeat(101)).success);
});

test("add_header_item_translation: POSTs the label, link and mega texts for one language", async () => {
  const r = await call("add_header_item_translation", {
    project: PROJECT,
    header_id: 6,
    item_id: 18,
    language_id: 45,
    label: "Offer",
    url: "offer",
    description: "Everything included",
    highlight: "from $1,990",
    cta_label: "Book now",
  });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/headers/6/items/18/translations"));
  assert.deepEqual(lastBody(), {
    language_id: 45,
    label: "Offer",
    url: "offer",
    description: "Everything included",
    highlight: "from $1,990",
    cta_label: "Book now",
  });

  await call("add_header_item_translation", {
    project: PROJECT,
    header_id: 6,
    item_id: 18,
    language_id: 45,
    label: "About",
  });
  assert.deepEqual(lastBody(), { language_id: 45, label: "About" });
});

test("update_header_item_translation: only what is given is sent; null or '' clears a mega text", async () => {
  const r = await call("update_header_item_translation", {
    project: PROJECT,
    header_id: 6,
    item_id: 18,
    language_id: 22,
    highlight: "from $1,790",
  });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/headers/6/items/18/translations/22"));
  assert.deepEqual(lastBody(), { highlight: "from $1,790" });

  await call("update_header_item_translation", {
    project: PROJECT,
    header_id: 6,
    item_id: 18,
    language_id: 22,
    description: null,
    cta_label: "",
  });
  assert.deepEqual(lastBody(), { description: null, cta_label: "" });

  await call("update_header_item_translation", {
    project: PROJECT,
    header_id: 6,
    item_id: 18,
    language_id: 22,
    label: "Prices",
  });
  assert.deepEqual(lastBody(), { label: "Prices" });

  const schema = definitions.get("update_header_item_translation").inputSchema;
  for (const key of ["description", "highlight", "cta_label"]) {
    assert.ok(schema[key].safeParse(null).success, key);
    assert.ok(schema[key].safeParse("").success, key);
    assert.ok(schema[key].safeParse(undefined).success, key);
  }
  assert.ok(!schema.description.safeParse("x".repeat(501)).success);
  assert.ok(!schema.label.safeParse(null).success);
  assert.ok(!schema.label.safeParse("").success);
});

test("create_page / update_page: header_style takes exactly the vocabulary's designs, mega among them", async () => {
  const values = VOCABULARIES.header_style.values.map((v) => v.value);
  assert.deepEqual(values, ["classic", "transparent", "mega"]);
  for (const tool of ["create_page", "update_page"]) {
    const schema = definitions.get(tool).inputSchema.header_style;
    for (const value of [...values, undefined]) {
      assert.ok(schema.safeParse(value).success, `${tool} ${value}`);
    }
    assert.ok(!schema.safeParse("dark").success, tool);
  }

  const r = await call("update_page", { project: PROJECT, page_id: 5, header_style: "mega" });
  assert.ok(!isError(r));
  assert.ok(lastCall().url.endsWith("/admin/pages/5"));
  assert.equal(lastBody().header_style, "mega");
});

test("get_page: shows a mega header_style as it is", async () => {
  globalThis.fetch = routedFetch({
    "/admin/pages/8": { status: "success", data: { id: 8, translations: [], header_style: "mega" } },
  });
  const out = JSON.parse((await call("get_page", { project: PROJECT, page_id: 8 })).content[0].text);
  assert.equal(out.header_style, "mega");
});

test("get_component: a header's items come back with their mega fields", async () => {
  const item = {
    id: 18,
    image_media_id: 52,
    image_media: { id: 52, relative_path: "menu/dhi.webp", mime_type: "image/webp" },
    image_media_url: "/media/menu/dhi.webp",
    mega_display: "tile",
    translations: [
      {
        language: { id: 22, code: "en" },
        label: "DHI",
        url: "dhi",
        description: "From $1,990",
        highlight: null,
        cta_label: null,
      },
    ],
    children: [],
  };
  globalThis.fetch = routedFetch({
    "/admin/headers/6": { status: "success", data: { id: 6, items: [item] } },
  });
  const out = JSON.parse(
    (await call("get_component", { project: PROJECT, component: "header", component_id: 6 })).content[0].text,
  );
  assert.deepEqual(out.data.items[0], item);
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

test("upload_media: a video needs its cover picture", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  const video = join(dir, "story.mp4");
  writeFileSync(video, Buffer.from([0, 0, 0, 24]));
  const r = await call("upload_media", { project: PROJECT, file_path: video });
  assert.ok(isError(r));
});

test("upload_media: a video goes up with its thumbnail_file, without the WebP switch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  const video = join(dir, "story.mp4");
  const cover = join(dir, "cover.jpg");
  writeFileSync(video, Buffer.from([0, 0, 0, 24]));
  writeFileSync(cover, Buffer.from([0xff, 0xd8, 0xff]));
  const r = await call("upload_media", { project: PROJECT, file_path: video, thumbnail_path: cover });
  assert.ok(!isError(r));
  const body = lastCall().body;
  assert.ok(body instanceof FormData);
  assert.ok(body.get("file"));
  assert.ok(body.get("thumbnail_file"));
  assert.equal(body.get("convert_to_webp"), null);
});

test("set_media_thumbnail: PUTs the picture to /admin/media/{id}/thumbnail", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  const cover = join(dir, "cover.jpg");
  writeFileSync(cover, Buffer.from([0xff, 0xd8, 0xff]));
  const r = await call("set_media_thumbnail", { project: PROJECT, media_id: 3459, file_path: cover });
  assert.ok(!isError(r));
  const c = lastCall();
  assert.equal(c.method, "PUT");
  assert.ok(c.url.endsWith("/admin/media/3459/thumbnail"));
  assert.ok(c.body.get("thumbnail_file"));
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

test("packages: style (1 the original cards, 2 the v8 price table) on create and update", async () => {
  await call("create_package", { project: PROJECT, language_id: 22, title: "VIP", style: 2 });
  assert.ok(lastCall().url.endsWith("/admin/packages"));
  assert.equal(lastBody().style, 2);

  await call("update_package", { project: PROJECT, package_id: 3, style: 1 });
  assert.equal(lastCall().method, "PUT");
  assert.deepEqual(lastBody(), { style: 1 });

  await call("update_package", { project: PROJECT, package_id: 3, price: 2500 });
  assert.ok(!("style" in lastBody()), "a style left out must stay as it is");

  for (const tool of ["create_package", "update_package"]) {
    const schema = definitions.get(tool).inputSchema.style;
    assert.ok(schema.safeParse(2).success, tool);
    assert.ok(!schema.safeParse(3).success, tool);
    assert.ok(!schema.safeParse("2").success, tool);
  }
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

test("create_gallery_item: a style_5 case carries its angle, views, categories and months", async () => {
  const r = await call("create_gallery_item", {
    project: PROJECT,
    before_after_id: 9,
    before_media_id: 1,
    after_media_id: 2,
    angle_id: 3,
    months_after: 12,
    category_ids: [7, 8],
    views: [{ angle_id: 4, before_media_id: 5, after_media_id: 6 }],
  });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/before-afters/9/gallery-items"));
  assert.deepEqual(lastBody(), {
    before_media_id: 1,
    after_media_id: 2,
    angle_id: 3,
    months_after: 12,
    category_ids: [7, 8],
    views: [{ angle_id: 4, before_media_id: 5, after_media_id: 6 }],
  });
});

test("update_gallery_item: null clears, [] replaces, a field left out is not sent", async () => {
  await call("update_gallery_item", {
    project: PROJECT,
    gallery_item_id: 11,
    angle_id: null,
    months_after: null,
    views: [],
  });
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/before-afters/gallery-items/11"));
  const body = lastBody();
  assert.deepEqual(body, { angle_id: null, months_after: null, views: [] });
  assert.ok(!("category_ids" in body), "an omitted list must stay unchanged, not be cleared");
});

test("create_before_after: inline cases keep the style_5 fields; style_5 is accepted", async () => {
  const r = await call("create_before_after", {
    project: PROJECT,
    style: "style_5",
    gallery_items: [{ before_media_id: 1, angle_id: 3, category_ids: [7], months_after: 6 }],
  });
  assert.ok(!isError(r));
  assert.deepEqual(lastBody().gallery_items[0], {
    before_media_id: 1,
    angle_id: 3,
    category_ids: [7],
    months_after: 6,
  });
  const schema = definitions.get("create_before_after").inputSchema.gallery_items;
  const parsed = schema.parse([{ angle_id: 3, views: [{ angle_id: 4, after_media_id: 2 }], junk: 1 }]);
  assert.deepEqual(parsed, [{ angle_id: 3, views: [{ angle_id: 4, after_media_id: 2 }] }]);
  assert.ok(!schema.safeParse([{ months_after: 601 }]).success);
});

test("before/after angles and categories: list / create / update / delete", async () => {
  for (const [collection, entity] of [["angles", "angle"], ["categories", "category"]]) {
    await call(`list_before_after_${collection}`, { project: PROJECT });
    assert.equal(lastCall().method, "GET");
    assert.ok(lastCall().url.endsWith(`/admin/before-afters/${collection}`), lastCall().url);

    const translations = [{ language_code: "en", name: "Front" }, { language_id: 45, name: "Ön" }];
    const created = await call(`create_before_after_${entity}`, { project: PROJECT, sort_order: 1, translations });
    assert.ok(!isError(created));
    assert.equal(lastCall().method, "POST");
    assert.ok(lastCall().url.endsWith(`/admin/before-afters/${collection}`));
    assert.deepEqual(lastBody(), { sort_order: 1, translations });
    assert.equal(JSON.parse(created.content[0].text).id, 123);

    await call(`update_before_after_${entity}`, {
      project: PROJECT,
      [`${entity}_id`]: 4,
      translations: [{ language_code: "ar", name: "" }],
    });
    assert.equal(lastCall().method, "PUT");
    assert.ok(lastCall().url.endsWith(`/admin/before-afters/${collection}/4`));
    assert.deepEqual(lastBody(), { translations: [{ language_code: "ar", name: "" }] });

    await call(`delete_before_after_${entity}`, { project: PROJECT, [`${entity}_id`]: 4 });
    assert.equal(lastCall().method, "DELETE");
    assert.ok(lastCall().url.endsWith(`/admin/before-afters/${collection}/4?force=false`), lastCall().url);
    await call(`delete_before_after_${entity}`, { project: PROJECT, [`${entity}_id`]: 4, force: true });
    assert.ok(lastCall().url.endsWith(`/admin/before-afters/${collection}/4?force=true`));
    assert.equal(definitions.get(`delete_before_after_${entity}`).annotations.destructiveHint, true);

    // A new name needs text; an update may send "" to remove one language's.
    const createNames = definitions.get(`create_before_after_${entity}`).inputSchema.translations;
    assert.ok(!createNames.safeParse([{ language_code: "en", name: "" }]).success);
    assert.ok(!createNames.safeParse([]).success);
  }
});

test("delete_before_after_angle: a 409 in-use refusal reaches the agent", async () => {
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method });
    return new Response(
      JSON.stringify({ detail: "3 case(s) have photos at this angle. Send force=true to delete it anyway." }),
      { status: 409, headers: { "content-type": "application/json" } },
    );
  };
  const r = await call("delete_before_after_angle", { project: PROJECT, angle_id: 4 });
  assert.ok(isError(r));
  assert.match(r.content[0].text, /409.*force=true/);
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

  const r = await call("save_contact_form_options", {
    project: FOOTER_PROJECT,
    contact_form_id: 3,
    language_code: "ar",
    options: [
      { name: "زراعة الشعر", code: "hair-transplant", sort_order: 0 },
      { name: "طب الأسنان", code: "dental", sort_order: 1 },
    ],
  });
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

// --- header items: the mega texts ride along in the translation sweep ---------

function headerFetch() {
  return routedFetch({
    "/admin/languages": EN_AR_LANGUAGES,
    "/admin/headers/6": {
      status: "success",
      data: {
        id: 6,
        items: [
          {
            id: 18,
            mega_display: "promo",
            translations: [
              {
                language: { id: 22, code: "en" },
                label: "Summer offer",
                url: "offer",
                description: "Flights and hotel included",
                highlight: "from $1,990",
                cta_label: null,
              },
            ],
            children: [],
          },
        ],
      },
    },
    "/admin/headers": { status: "success", data: { headers: [{ id: 6 }], total: 1 } },
  });
}

test("translation_worklist: a header item hands over its mega texts to translate", async () => {
  globalThis.fetch = headerFetch();
  setSession(FOOTER_PROJECT, "test-token", 60, { id: 1, email: "t@t.com", full_name: "Test", role: "admin" });
  const r = await call("translation_worklist", {
    project: FOOTER_PROJECT,
    target_language_code: "ar",
    source_language_code: "en",
    types: ["header_item"],
    limit: 25,
  });
  assert.ok(!isError(r), r.content?.[0]?.text);
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].parent_id, 6);
  // An empty cta_label is not handed over; the url is handled, not translated.
  assert.deepEqual(out.items[0].fields, {
    label: "Summer offer",
    description: "Flights and hotel included",
    highlight: "from $1,990",
  });
});

test("save_translations: a header item's mega texts are written with its label", async () => {
  globalThis.fetch = headerFetch();
  setSession(FOOTER_PROJECT, "test-token", 60, { id: 1, email: "t@t.com", full_name: "Test", role: "admin" });
  const r = await call("save_translations", {
    project: FOOTER_PROJECT,
    language_code: "ar",
    source_language_code: "en",
    localize_urls: false,
    items: [
      {
        type: "header_item",
        id: 18,
        parent_id: 6,
        fields: { label: "عرض الصيف", description: "الطيران والفندق مشمولان", highlight: "من 1990$" },
      },
    ],
  });
  assert.ok(!isError(r), r.content?.[0]?.text);
  const write = calls.find((c) => c.method === "POST");
  assert.ok(write.url.endsWith("/admin/headers/6/items/18/translations"), write.url);
  assert.deepEqual(JSON.parse(write.body), {
    label: "عرض الصيف",
    url: "offer",
    description: "الطيران والفندق مشمولان",
    highlight: "من 1990$",
    language_id: 45,
  });
});

// --- before/after angles: their names ride along in the translation sweep -----

function angleFetch() {
  return routedFetch({
    "/admin/languages": EN_AR_LANGUAGES,
    // The list is the bare row array, no pagination.
    "/admin/before-afters/angles": {
      status: "success",
      data: [
        {
          id: 4,
          sort_order: 0,
          name: "Front",
          usage_count: 2,
          translations: [
            { language_id: 22, language_code: "en", name: "Front" },
            { language_id: 46, language_code: "tr", name: "Ön" },
          ],
        },
      ],
    },
  });
}

test("translation_worklist: a before/after angle hands over its name", async () => {
  globalThis.fetch = angleFetch();
  setSession(FOOTER_PROJECT, "test-token", 60, { id: 1, email: "t@t.com", full_name: "Test", role: "admin" });
  const r = await call("translation_worklist", {
    project: FOOTER_PROJECT,
    target_language_code: "ar",
    source_language_code: "en",
    types: ["before_after_angle"],
    limit: 25,
  });
  assert.ok(!isError(r), r.content?.[0]?.text);
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].id, 4);
  assert.deepEqual(out.items[0].fields, { name: "Front" });
});

test("save_translations: a before/after angle's name is PUT with the other languages kept", async () => {
  globalThis.fetch = angleFetch();
  setSession(FOOTER_PROJECT, "test-token", 60, { id: 1, email: "t@t.com", full_name: "Test", role: "admin" });
  const r = await call("save_translations", {
    project: FOOTER_PROJECT,
    language_code: "ar",
    source_language_code: "en",
    localize_urls: false,
    items: [{ type: "before_after_angle", id: 4, fields: { name: "أمامي" } }],
  });
  assert.ok(!isError(r), r.content?.[0]?.text);
  const write = calls.find((c) => c.method === "PUT");
  assert.ok(write.url.endsWith("/admin/before-afters/angles/4"), write.url);
  assert.deepEqual(JSON.parse(write.body), {
    translations: [
      { language_code: "en", name: "Front" },
      { language_code: "tr", name: "Ön" },
      { language_code: "ar", name: "أمامي" },
    ],
  });
});

// --- processes: the v8 journey (style 2), its eyebrow and the steps' photos ---

test("create_process: style, eyebrow and flat inline steps with their photos go as given", async () => {
  const r = await call("create_process", {
    project: PROJECT,
    language_id: 22,
    title: "Your journey in Istanbul",
    eyebrow: "YOUR JOURNEY",
    button_text: "Free consultation",
    button_url: "consultation",
    style: 2,
    steps: [
      { step_number: 1, title: "Consultation", description: "Online, free", image_id: 61 },
      { step_number: 2, sort_order: 1, title: "Arrival", icon: "solar:airplane-outline" },
    ],
  });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/processes"));
  const body = lastBody();
  assert.equal(body.style, 2);
  assert.equal(body.eyebrow, "YOUR JOURNEY");
  assert.deepEqual(body.steps, [
    { step_number: 1, title: "Consultation", description: "Online, free", image_id: 61 },
    { step_number: 2, sort_order: 1, title: "Arrival", icon: "solar:airplane-outline" },
  ]);

  // Neither given: no keys, so the backend's defaults (style 1, no eyebrow) apply.
  await call("create_process", { project: PROJECT, language_id: 22, title: "Recovery" });
  assert.ok(!("style" in lastBody()));
  assert.ok(!("eyebrow" in lastBody()));
});

test("create_process: the schema takes style 1 or 2 and steps with their own title", () => {
  const { style, steps, eyebrow } = definitions.get("create_process").inputSchema;
  assert.ok(style.safeParse(1).success);
  assert.ok(style.safeParse(2).success);
  assert.ok(!style.safeParse(3).success);
  assert.ok(!style.safeParse("2").success);
  assert.ok(!eyebrow.safeParse("x".repeat(101)).success);
  assert.ok(steps.safeParse([{ step_number: 1, title: "Consultation", image_id: 5 }]).success);
  // The API reads a step's text flat; a nested translation left the step blank.
  assert.ok(!steps.safeParse([{ step_number: 1, translation: { title: "Consultation" } }]).success);
  assert.ok(!steps.safeParse([{ step_number: 0, title: "x" }]).success);
});

test("update_process: style sent when given, left out keeps it", async () => {
  const r = await call("update_process", { project: PROJECT, process_id: 4, style: 2 });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/processes/4"));
  assert.deepEqual(lastBody(), { style: 2 });

  await call("update_process", { project: PROJECT, process_id: 4, sort_order: 3 });
  assert.deepEqual(lastBody(), { sort_order: 3 });

  const style = definitions.get("update_process").inputSchema.style;
  assert.ok(style.safeParse(undefined).success);
  assert.ok(!style.safeParse(3).success);
});

test("update_process_translation: eyebrow set when given, null or '' clears it, left out keeps it", async () => {
  const r = await call("update_process_translation", {
    project: PROJECT,
    process_id: 4,
    language_id: 22,
    eyebrow: "YOUR JOURNEY",
  });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/processes/4/translations/22"));
  assert.deepEqual(lastBody(), { eyebrow: "YOUR JOURNEY" });

  await call("update_process_translation", { project: PROJECT, process_id: 4, language_id: 22, eyebrow: null });
  assert.deepEqual(lastBody(), { eyebrow: null });
  await call("update_process_translation", { project: PROJECT, process_id: 4, language_id: 22, eyebrow: "" });
  assert.deepEqual(lastBody(), { eyebrow: "" });
  await call("update_process_translation", { project: PROJECT, process_id: 4, language_id: 22, title: "Journey" });
  assert.deepEqual(lastBody(), { title: "Journey" });

  const eyebrow = definitions.get("update_process_translation").inputSchema.eyebrow;
  assert.ok(eyebrow.safeParse(null).success);
  assert.ok(!eyebrow.safeParse("x".repeat(101)).success);
});

test("create_process_step / update_process_step: the photo sent when given, null removes it, left out keeps it", async () => {
  let r = await call("create_process_step", { project: PROJECT, process_id: 4, step_number: 3, image_id: 61 });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "POST");
  assert.ok(lastCall().url.endsWith("/admin/processes/4/steps"));
  assert.deepEqual(lastBody(), { step_number: 3, image_id: 61 });

  await call("create_process_step", { project: PROJECT, process_id: 4, step_number: 4 });
  assert.deepEqual(lastBody(), { step_number: 4 });

  r = await call("update_process_step", { project: PROJECT, step_id: 9, image_id: 62 });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/processes/steps/9"));
  assert.deepEqual(lastBody(), { image_id: 62 });

  await call("update_process_step", { project: PROJECT, step_id: 9, image_id: null });
  assert.deepEqual(lastBody(), { image_id: null });

  await call("update_process_step", { project: PROJECT, step_id: 9, sort_order: 2 });
  assert.deepEqual(lastBody(), { sort_order: 2 });

  const image = definitions.get("update_process_step").inputSchema.image_id;
  assert.ok(image.safeParse(null).success);
  assert.ok(!image.safeParse(1.5).success);
});

const PROCESS_V8 = {
  id: 4,
  sort_order: 0,
  style: 2,
  image: null,
  translations: [
    { id: 1, language: { id: 22, code: "en" }, title: "Your journey", eyebrow: "YOUR JOURNEY", button_text: null, button_url: null },
  ],
  steps: [
    {
      id: 9,
      step_number: 1,
      sort_order: 0,
      image_id: 61,
      image: { id: 61, url: "/media/steps/consultation.webp" },
      translations: [{ id: 3, language: { id: 22, code: "en" }, title: "Consultation", description: null, icon: null }],
    },
  ],
};

test("get_component / list_processes: a process shows its style, eyebrow and step photos", async () => {
  globalThis.fetch = routedFetch({
    "/admin/processes/4": { status: "success", data: PROCESS_V8 },
    "/admin/processes": { status: "success", data: { processes: [PROCESS_V8], total: 1 } },
  });
  const full = JSON.parse(
    (await call("get_component", { project: PROJECT, component: "process", component_id: 4 })).content[0].text,
  );
  assert.deepEqual(full.data, PROCESS_V8);

  const list = JSON.parse((await call("list_processes", { project: PROJECT, limit: 50 })).content[0].text);
  assert.equal(list.data.processes[0].style, 2);
});

// --- the patient stories: embed media's own fields and the social block's style -

const EMBED_VIDEO = {
  media_type: "youtube",
  media_url: "https://www.youtube.com/watch?v=abc123XYZ00",
  media_id: "abc123XYZ00",
  poster_id: 71,
  title: "My DHI journey",
  person_name: "James Walker",
  tag: "Long FUE",
  country_code: "gb",
  duration_seconds: 184,
};
const EMBED_INSTAGRAM = {
  media_type: "instagram",
  media_url: "-",
  media_id: "elfsight-app-1",
  poster_id: null,
  title: null,
  person_name: null,
  tag: null,
  country_code: null,
  duration_seconds: null,
};

test("update_global_setting: the embed list goes as given, every item with all its fields", async () => {
  const r = await call("update_global_setting", {
    project: PROJECT,
    setting_id: 1,
    embed_media: [EMBED_VIDEO, EMBED_INSTAGRAM],
  });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/global-settings/1"));
  assert.deepEqual(lastBody(), { embed_media: [EMBED_VIDEO, EMBED_INSTAGRAM] });

  // Left out: the list stays as it is.
  await call("update_global_setting", { project: PROJECT, setting_id: 1, popup_enabled: true });
  assert.deepEqual(lastBody(), { popup_enabled: true });
  // An empty list removes them all.
  await call("update_global_setting", { project: PROJECT, setting_id: 1, embed_media: [] });
  assert.deepEqual(lastBody(), { embed_media: [] });
});

test("update_global_setting: an embed type the site has no branch for is refused before the request", async () => {
  const r = await call("update_global_setting", {
    project: PROJECT,
    setting_id: 1,
    embed_media: [EMBED_VIDEO, { media_type: "vimeo", media_url: "https://vimeo.com/1" }],
  });
  assert.ok(isError(r));
  assert.match(r.content[0].text, /vimeo/);
  assert.equal(calls.length, 0);
});

test("create_global_setting / update_global_setting: the embed schema keeps every field and checks them", () => {
  for (const tool of ["create_global_setting", "update_global_setting"]) {
    const schema = definitions.get(tool).inputSchema.embed_media;
    // A save replaces the whole list, so nothing read back may be dropped on the way out.
    const parsed = schema.safeParse([EMBED_VIDEO, EMBED_INSTAGRAM]);
    assert.ok(parsed.success, tool);
    assert.deepEqual(parsed.data, [EMBED_VIDEO, EMBED_INSTAGRAM], tool);
    assert.match(schema.description, /REPLACES the whole list/, tool);

    const item = (patch) => [{ ...EMBED_VIDEO, ...patch }];
    assert.ok(schema.safeParse(item({ country_code: "DE" })).success, tool);
    assert.ok(!schema.safeParse(item({ country_code: "GBR" })).success, tool);
    assert.ok(!schema.safeParse(item({ country_code: "G1" })).success, tool);
    assert.ok(!schema.safeParse(item({ duration_seconds: 86401 })).success, tool);
    assert.ok(!schema.safeParse(item({ duration_seconds: -1 })).success, tool);
    assert.ok(!schema.safeParse(item({ duration_seconds: 1.5 })).success, tool);
    assert.ok(!schema.safeParse(item({ person_name: "x".repeat(121) })).success, tool);
    assert.ok(!schema.safeParse(item({ title: "x".repeat(256) })).success, tool);
    assert.ok(schema.safeParse(item({ tag: "x".repeat(60) })).success, tool);
    assert.ok(!schema.safeParse(item({ tag: "x".repeat(61) })).success, tool);
    assert.ok(!schema.safeParse([{ media_type: "youtube" }]).success, tool);
  }
});

test("create_global_setting: carries the embed list beside the settings", async () => {
  const r = await call("create_global_setting", {
    project: PROJECT,
    robots_txt_content: "User-agent: *",
    llms_txt_content: "# Brand",
    site_url: "https://example.com",
    language_id: 22,
    address: "Istanbul",
    phone_number: "+90",
    cta_text: "Free consultation",
    cta_url: "consultation",
    embed_media: [EMBED_VIDEO],
  });
  assert.ok(!isError(r));
  assert.deepEqual(lastBody().embed_media, [EMBED_VIDEO]);
});

test("get_component: global settings show each embed's patient story fields", async () => {
  const setting = { id: 1, embed_media: [{ id: 5, ...EMBED_VIDEO, country_code: "GB", poster: { id: 71 } }] };
  globalThis.fetch = routedFetch({ "/admin/global-settings/1": { status: "success", data: setting } });
  const out = JSON.parse(
    (await call("get_component", { project: PROJECT, component: "global_setting", component_id: 1 })).content[0].text,
  );
  assert.deepEqual(out.data, setting);
});

const SOCIAL_V8 = {
  enabled: true,
  order: 7,
  grid_columns: 12,
  style: 2,
  see_all_url: "https://www.youtube.com/@brand/videos",
};

test("update_page: the social media block takes style 2 and see_all_url, sent as given", async () => {
  const r = await call("update_page", { project: PROJECT, page_id: 5, social_media: SOCIAL_V8 });
  assert.ok(!isError(r));
  assert.ok(lastCall().url.endsWith("/admin/pages/5"));
  assert.deepEqual(lastBody().social_media, SOCIAL_V8);
  assert.deepEqual(JSON.parse(r.content[0].text).changed, ["social_media"]);
});

test("update_page: the social media schema keeps every field, so a re-sent block is not reset", () => {
  const schema = definitions.get("update_page").inputSchema.social_media;
  const parsed = schema.safeParse(SOCIAL_V8);
  assert.ok(parsed.success);
  assert.deepEqual(parsed.data, SOCIAL_V8);
  assert.ok(schema.safeParse({ enabled: true, style: 1, see_all_url: null }).success);
  assert.ok(schema.safeParse({ enabled: false }).success);
  assert.ok(!schema.safeParse({ enabled: true, style: 3 }).success);
  assert.ok(!schema.safeParse({ enabled: true, see_all_url: "x".repeat(501) }).success);
  assert.match(schema.description, /REPLACES/);
  // Style 2 is the patient stories now; the video cards (and their country filter) are gone.
  const style = schema.unwrap().shape.style.description;
  assert.match(style, /patient stories/);
  assert.match(style, /See all reviews/);
  assert.doesNotMatch(style, /filter|video cards/);
});

test("embed media: the texts describe the patient stories, not the video cards", () => {
  const item = definitions.get("update_global_setting").inputSchema.embed_media.unwrap().element.shape;
  assert.match(item.person_name.description, /full name/);
  assert.match(item.tag.description, /Long FUE/);
  assert.match(item.country_code.description, /chip/);
  assert.match(item.duration_seconds.description, /not shown/);
  assert.match(item.poster_id.description, /portrait/);
  for (const field of Object.values(item)) {
    assert.doesNotMatch(field.description ?? "", /video cards|filter/);
  }
});

test("get_page: shows the social media block as stored, style and see_all_url included", async () => {
  globalThis.fetch = routedFetch({
    "/admin/pages/8": { status: "success", data: { id: 8, translations: [], social_media: SOCIAL_V8 } },
  });
  const out = JSON.parse((await call("get_page", { project: PROJECT, page_id: 8 })).content[0].text);
  assert.deepEqual(out.feature_blocks.social_media, SOCIAL_V8);
});

test("create_card / update_card: the v8 seo_text card and its eyebrow", async () => {
  const created = await call("create_card", {
    project: PROJECT,
    language_id: 1,
    type: "seo_text",
    eyebrow: "Natural results",
    title: "Natural hairline design with DHI",
    description: "<p>Every natural hairline is drawn for your face.</p>",
    text_position: "left",
  });
  assert.ok(!isError(created));
  assert.equal(lastBody().type, "seo_text");
  assert.equal(lastBody().eyebrow, "Natural results");
  const updated = await call("update_card", {
    project: PROJECT,
    card_id: 7,
    translation_update: { language_id: 2, eyebrow: "Natürliche Ergebnisse" },
  });
  assert.ok(!isError(updated));
  assert.equal(lastBody().translation_update.eyebrow, "Natürliche Ergebnisse");
});

test("update_page: the graft calculator takes its design (2 = the v8 wizard) and goes out camelCased", async () => {
  const graft_calculator = { enabled: true, order: 1, grid_columns: 12, style: 2 };
  const r = await call("update_page", { project: PROJECT, page_id: 108, graft_calculator });
  assert.ok(!isError(r));
  assert.deepEqual(lastBody().graftCalculator, graft_calculator);
  assert.equal(lastBody().graft_calculator, undefined);
  const schema = definitions.get("update_page").inputSchema.graft_calculator;
  assert.ok(schema.safeParse({ enabled: true, style: 1 }).success);
  assert.ok(!schema.safeParse({ enabled: true, style: 3 }).success);
});

test("create_page / update_page: a video page (layout 3) with its library group, and the video library", async () => {
  for (const tool of ["create_page", "update_page"]) {
    const schema = definitions.get(tool).inputSchema;
    assert.ok(schema.layout_style.safeParse(3).success, tool);
    assert.ok(!schema.layout_style.safeParse(4).success, tool);
    assert.ok(schema.video.safeParse({ group: "recovery", month: 0, day: 10 }).success, tool);
    assert.ok(schema.video.safeParse(null).success, tool);
    assert.ok(!schema.video.safeParse({ group: "series" }).success, tool);
    assert.ok(!schema.video.safeParse({ group: "recovery", month: 61 }).success, tool);
  }
  const childPages = definitions.get("update_page").inputSchema.child_pages;
  assert.ok(childPages.safeParse({ show_child_pages: true, style: "videos" }).success);
  assert.ok(!childPages.safeParse({ show_child_pages: true, style: "grid" }).success);

  const r = await call("update_page", {
    project: PROJECT,
    page_id: 7,
    layout_style: 3,
    video: { group: "recovery", month: 12 },
    child_pages: { show_child_pages: true, order: 1, style: "videos" },
  });
  assert.ok(!isError(r));
  assert.deepEqual(lastBody().video, { group: "recovery", month: 12 });
  assert.equal(lastBody().layout_style, 3);
  assert.equal(lastBody().child_pages.style, "videos");
  assert.deepEqual(VOCABULARIES.video_group.values.map((v) => v.value), ["recovery", "doctor", "clips", "patients"]);
});

test("get_page: shows a video page's library group", async () => {
  globalThis.fetch = routedFetch({
    "/admin/pages/9": {
      status: "success",
      data: { id: 9, translations: [], layout_style: 3, video: { group: "doctor" } },
    },
  });
  const out = JSON.parse((await call("get_page", { project: PROJECT, page_id: 9 })).content[0].text);
  assert.equal(out.layout_style, 3);
  assert.deepEqual(out.video, { group: "doctor" });
});

test("create_page / update_page / get_page: each section's colour", async () => {
  for (const tool of ["create_page", "update_page"]) {
    const schema = definitions.get(tool).inputSchema;
    assert.ok(schema.section_tones.safeParse({ "heroes:6": "dark", reviews: "light" }).success, tool);
    assert.ok(schema.section_tones.safeParse(null).success, tool);
    assert.ok(!schema.section_tones.safeParse("alternate").success, tool);
    assert.ok(!schema.section_tones.safeParse({ "heroes:6": "pink" }).success, tool);
    assert.ok(!schema.section_tones.safeParse({ heroes: "dark" }).success, tool);
    assert.ok(!schema.section_tones.safeParse({ "reviews:3": "dark" }).success, tool);
  }
  const r = await call("update_page", { project: PROJECT, page_id: 7, section_tones: { "cards:1205": "dark" } });
  assert.ok(!isError(r));
  assert.deepEqual(lastBody().section_tones, { "cards:1205": "dark" });

  globalThis.fetch = routedFetch({
    "/admin/pages/38": { status: "success", data: { id: 38, translations: [], section_tones: { "heroes:6": "dark" } } },
  });
  const out = JSON.parse((await call("get_page", { project: PROJECT, page_id: 38 })).content[0].text);
  assert.deepEqual(out.section_tones, { "heroes:6": "dark" });
});

test("set_section_colours: changes only the named sections", async () => {
  globalThis.fetch = routedFetch({
    "/admin/pages/38": { status: "success", data: { id: 38, section_tones: { "heroes:6": "dark", reviews: "light" } } },
  });
  const r = await call("set_section_colours", {
    project: PROJECT,
    page_id: 38,
    colours: { reviews: null, "cards:1232": "light" },
  });
  assert.ok(!isError(r));
  assert.deepEqual(lastBody().section_tones, { "heroes:6": "dark", "cards:1232": "light" });
  const bad = definitions.get("set_section_colours").inputSchema.colours.safeParse({ hero: "dark" });
  assert.ok(!bad.success);
});

test("set_media_duration: PUTs the video's length", async () => {
  globalThis.fetch = routedFetch({
    "/admin/media/41": { status: "success", data: { id: 41, media_type: "youtube.video", url: "a9a6ChWh4CQ", duration_seconds: 260 } },
  });
  const r = await call("set_media_duration", { project: PROJECT, media_id: 41, duration_seconds: 260 });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "PUT");
  assert.deepEqual(lastBody(), { duration_seconds: 260 });
  assert.equal(JSON.parse(r.content[0].text).duration_seconds, 260);
});


test("create_campaign: a Black Friday campaign with its colours, switches and texts", async () => {
  const r = await call("create_campaign", {
    project: PROJECT,
    name: "Black Friday 2026",
    theme: "black_friday",
    is_active: true,
    ends_at: "2026-11-30T23:59:00+03:00",
    accent_color: "#f5c542",
    show_popup: false,
    show_side_card: true,
    media_swaps: [{ from_media_id: 3712, to_media_id: 4001 }],
    translations: [
      { language_id: 22, badge_text: "BLACK FRIDAY", discount_text: "-30%", side_text: "Up to 30% off", button_url: "cta_url" },
    ],
  });
  assert.ok(!isError(r));
  const c = lastCall();
  assert.equal(c.method, "POST");
  assert.ok(c.url.endsWith("/admin/campaigns"), c.url);
  const body = lastBody();
  assert.equal(body.is_active, true);
  assert.equal(body.theme, "black_friday");
  assert.equal(body.show_popup, false);
  assert.equal(body.translations[0].discount_text, "-30%");
  assert.equal(body.translations[0].side_text, "Up to 30% off");
  assert.equal(body.show_side_card, true);
  assert.deepEqual(body.media_swaps, [{ from_media_id: 3712, to_media_id: 4001 }]);
  assert.equal(JSON.parse(r.content[0].text).id, 123);
});

test("update_campaign: picture swaps are checked before any request; [] clears them", async () => {
  const schema = definitions.get("update_campaign").inputSchema;
  assert.ok(!schema.media_swaps.safeParse([{ from_media_id: 5, to_media_id: 5 }]).success);
  assert.ok(
    !schema.media_swaps.safeParse([
      { from_media_id: 5, to_media_id: 6 },
      { from_media_id: 5, to_media_id: 7 },
    ]).success,
  );
  assert.ok(!schema.media_swaps.safeParse([{ from_media_id: 5 }]).success);
  assert.ok(!("show_bar" in schema));
  const r = await call("update_campaign", { project: PROJECT, campaign_id: 3, media_swaps: [] });
  assert.ok(!isError(r));
  assert.deepEqual(lastBody(), { media_swaps: [] });
});

test("create_campaign / update_campaign: an unknown theme or a bad colour is refused before any request", async () => {
  const bad = await call("create_campaign", { project: PROJECT, name: "X", theme: "blackfriday" });
  assert.ok(isError(bad));
  assert.match(bad.content[0].text, /campaign/);
  assert.equal(calls.length, 0);
  const schema = definitions.get("update_campaign").inputSchema;
  assert.ok(!schema.accent_color.safeParse("gold").success);
  assert.ok(schema.accent_color.safeParse("#ABCDEF").success);
  assert.ok(schema.accent_color.safeParse(null).success);
  const badUpdate = await call("update_campaign", { project: PROJECT, campaign_id: 3, theme: "xmas" });
  assert.ok(isError(badUpdate));
  assert.equal(calls.length, 0);
  assert.deepEqual(VOCABULARIES.campaign_theme.values.map((v) => v.value), ["black_friday", "custom"]);
});

test("update_campaign: switches it on with a PUT of only what changes", async () => {
  const r = await call("update_campaign", { project: PROJECT, campaign_id: 3, is_active: true });
  assert.ok(!isError(r));
  assert.equal(lastCall().method, "PUT");
  assert.ok(lastCall().url.endsWith("/admin/campaigns/3"), lastCall().url);
  assert.deepEqual(lastBody(), { is_active: true });
});

test("get_campaign / list_campaigns / delete_campaign", async () => {
  await call("get_campaign", { project: PROJECT, campaign_id: 4 });
  assert.equal(lastCall().method ?? "GET", "GET");
  assert.ok(lastCall().url.includes("/admin/campaigns/4"), lastCall().url);
  await call("list_campaigns", { project: PROJECT, limit: 50 });
  assert.ok(lastCall().url.includes("/admin/campaigns"), lastCall().url);
  await call("delete_campaign", { project: PROJECT, campaign_id: 4 });
  assert.equal(lastCall().method, "DELETE");
  assert.ok(lastCall().url.endsWith("/admin/campaigns/4"), lastCall().url);
});

test("price compare: the world map design and each row's place on the map", async () => {
  let r = await call("update_price_compare", { project: PROJECT, price_compare_id: 1, style: 2 });
  assert.ok(!isError(r));
  assert.equal(lastBody().style, 2);
  assert.ok(!definitions.get("update_price_compare").inputSchema.style.safeParse(3).success);
  r = await call("update_price_compare_country", { project: PROJECT, country_id: 4, country_code: "gb" });
  assert.ok(!isError(r));
  assert.equal(lastBody().country_code, "GB");
  const code = definitions.get("create_price_compare_country").inputSchema.country_code;
  assert.ok(code.safeParse("EU").success);
  assert.ok(code.safeParse("").success);
  assert.ok(!code.safeParse("USA").success);
});

test("price compare: a country's text under the map, per language", async () => {
  let r = await call("create_price_compare_country", {
    project: PROJECT, price_compare_id: 1, language_id: 22, country_name: "Canada", description: "Why Canadians fly to Istanbul.",
  });
  assert.ok(!isError(r));
  assert.equal(lastBody().description, "Why Canadians fly to Istanbul.");
  r = await call("update_price_compare_country", { project: PROJECT, country_id: 1, language_id: 22, description: "" });
  assert.ok(!isError(r));
  assert.deepEqual(lastBody().translation_update, { language_id: 22, description: "" });
});

test("create_contact_form / update_contact_form: the form's design (style 1 or 2)", async () => {
  for (const tool of ["create_contact_form", "update_contact_form"]) {
    const schema = definitions.get(tool).inputSchema;
    assert.ok(schema.style.safeParse(2).success, tool);
    assert.ok(schema.style.safeParse(1).success, tool);
    assert.ok(!schema.style.safeParse(3).success, tool);
  }
  const r = await call("update_contact_form", { project: PROJECT, contact_form_id: 3, style: 2 });
  assert.ok(!isError(r));
  assert.equal(lastBody().style, 2);
});

test("create_contact_form / update_contact_form: field_settings per field (WEB #43)", async () => {
  for (const tool of ["create_contact_form", "update_contact_form"]) {
    const schema = definitions.get(tool).inputSchema;
    assert.ok(schema.field_settings.safeParse({ language: "hidden", service: "hidden" }).success, tool);
    assert.ok(schema.field_settings.safeParse(null).success, tool);
    assert.ok(!schema.field_settings.safeParse({ email: "hidden", phone_number: "hidden" }).success, tool);
    assert.ok(!schema.field_settings.safeParse({ language: "maybe" }).success, tool);
    assert.ok(!schema.field_settings.safeParse({ address: "hidden" }).success, tool);
  }
  const r = await call("update_contact_form", {
    project: PROJECT,
    contact_form_id: 3,
    field_settings: { language: "hidden", service: "hidden" },
  });
  assert.ok(!isError(r));
  assert.deepEqual(lastBody().field_settings, { language: "hidden", service: "hidden" });
});


test("relink_redirected_links: POST /admin/redirects/relink, a dry run by default", async () => {
  // NB: the stub server bypasses zod, so pass the defaults explicitly.
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method, body: opts.body });
    return new Response(JSON.stringify({ status: "accepted", job_id: 41 }), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  };
  const r = await call("relink_redirected_links", {
    project: PROJECT,
    dry_run: true,
    include_home_targets: false,
    wait_seconds: 0,
  });
  assert.ok(!isError(r));
  assert.equal(calls[0].method, "POST");
  assert.ok(calls[0].url.endsWith("/admin/redirects/relink"), calls[0].url);
  assert.deepEqual(JSON.parse(calls[0].body), { dry_run: true, include_home_targets: false });
  assert.match(r.content[0].text, /"job_id": 41/);
});

test("get_relink_job: GET /admin/redirects/relink/{id} and the top old addresses", async () => {
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method });
    return new Response(
      JSON.stringify({
        status: "success",
        data: {
          id: 41,
          status: "completed",
          summary: { dry_run: true, rewritten_occurrences: 3, by_url: { "/es/old": 3 }, new_url: { "/es/old": "/es/new" } },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const r = await call("get_relink_job", { project: PROJECT, job_id: 41 });
  assert.ok(lastCall().url.endsWith("/admin/redirects/relink/41"));
  const out = JSON.parse(r.content[0].text);
  assert.deepEqual(out.top_old_addresses, [{ old: "/es/old", new: "/es/new", links: 3 }]);
  assert.equal(out.links_rewritten, 3);
});

test("bulk_replace_content: POST /admin/content/bulk-replace with rules, a dry run by default", async () => {
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method, body: opts.body });
    return new Response(JSON.stringify({ status: "accepted", job_id: 7 }), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  };
  await call("bulk_replace_content", {
    project: PROJECT,
    rules: [{ find: 'href="/es/a/"', replace: 'href="/es/b/"' }],
    entities: ["post", "card"],
    dry_run: true,
    max_matches: 100,
    wait_seconds: 0,
  });
  assert.ok(calls[0].url.endsWith("/admin/content/bulk-replace"));
  const body = JSON.parse(calls[0].body);
  assert.equal(body.dry_run, true);
  assert.deepEqual(body.entities, ["post", "card"]);
  assert.deepEqual(body.rules, [{ find: 'href="/es/a/"', replace: 'href="/es/b/"', case_sensitive: false }]);
});

test("bulk_search_content: POST /admin/content/bulk-search with one rule per term", async () => {
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method, body: opts.body });
    return new Response(JSON.stringify({ status: "accepted", job_id: 8 }), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  };
  await call("bulk_search_content", {
    project: PROJECT,
    terms: ["/es/a/", "Old Name"],
    case_sensitive: false,
    max_matches: 50,
    wait_seconds: 0,
  });
  assert.ok(calls[0].url.endsWith("/admin/content/bulk-search"));
  assert.deepEqual(JSON.parse(calls[0].body).rules, [
    { find: "/es/a/", case_sensitive: false },
    { find: "Old Name", case_sensitive: false },
  ]);
});
