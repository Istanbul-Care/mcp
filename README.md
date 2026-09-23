# Istanbul Care Content MCP

MCP server for the multi-brand content admin behind Istanbul Care and its sibling
clinics. Gives an agent typed access to the blog admin API, the SEO audit, and —
importantly — the only correct way to build an internal URL.

Covers the 10 live brands in `src/config/projects.ts`, including IC, AHC
(`albanian-hair-klinik`) and Dental (`ic-dental-group`). A brand belongs here
only while its API is served by the shared backend — Capelli Port was listed
until its project was cancelled, and a dead entry costs an agent a timeout
rather than an error.

## Status

Auth, the read side, authoring, SEO and translation are all in. Writes stay
behind the `ICMCP_WRITE_PROJECTS` gate, so a brand nobody opted in cannot be
touched.

## Install

```bash
npm install
npm run build
```

## Register with Claude Code

```json
{
  "mcpServers": {
    "ic-content": {
      "command": "node",
      "args": ["D:/Repos/icare/mcp/dist/index.js"],
      "env": {
        "ICMCP_EMAIL": "you@istanbul-care.com",
        "ICMCP_PASSWORD": "…"
      }
    }
  }
}
```

Copy `.env.example` for the full list of environment variables.

## Logging in

The backend mails a one-time code on **every** login, for every role
(`ICBackend/app/service/auth.py`) — there is no headless credential flow, so the
server exposes the two steps as tools:

```
login({ project: "istanbul-care" })      → mails a code, returns the challenge id
submit_otp({ project: "istanbul-care", otp_code: "123456" })
```

The resulting JWT is cached at `~/.ic-content-mcp/sessions.json` (0600, in a
0700 directory) so a server restart does not force a fresh code out of the
editor's inbox. It expires on its own. Set `ICMCP_PERSIST_SESSIONS=0` to keep
tokens in memory only, or point `ICMCP_SESSION_FILE` elsewhere. `auth_status`
shows what is live; `logout` drops it.

Each brand is logged into separately — a token for IC does not work against AHC.

## Tools

| Tool | Auth | What it does |
|---|---|---|
| `list_projects` | – | Brands, API hosts, public URLs, default locale |
| `get_link_conventions` | – | Reserved link values, and which fields honour them |
| `get_vocabularies` | – | Every field where only a listed value renders |
| `list_languages` | – | Active languages + the ids translations key off |
| `search_content` | – | Published posts/services/pages by title and slug |
| `resolve_internal_link` | – | A slug/path/URL → its SEO-correct URL in one language |
| `localize_content_links` | – | Rewrites every internal anchor in an HTML block |
| `login` / `submit_otp` / `auth_status` / `logout` | – | Session handling |
| `list_post_categories` | ✓ | Categories with all translations |
| `list_tags` | ✓ | Tags with all translations |
| `list_posts` | ✓ | Posts including drafts and scheduled |
| `get_post` | ✓ | One post in full, all translations |
| `seo_audit_post` | ✓ | The backend's SEO checks, split into blocking vs advisory |
| `create_post_draft` / `update_post_translation` / `add_translation` / `set_post_metadata` | ✓* | Author a post (draft-first) |
| `publish_post` / `unpublish_post` | ✓* | Go live (SEO-gated) / return to draft |
| `auto_translate` / `_status` / `_rollback` | ✓* | Machine-translate one post, service or page |
| `translation_coverage` | ✓ | What is untranslated, across all 32 surfaces |
| `translate_everything` / `_status` | ✓* | Brand-wide sweep, throttled |
| `translation_worklist` / `save_translations` | ✓* | The surfaces no backend endpoint translates |
| `create_post_category` / `add_category_translation` | ✓* | Create/translate a category |
| `create_tag` / `add_tag_translation` | ✓* | Create/translate a tag |
| `list_post_faqs` / `add_post_faq` / `add_faq_translation` / `delete_faq` | ✓* | A post's FAQ block + FAQPage schema |
| `list_seo_schemas` / `set_post_seo_schema` | ✓* | Structured data (JSON-LD) |
| `read_public_page` | – | A published page by slug path, with its real body HTML and full section payloads |
| `list_pages` / `get_page` | ✓ | Pages with translations / one page's structure and SEO fields |
| `create_page` / `update_page` | ✓* | Create a page (optionally with its `content` HTML + `page_content` block in one call) / compose its body |
| `fold_page_cards` | ✓* | Move a page's prose cards into its `page_content` body, byte for byte (previews by default) |
| `set_page_content` | ✓* | Write a page's body HTML for one language + enable/position the `page_content` block |
| `get_card` / `get_page_cards` | ✓ | One card in full / a page's cards in render order, with their text and images |
| `get_component` | ✓ | One hero/slider/package/footer/form in full, with every child id |
| `update_hero` / `update_slider` / `update_process` / `update_price_compare` / `update_promotional_landing` / `update_before_after` | ✓* | Edit a component after it exists |
| `create_hero_feature` / `create_slide` / `create_slide_feature` / `create_process_step` / `create_price_compare_country` / `create_promo_feature` / `create_gallery_item` | ✓* | Add one child row (each with `update_*` and `delete_*`) |
| `create_package_section` / `create_offer` | ✓* | Build a pricing table tier by tier (price and currency are per-language) |
| `list_links` / `create_link` / `update_link` / `delete_link` | ✓* | The reusable CTA buttons other blocks point at |
| `create_header` / `update_header` / `delete_header` | ✓* | The nav shell the menu items hang off |
| `list_footers` / `create_footer` / `create_footer_translation` / `create_footer_section` / `create_footer_item` | ✓* | A footer, then its columns **per language** |
| `update_multi_page_form` / `create_form_page` / `create_form_field` / `create_form_option` | ✓* | The consultation wizard's steps, inputs and choices (steps are per-language) |
| `list_form_submissions` | ✓ | The leads a form has collected |
| `deactivate_*` / `restore_*` / `delete_*` (post, page, service) | ✓* | Reversible takedown, undo, and permanent removal |
| `update_service` / `publish_service` / `unpublish_service` | ✓* | What posts already had, for services |
| `bulk_update_posts` / `bulk_update_pages` / `bulk_update_services` | ✓* | Status and robots flags across a list of ids |

`✓` needs login. `✓*` also needs the brand in `ICMCP_WRITE_PROJECTS` (write gate).

## Turning a page's cards into its rich-text body

Pages used to be composed as a stack of content cards — one card per section,
each holding a heading and a slab of HTML. The `cards_to_page_content` prompt
folds that stack into the page's single `page_content` block, one language at a
time:

```
/ic-content:cards_to_page_content  project=istanbul-care  page_id=249
```

The texts are MOVED, not rewritten: each card's `description` is already HTML
and passes through untouched, its `title` becomes an `<h2>`, and the cards keep
their render order. Widget cards (`whatsapp`, `media_slider`, `vertical_slider`,
`testimonial_gallery`, `word_cloud`) mean nothing outside their own rendering,
so they stay attached. Folded cards are detached from the page after you
confirm — never deleted, since they may be attached elsewhere. Pass
`keep_cards=yes` to write the body and leave the cards in place for comparison.

The assembly is done by `fold_page_cards`, in code rather than by the agent —
retyping thousands of characters of HTML is how wording quietly drifts. It
defaults to `dry_run`, so the first call always previews. The other tools are
usable on their own: `get_page_cards` reads a page's cards in render order with
their full text, `get_card` reads one card, and `set_page_content` writes a
page's body HTML for one language (re-sending the rest of the translation
unchanged) for the cases where you do want to hand-author it.

Once the source language is in, `auto_translate` fills the rest from it —
with `overwrite: true`, since the other languages already have a translation row
and would otherwise keep an empty body.

## Translating a brand into a language

The client-facing entry point is the `translate_brand` prompt — in Claude Code
that is a slash command:

```
/ic-content:translate_brand  project=istanbul-care  language=ar
```

Nothing about it is Arabic-specific; `language=el` next month is the same call.

Underneath it, a brand's content splits in two:

- **Posts, services and pages** have a backend endpoint that runs the
  translation server-side (DeepSeek), re-localises internal links, caps meta at
  SEO sizes and emits ASCII slugs. `translate_everything` queues those.
- **The other 29 surfaces** — taxonomy, FAQs, cards, heroes, sliders, packages,
  price comparisons, processes, promotional landings, before/afters, forms,
  menus, global settings, CTA link buttons, image alt text — have
  translation CRUD and nothing else. No endpoint translates them, so the agent
  holding the session is the translator: `translation_worklist` hands it the
  source strings, `save_translations` writes its rendering back. This is the
  idiomatic MCP split — the server is the hands, the model is the translator.
  (For an unattended, no-agent bulk pass, the right move is a backend
  auto-translate endpoint for these types, like posts/services/pages already
  have — not a second LLM inside the MCP.)

  Two of these don't go through a `/translations` endpoint at all: **CTA links**
  and **before/after-AI steps** carry their languages inside the row, written by
  PUTting the whole set back (`save_translations` re-sends the other languages so
  they aren't dropped). **Image alt text** is the one high-volume surface — the
  media library is far larger than the content, so translating it is best run as
  its own pass (`types: ["media"]`) rather than folded into a content sweep.

- **The footer is a third case.** It is a nested tree — CTA button, sections,
  items — so it is not a `SURFACES` row and `translation_worklist` never returns
  it. It has its own pair, `footer_worklist` / `save_footer`, which clones the
  section/item structure from the source language and applies your text against
  the same `source_section_id` / `source_item_id` keys. `translation_coverage`
  reports it as type `footer` so a sweep that ignores it is visible rather than
  silent: an untranslated footer shows on every page of the site, which makes it
  both the most conspicuous gap and the easiest one to leave behind.

- **The contact form's service dropdown is a fourth case.** Those options are
  not the `service_category` taxonomy — they hang off the contact form, one row
  per form and language, so nothing in `SURFACES` reaches them. Use
  `contact_form_options_worklist` / `save_contact_form_options`, translating only
  `name`: `code` is the value submitted with the lead and is identical in every
  language, so rewriting it breaks lead routing and Zapier mapping.
  `translation_coverage` reports it as type `contact_form_options`, because the
  public API returns an *empty list* rather than an error for a language with no
  rows — the form renders with a dropdown that has nothing in it, and a lead
  arrives with no service category attached.

`save_translations` deliberately does not accept everything. Slugs are derived
from the translated title the way the backend derives them, internal URLs are
re-pointed at the target language through the slug lookup, and non-prose columns
(prices, currencies, icons, image ids, phone numbers, social handles) are copied
off the source row. An agent that "translates" a phone number is a bug, so those
fields are never handed to it.

### Why the sweep is throttled

`POST /auto-translate` hands the work to FastAPI's in-process `BackgroundTasks`.
There is no Celery, no Redis, no queue — and no concurrency cap, with a 180s
DeepSeek timeout per call. A hundred simultaneous jobs would sit on the API
worker for the rest of the afternoon. So `translate_everything` keeps a small
number in flight (default 2) and each `translate_everything_status` poll starts
the next ones. **The sweep does not advance on its own** — stop polling and it
stalls with work still queued. Batch state lives in
`~/.ic-content-mcp/translate-batches.json` (override with `ICMCP_STATE_DIR`) so a
poll still works after the server restarts.

### Keeping the registry honest

`src/lib/translatable.ts` lists every place content carries a per-language row:
how to enumerate it, where to write it, and what each field is (prose, HTML,
slug, URL, or copy-verbatim). That registry is what makes "everywhere" mean
everywhere — and what goes stale the moment the backend grows a column.

```bash
npm run build && npm run check:translatable
```

diffs it against the live API's OpenAPI spec (`../ICFrontend/api.yml` by default;
pass another path as an argument) and fails on drift. Surfaces left out on
purpose are recorded in `UNCOVERED` with the reason, so "not covered" is a
decision rather than an oversight. Today that is one entry: the footer, which
is a nested tree and has its own `footer_worklist` / `save_footer` pair
instead.

## Conventions the server enforces

Some values an editor types are read by the site as instructions rather than
content, and nothing validates them — not the panel, not the API, not the
column. A near miss renders a 404, or a modal that never opens, with no error
anywhere. Two tools carry the rules:

- `get_link_conventions` — the reserved link values: `cta_url`, the
  `modal-dialog-` prefix (whose whole value doubles as the form's `form_code`),
  the rich-text lead anchors, and the WhatsApp hosts that gate a lead form.
  It also names the fields where these do **not** work: the header menu and
  the top footer sections render through a plain link, so the same string that
  opens a modal on a card button 404s in the navigation.
- `get_vocabularies` — every field where only a listed value renders: card and
  hero styles, menu item types, link icons, media types, form field types. The
  write tools reject a value the site cannot use, including two the admin panel
  offers but the site never renders (`coverflow`, `media_slider`).

Parsed text columns are checked too: a word-cloud card's JSON badges, the
pipe-separated focus keyword, ISO-4217 currencies, bare video ids for
`youtube.*` / `tiktok.*` media, and structured data carrying its own
`@context`.

Three structural conventions are documented in `get_writing_guide` because no
validator can catch them:

- **A footer's columns and a form's steps hang off a *translation*, not off the
  footer or the form.** Adding a column in English adds nothing to Italian.
- **A package tier's price and currency are translated fields.** A price set in
  one language is not the price shown in another.
- **A slider with no `style` guesses from its slides** — and in the mixed case
  it collects the timeline half by looking for slide type `image`, so real
  `timeline` slides vanish.

## Why `resolve_internal_link` exists

A blog post's public URL is **not** `/<slug>`. It is the brand's `{blog_slug}`
container template with the slug substituted, and a service's is its full
category chain — both differ per language, and both live in the database. Hand-built
URLs are how dead internal links get shipped.

```
resolve_internal_link({
  project: "istanbul-care",
  href: "https://istanbul-care.com/hair-transplant-turkey-cost-2026/",
  target_language: "de",
})
→ /de/blog/haartransplantation-in-der-turkei-kostet-2026-…/
```

Note what that example fixes: the input has no `/blog/` prefix at all. Such links
exist in production content today, and asking for them in their *own* language
still repairs them, because the resolver falls back to the lookup's `matched_slug`
rather than only handling cross-language cases.

## Verify

```bash
node scripts/smoke.mjs istanbul-care
```

Drives the built server over stdio as a real MCP client and exercises every
no-login tool against the live API.
