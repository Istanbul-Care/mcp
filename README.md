# Istanbul Care Content MCP

MCP server for the multi-brand content admin behind Istanbul Care and its sibling
clinics. Gives an agent typed access to the blog admin API, the SEO audit, and —
importantly — the only correct way to build an internal URL.

Covers all 11 brands in `src/config/projects.ts`, including IC, AHC
(`albanian-hair-klinik`) and Dental (`ic-dental-group`).

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

The resulting JWT is held **in this process's memory only**, never written to
disk, and expires on its own. `auth_status` shows what is live; `logout` drops it.

Each brand is logged into separately — a token for IC does not work against AHC.

## Tools

| Tool | Auth | What it does |
|---|---|---|
| `list_projects` | – | Brands, API hosts, public URLs, default locale |
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

`✓` needs login. `✓*` also needs the brand in `ICMCP_WRITE_PROJECTS` (write gate).

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
  menus, footers, global settings, CTA link buttons, image alt text — have
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
decision rather than an oversight. Today that is one entry: media alt text.

## Not covered (by design, this iteration)

- **Media upload.** `create_post_draft` accepts a `featured_image_id`, but there is no
  tool to upload an image and mint that id — a post needing a *new* image still has to
  get it into the media library another way. Deferred deliberately.

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
