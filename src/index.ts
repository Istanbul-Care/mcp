import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAuthTools } from "./tools/auth.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerLinkTools } from "./tools/links.js";
import { registerPostTools } from "./tools/posts.js";
import { registerAuthoringTools } from "./tools/authoring.js";
import { registerTranslateTools } from "./tools/translate.js";
import { registerTaxonomyTools } from "./tools/taxonomy.js";
import { registerFaqTools } from "./tools/faq.js";
import { registerSeoTools } from "./tools/seo.js";
import { registerContentQualityTools } from "./tools/content-quality.js";
import { registerServiceTools } from "./tools/services.js";
import { registerBulkAuditTools } from "./tools/bulk-audit.js";
import { registerGuideTools } from "./tools/guides.js";
import { registerFooterTools } from "./tools/footer.js";
import { registerMediaTools } from "./tools/media.js";
import { registerPageTools } from "./tools/pages.js";
import { registerCardTools } from "./tools/cards.js";
import { registerFormTools } from "./tools/forms.js";
import { registerChatbotTools } from "./tools/chatbot.js";
import { registerHeaderTools } from "./tools/header.js";
import { registerComponentTools } from "./tools/components.js";
import { registerTranslatePrompt } from "./prompts/translate-brand.js";
import { registerLoginPrompt } from "./prompts/login.js";

const server = new McpServer(
  { name: "istanbul-care-content", version: "0.1.0" },
  {
    instructions:
      "Multi-brand content admin for Istanbul Care and its sibling clinics. Every tool " +
      "takes an explicit `project` — start with list_projects. Reads of published content " +
      "(search_content, resolve_internal_link, list_languages) work without logging in; " +
      "anything touching drafts or the admin API needs login + submit_otp for that brand, " +
      "because the backend mails a one-time code on every login. Never hand-build a blog or " +
      "service URL — call resolve_internal_link, since the public path depends on the " +
      "brand's container template and the language.",
  },
);

registerAuthTools(server);
registerDiscoveryTools(server);
registerPostTools(server);
registerLinkTools(server);
registerAuthoringTools(server);
registerTranslateTools(server);
registerTaxonomyTools(server);
registerFaqTools(server);
registerSeoTools(server);
registerContentQualityTools(server);
registerServiceTools(server);
registerBulkAuditTools(server);
registerGuideTools(server);
registerFooterTools(server);
registerMediaTools(server);
registerPageTools(server);
registerCardTools(server);
registerFormTools(server);
registerChatbotTools(server);
registerHeaderTools(server);
registerComponentTools(server);
registerTranslatePrompt(server);
registerLoginPrompt(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("istanbul-care-content MCP server ready on stdio");
}

main().catch((error: unknown) => {
  console.error("Fatal:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
