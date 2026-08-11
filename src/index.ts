#!/usr/bin/env node
/**
 * mdlog-mcp — MCP server for searching date-organized markdown logs.
 *
 * Point it at a directory containing markdown files whose dates appear either
 * in the filename (2026-08-10-my-digest.md) or in a parent directory name
 * (2026-08-10/my-digest.md), and it exposes read-only tools to list, search,
 * and read those entries.
 *
 * Usage:
 *   mdlog-mcp --dir /path/to/logs
 *   MDLOG_DIR=/path/to/logs mdlog-mcp
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pkg, resolveRootDir } from "./config.js";
import { registerGetEntry } from "./tools/get-entry.js";
import { registerListEntries } from "./tools/list-entries.js";
import { registerOverview } from "./tools/overview.js";
import { registerSearch } from "./tools/search.js";

const root = resolveRootDir();

const server = new McpServer({
  name: "mdlog-mcp",
  version: pkg.version,
});

registerOverview(server, root);
registerListEntries(server, root);
registerSearch(server, root);
registerGetEntry(server, root);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`mdlog-mcp v${pkg.version} running via stdio (dir: ${root})`);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
