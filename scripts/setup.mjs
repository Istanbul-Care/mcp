#!/usr/bin/env node
/**
 * One-command setup for someone who writes content, not code.
 *
 * The server talks stdio, so every person runs their own copy and it has to be
 * registered with whatever Claude app they use. Doing that by hand means
 * hand-editing a JSON file most of the content team has never opened, in a
 * directory the Finder hides by default. This script writes that entry — and
 * only that entry, merging into whatever else is already configured.
 *
 *   npm run setup -- --email seo@istanbul-care.com --brands istanbul-care,luneste-clinic
 *
 * The password is deliberately NOT a flag. It is prompted for, so it does not
 * land in the shell history, and it is stored only in the app's own config
 * file, which this script locks to 0600. Skip it entirely with --no-password
 * and pass credentials to the login tool instead.
 */

import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, "..", "dist", "index.js");
const SERVER_NAME = "ic-content";

function flag(name, fallback = undefined) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit.includes("=")) return hit.slice(hit.indexOf("=") + 1);
  const next = process.argv[process.argv.indexOf(hit) + 1];
  return next && !next.startsWith("--") ? next : true;
}

/** Where each Claude app keeps its MCP servers. */
function desktopConfigPath() {
  const home = homedir();
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  return join(home, ".config", "Claude", "claude_desktop_config.json");
}

function readJson(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8") || "{}");
  } catch {
    throw new Error(
      `${path} is not valid JSON. Fix or move it first — refusing to overwrite a file I cannot read.`,
    );
  }
}

async function main() {
  if (!existsSync(ENTRY)) {
    console.error("The server is not built yet. Run `npm install` in this folder first.");
    process.exit(1);
  }

  const email = flag("email");
  const brands = flag("brands");
  if (!email) {
    console.error(
      "Missing --email. Use YOUR OWN admin account, not a shared one: every write is\n" +
        "recorded in activity_logs against the account that made it, and the one-time\n" +
        "login code is mailed to that address.",
    );
    process.exit(1);
  }

  let password = "";
  if (flag("no-password") !== undefined) {
    console.log("Skipping the password — pass it to the login tool each time instead.\n");
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question(`Password for ${email} (leave blank to skip): `);
    rl.close();
  }

  const env = { ICMCP_EMAIL: email };
  if (password) env.ICMCP_PASSWORD = password;
  if (brands && brands !== true) env.ICMCP_WRITE_PROJECTS = brands;

  const path = desktopConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  const config = readJson(path);
  const servers = config.mcpServers ?? (config.mcpServers = {});
  const existed = SERVER_NAME in servers;
  servers[SERVER_NAME] = { command: process.execPath, args: [ENTRY], env };

  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
  chmodSync(path, 0o600);

  console.log(`\n${existed ? "Updated" : "Added"} '${SERVER_NAME}' in ${path}`);
  console.log(`  account   ${email}`);
  console.log(`  password  ${password ? "stored in that file (locked to 0600)" : "not stored"}`);
  console.log(
    `  writing   ${env.ICMCP_WRITE_PROJECTS ?? "nothing — read-only until --brands is given"}`,
  );
  console.log("\nQuit Claude Desktop completely and reopen it, then ask it to list_projects.");
  console.log("Using Claude Code instead? Run this and it is registered there too:\n");
  console.log(
    `  claude mcp add ${SERVER_NAME} --scope user \\\n` +
      Object.entries(env)
        .map(([k, v]) => `    -e ${k}=${k === "ICMCP_PASSWORD" ? "<your password>" : v} \\`)
        .join("\n") +
      `\n    -- node ${ENTRY}\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
