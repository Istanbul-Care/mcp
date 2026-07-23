import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getProject } from "../config/projects.js";
import { WRITING_GUIDE, BRAND_GUIDES } from "../lib/guides.js";
import { ok, guard, projectParam } from "./helpers.js";

export function registerGuideTools(server: McpServer): void {
  server.registerTool(
    "get_writing_guide",
    {
      title: "How to write a blog post here",
      description:
        "The editorial playbook for authoring a blog post through this server: the " +
        "step-by-step workflow (research → draft → SEO audit → fix → translate → publish), " +
        "which tool to use at each step, and the SEO quality bar a post must clear. Read it " +
        "before writing. Needs no authentication.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => guard(async () => ok(WRITING_GUIDE)),
  );

  server.registerTool(
    "get_brand_guide",
    {
      title: "A brand's voice, audience and rules",
      description:
        "The editorial profile for one brand: who it is, its audience, tone, the pages a " +
        "post should link to, and the compliance rules (no guarantees, no prices, no " +
        "competitor comparisons, etc.). Read it before writing for that brand. Brands " +
        "without a configured profile return the shape to fill in — never invent clinical " +
        "facts. Needs no authentication.",
      inputSchema: { project: projectParam },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project }) =>
      guard(async () => {
        const guide = BRAND_GUIDES[project];
        if (!guide) {
          return ok({
            project,
            configured: false,
            brand: getProject(project).name,
            note:
              `No editorial profile is configured for '${project}' yet. Ask the brand ` +
              `owner for its audience, tone, internal-linking targets and compliance ` +
              `rules — do NOT invent clinical facts, prices, or guarantees — then add ` +
              `it to BRAND_GUIDES.`,
            required_fields: [
              "summary",
              "audience",
              "tone",
              "topics",
              "linking_targets",
              "never_say",
            ],
          });
        }
        return ok({ project, configured: true, ...guide });
      }),
  );
}
