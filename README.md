# Istanbul Care Content MCP

MCP server for the multi-brand content admin behind Istanbul Care and its sibling
clinics. Gives an agent typed access to the blog admin API, the SEO audit, and —
importantly — the only correct way to build an internal URL.

Covers all 11 brands in `src/config/projects.ts`, including IC, AHC
(`albanian-hair-klinik`) and Dental (`ic-dental-group`).

## Status

This iteration ships **auth + the read side**. Write tools (`create_post_draft`,
`update_post`, `add_translation`, `publish_post`, `auto_translate_post`) are next;
the plumbing they need is already in place.

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
| `auto_translate_post` / `_status` / `_rollback` | ✓* | Machine translation |
| `create_post_category` / `add_category_translation` | ✓* | Create/translate a category |
| `create_tag` / `add_tag_translation` | ✓* | Create/translate a tag |
| `list_post_faqs` / `add_post_faq` / `add_faq_translation` / `delete_faq` | ✓* | A post's FAQ block + FAQPage schema |
| `list_seo_schemas` / `set_post_seo_schema` | ✓* | Structured data (JSON-LD) |

`✓` needs login. `✓*` also needs the brand in `ICMCP_WRITE_PROJECTS` (write gate).

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
