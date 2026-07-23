import type { ProjectId } from "../config/projects.js";

export const WRITING_GUIDE = `# How to write a blog post with this server

This is the editorial playbook; the server's tools are the hands. Never build a
slug or an internal URL by hand — call generate_slug and resolve_internal_link.

## Workflow (in order)

1. Know the brand: call get_brand_guide({project}) for audience, tone, linking
   targets and compliance rules. Do not invent clinical facts, prices, or
   guarantees.
2. Confirm write access: writes only work on brands in ICMCP_WRITE_PROJECTS.
3. Log in: login({project}) -> ask the human for the e-mailed code -> submit_otp.
4. Research: search_content to avoid duplicates and find internal-link targets;
   list_post_categories / list_tags for ids (create_post_category / create_tag if
   missing); list_languages for language ids.
5. Draft in the brand's primary language, aimed at the quality bar below:
   - slug: generate_slug({text: title})
   - internal links: search_content -> resolve_internal_link({project, href,
     target_language}); put the returned URL in the <a href>. At least one.
   - external link: at least one reputable, non-competitor source.
   - images: every <img> needs meaningful alt text.
   - structure: exactly one <h1>, then <h2>/<h3> sections.
   - create_post_draft({project, language_id, title, slug, excerpt, content,
     focus_keyword, meta_title, meta_description, category_ids, tag_ids}).
     Always a draft; author byline defaults to the logged-in account.
6. Audit + fix: seo_audit_post until publish_ready:true; audit_post for slug +
   links; fix a slug with update_post_translation, links with fix_post_links
   (dry_run:true first, then dry_run:false).
7. Translate (optional): auto_translate_post -> poll auto_translate_status ->
   review; auto_translate_rollback undoes a run.
8. Publish: publish_post (re-runs the SEO gate; refuses if a blocking check
   fails). Pass scheduled_at to schedule. unpublish_post reverts to draft.

## Quality bar (the SEO audit's blocking checks)

- focus keyword in meta title (meta title <= 60 chars)
- focus keyword in meta description (meta description <= 160 chars)
- focus keyword in slug
- focus keyword used in body >= 2 times for a 300+ word post
- content length >= 800 words
- at least one internal link (via resolve_internal_link)
- every image has alt text
- exactly one H1; at least one H2/H3

Advisory (fix if easy, non-blocking): focus keyword in the first 150 characters;
at least one external link.

## Hard rules

- Never hand-build a slug or internal URL — use generate_slug /
  resolve_internal_link.
- Never publish without a clean seo_audit_post.
- One focus keyword per post; title, meta, slug and opening line must agree.
- No medical/dental guarantees, specific outcomes, graft/tooth counts, or prices
  unless the brand guide permits; never invent clinical facts.
- Write only in the brand's active languages (list_languages).`;

export interface BrandGuide {
  name: string;
  primary_language: string;
  summary: string;
  audience: string;
  tone: string;
  topics: string;
  linking_targets: string[];
  never_say: string[];
  todos: string[];
}

export const BRAND_GUIDES: Partial<Record<ProjectId, BrandGuide>> = {
  "istanbul-care": {
    name: "Istanbul Care (IC)",
    primary_language: "en",
    summary:
      "Medical-tourism clinic in Istanbul, Turkey, best known for hair " +
      "transplantation (FUE, DHI, Sapphire FUE) with related aesthetic and dental " +
      "treatments. Serves international patients.",
    audience:
      "International prospective patients (Europe-heavy) researching hair loss and " +
      "hair-transplant options in Turkey; often early in the decision, comparing " +
      "techniques, cost and countries. Value reassurance and clear expectations.",
    tone:
      "Warm, reassuring, expert but plain-spoken. Second person. Short paragraphs. " +
      "Explain jargon (FUE, DHI, grafts) on first use. Confident without hype.",
    topics:
      "Hair-transplant techniques and comparisons; candidacy and planning; recovery " +
      "and aftercare; hair-loss causes; cost/country comparisons; before-and-after " +
      "expectations; women's, beard, eyebrow, afro transplants; dental/aesthetic " +
      "crossover when relevant.",
    linking_targets: [
      "The relevant hair-transplant service page (FUE/DHI/Sapphire/women/afro/beard/eyebrow) — find via search_content, link via resolve_internal_link",
      "Related published blog posts (search_content or the post's related_posts)",
      "A consultation / contact CTA near the end",
    ],
    never_say: [
      "Guarantees of specific results or exact graft counts — use ranges and 'depending on assessment'",
      "Prices in the blog body — direct to the service page or a consultation",
      "Comparative claims against named competitor clinics",
      "Personal medical instructions — always 'our medical team will assess…'",
    ],
    todos: [
      "Confirm additional service lines, accreditations, and team facts with the brand owner before citing them",
    ],
  },
  "albanian-hair-klinik": {
    name: "Albania Hair Clinic (AHC)",
    primary_language: "en",
    summary:
      "Hair-transplantation clinic based in ALBANIA (not Turkey) serving " +
      "international patients (FUE / DHI and related techniques).",
    audience:
      "International patients considering a hair transplant in Albania — often " +
      "cost-conscious, comparing destinations (Albania vs Turkey vs home country). " +
      "Want clear expectations on technique, cost drivers, travel and recovery.",
    tone:
      "Warm, approachable, trustworthy. Second person. Plain language; define terms " +
      "once. Emphasise the Albania destination without disparaging other countries " +
      "by name.",
    topics:
      "Hair-transplant techniques and candidacy; recovery/aftercare; hair-loss " +
      "causes; destination/travel considerations for Albania; before-and-after " +
      "expectations.",
    linking_targets: [
      "The relevant AHC hair-transplant service page (via search_content + resolve_internal_link)",
      "Related published AHC blog posts",
      "A consultation / contact CTA",
    ],
    never_say: [
      "Result or graft-count guarantees — use ranges and 'subject to assessment'",
      "Prices in the blog body — point to the service page / consultation",
      "Named-competitor comparisons",
      "Personal medical instructions",
    ],
    todos: [
      "Location is Albania — never reuse Istanbul Care's location, copy or facts",
      "Confirm services, accreditations and facility facts with the brand owner",
    ],
  },
  "ic-dental-group": {
    name: "IC Dental Group (Dental)",
    primary_language: "en",
    summary:
      "Dental-treatment clinic in the Istanbul Care family: implants, All-on-4 / " +
      "All-on-X, veneers and crowns for international patients. DENTAL only — no " +
      "hair-transplant topics.",
    audience:
      "International patients researching dental work abroad — implants, full-arch " +
      "restoration, smile makeovers, crowns/veneers. Weigh cost, materials " +
      "(zirconia, titanium), durability, treatment time and number of trips.",
    tone:
      "Reassuring, precise, professional. Second person. Define dental terms " +
      "(All-on-X, abutment, zirconia) on first use. Emphasise comfort, planning and " +
      "clear timelines.",
    topics:
      "Implant types and candidacy; All-on-4 / All-on-X full-arch restoration; " +
      "veneers and crowns; smile makeovers; aftercare and longevity; treatment-" +
      "abroad logistics; materials comparisons (non-competitor).",
    linking_targets: [
      "The relevant dental service page (implants, All-on-X, veneers, crowns…) via search_content + resolve_internal_link",
      "Related published dental blog posts",
      "A consultation / contact CTA",
    ],
    never_say: [
      "Guarantees of implant success rates, tooth counts, or 'permanent/forever' — use ranges and 'depending on clinical assessment'",
      "Prices in the blog body — direct to the service page / consultation",
      "Named-competitor comparisons",
      "Personal dental instructions — always 'our dental team will assess…'",
    ],
    todos: [
      "DENTAL brand — never carry over hair-transplant topics or copy",
      "Confirm exact service list, materials and accreditations with the brand owner",
    ],
  },
};
