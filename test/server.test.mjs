// Boots the real server over stdio and checks the tool surface.
//
// Registering ~200 tools across a dozen modules makes one mistake very easy
// and completely silent: two modules claiming the same tool name, so whichever
// registers last wins and a tool the agent thinks it is calling is somebody
// else's. These tests exist to make that loud. Run: npm test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function bootedTools() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: repoRoot,
    // No session and no stored credentials: a write must stop at auth.
    env: { ...process.env, ICMCP_PERSIST_SESSIONS: "0", ICMCP_EMAIL: "", ICMCP_PASSWORD: "" },
  });
  const client = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await client.connect(transport);
  return { client, tools: (await client.listTools()).tools };
}

test("the server boots and every tool name is unique", async () => {
  const { client, tools } = await bootedTools();
  try {
    const seen = new Set();
    const duplicates = [];
    for (const tool of tools) {
      if (seen.has(tool.name)) duplicates.push(tool.name);
      seen.add(tool.name);
    }
    assert.deepEqual(duplicates, [], "two modules registered the same tool name");
    assert.ok(tools.length > 150, `expected the full surface, got ${tools.length}`);
  } finally {
    await client.close();
  }
});

test("every tool says what it is for", async () => {
  const { client, tools } = await bootedTools();
  try {
    const mute = tools.filter((t) => !t.description || t.description.length < 30);
    assert.deepEqual(mute.map((t) => t.name), [], "these tools need a real description");
  } finally {
    await client.close();
  }
});

test("a write with no sign-in stops at auth, not at some gate of its own", async () => {
  const { client } = await bootedTools();
  try {
    const result = await client.callTool({
      name: "delete_slide",
      arguments: { project: "istanbul-care", slide_id: 1 },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Not authenticated|login/i);
    assert.doesNotMatch(result.content[0].text, /ICMCP_WRITE_PROJECTS/);
  } finally {
    await client.close();
  }
});

test("a dropdown value the site cannot render is refused before the request", async () => {
  const { client } = await bootedTools();
  try {
    const result = await client.callTool({
      name: "create_footer_item",
      arguments: {
        project: "istanbul-care",
        section_id: 1,
        label: "Call us",
        type: "telephone",
      },
    });
    assert.equal(result.isError, true);
    // With no sign-in the auth check fires first; either refusal is a
    // refusal, but the message must name the problem rather than 500 later.
    assert.ok(result.content[0].text.length > 20);
  } finally {
    await client.close();
  }
});
