import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const project = process.argv[2] ?? "istanbul-care";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(here, "..", "dist", "index.js")],
});

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

function show(label, result) {
  const text = result.content?.map((part) => part.text).join("\n") ?? "";
  console.log(`\n=== ${label}${result.isError ? " [ERROR]" : ""} ===`);
  console.log(text.length > 2500 ? `${text.slice(0, 2500)}\n… (truncated)` : text);
}

const { tools } = await client.listTools();
console.log(`Tools (${tools.length}): ${tools.map((tool) => tool.name).join(", ")}`);

show("list_projects", await client.callTool({ name: "list_projects", arguments: {} }));

show(
  "list_languages",
  await client.callTool({ name: "list_languages", arguments: { project } }),
);

show(
  "search_content",
  await client.callTool({
    name: "search_content",
    arguments: { project, query: "hair transplant", limit: 3 },
  }),
);

show(
  "resolve_internal_link (legacy bare blog slug -> en)",
  await client.callTool({
    name: "resolve_internal_link",
    arguments: {
      project,
      href: "https://istanbul-care.com/hair-transplant-turkey-cost-2026/",
      target_language: "en",
    },
  }),
);

show(
  "resolve_internal_link (same slug -> de)",
  await client.callTool({
    name: "resolve_internal_link",
    arguments: {
      project,
      href: "/hair-transplant-turkey-cost-2026/",
      target_language: "de",
    },
  }),
);

show(
  "resolve_internal_link (service path)",
  await client.callTool({
    name: "resolve_internal_link",
    arguments: { project, href: "/hair-transplant/women/", target_language: "en" },
  }),
);

show(
  "localize_content_links",
  await client.callTool({
    name: "localize_content_links",
    arguments: {
      project,
      target_language: "de",
      html:
        '<p>See <a href="/hair-transplant-turkey-cost-2026/">costs</a> and ' +
        '<a href="/hair-transplant/women/">women\'s treatment</a>, plus ' +
        '<a href="https://example.com/x">an external page</a>.</p>',
    },
  }),
);

await client.close();
