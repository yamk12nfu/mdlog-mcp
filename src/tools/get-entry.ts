import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { isKnownEntry, resolveEntryPath } from "../core/scan.js";
import { errorResult } from "../respond.js";

const GetInput = {
  path: z.string().min(1).max(500)
    .describe("Entry path relative to the log directory, as returned by mdlog_list_entries or mdlog_search. Example: '2026-08-10/ai-web-dev-digest.md'"),
  offset: z.number().int().min(0).default(0)
    .describe("Character offset to start reading from, for long entries (default: 0)"),
  max_chars: z.number().int().min(100).max(100000).default(20000)
    .describe("Maximum characters to return (default: 20000)"),
};

export function registerGetEntry(server: McpServer, root: string): void {
  server.registerTool(
    "mdlog_get_entry",
    {
      title: "Read Log Entry",
      description: `Read the full markdown content of a single log entry by its relative path.

Args:
  - path (string): Relative path from mdlog_list_entries / mdlog_search results
  - offset (number): Character offset for reading long entries in chunks (default: 0)
  - max_chars (number): Maximum characters to return, 100-100000 (default: 20000)

Returns: the entry content plus metadata {path, total_chars, offset, returned_chars, has_more, next_offset}. If has_more is true, call again with offset=next_offset to continue reading.`,
      inputSchema: GetInput,
      outputSchema: {
        path: z.string(),
        total_chars: z.number(),
        offset: z.number(),
        returned_chars: z.number(),
        has_more: z.boolean(),
        next_offset: z.number().optional(),
        content: z.string(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      let absPath: string;
      try {
        absPath = resolveEntryPath(root, params.path);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
      // Only dated entries the scanner reports are readable; undated markdown
      // under the root stays outside the advertised corpus.
      if (!isKnownEntry(root, params.path)) {
        return errorResult(
          `Not a log entry: ${params.path}. Use mdlog_list_entries or mdlog_search to find valid paths.`,
        );
      }

      let content: string;
      try {
        content = readFileSync(absPath, "utf8");
      } catch {
        return errorResult(
          `Entry not found: ${params.path}. Use mdlog_list_entries or mdlog_search to find valid paths.`,
        );
      }

      if (params.offset >= content.length && content.length > 0) {
        return errorResult(
          `offset (${params.offset}) is beyond the entry length (${content.length} chars). Use offset=0 to read from the start.`,
        );
      }

      const chunk = content.slice(params.offset, params.offset + params.max_chars);
      const hasMore = params.offset + chunk.length < content.length;
      const output = {
        path: params.path,
        total_chars: content.length,
        offset: params.offset,
        returned_chars: chunk.length,
        has_more: hasMore,
        ...(hasMore ? { next_offset: params.offset + chunk.length } : {}),
        content: chunk,
      };

      const header = hasMore
        ? `[${params.path} — chars ${params.offset}-${params.offset + chunk.length} of ${content.length}; continue with offset=${output.next_offset}]\n\n`
        : params.offset > 0
          ? `[${params.path} — chars ${params.offset}-${content.length} of ${content.length}]\n\n`
          : "";

      return { content: [{ type: "text" as const, text: header + chunk }], structuredContent: output };
    },
  );
}
