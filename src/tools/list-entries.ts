import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { filterEntries, scanEntries } from "../core/scan.js";
import { entryLine, errorResult, paginate } from "../respond.js";
import { dateString, entryOutputShape, ResponseFormat, responseFormat } from "../schemas.js";

const ListInput = {
  from: dateString.optional().describe("Only include entries on or after this date (YYYY-MM-DD)"),
  to: dateString.optional().describe("Only include entries on or before this date (YYYY-MM-DD)"),
  slug_contains: z.string().max(100).optional()
    .describe("Only include entries whose slug contains this substring (case-insensitive), e.g. 'infra'"),
  category: z.string().max(200).optional()
    .describe("Only include entries in exactly this category (relative directory, '' for root)"),
  limit: z.number().int().min(1).max(100).default(30).describe("Maximum entries to return (default: 30)"),
  offset: z.number().int().min(0).default(0).describe("Number of entries to skip for pagination"),
  response_format: responseFormat,
};

export function registerListEntries(server: McpServer, root: string): void {
  server.registerTool(
    "mdlog_list_entries",
    {
      title: "List Log Entries",
      description: `List dated markdown log entries, newest first, with optional date-range and type filters.

Args:
  - from / to (YYYY-MM-DD): Inclusive date range filter
  - slug_contains (string): Filter by entry type substring, e.g. 'weekly' or 'infra'
  - category (string): Exact category (subdirectory) filter
  - limit (number): Max entries, 1-100 (default: 30)
  - offset (number): Pagination offset (default: 0)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: paginated entries [{date, slug, title, path, category}] with total / has_more / next_offset. Use the returned 'path' with mdlog_get_entry to read a full entry.`,
      inputSchema: ListInput,
      outputSchema: {
        total: z.number(),
        count: z.number(),
        offset: z.number(),
        has_more: z.boolean(),
        next_offset: z.number().optional(),
        entries: z.array(z.object(entryOutputShape)),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      if (params.from && params.to && params.from > params.to) {
        return errorResult(`'from' (${params.from}) is after 'to' (${params.to}). Swap the values.`);
      }
      const entries = filterEntries(scanEntries(root), params);
      if (entries.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No entries matched the filters. Try widening the date range or removing slug_contains/category. Use mdlog_overview to see what exists.",
          }],
          structuredContent: { total: 0, count: 0, offset: params.offset, has_more: false, entries: [] },
        };
      }

      const page = paginate(entries, params.limit, params.offset);
      const output = {
        total: page.total,
        count: page.count,
        offset: page.offset,
        has_more: page.has_more,
        ...(page.next_offset !== undefined ? { next_offset: page.next_offset } : {}),
        entries: page.items,
      };

      let text: string;
      if (params.response_format === ResponseFormat.MARKDOWN) {
        const lines = [
          `# Log entries (${page.total} matched, showing ${page.count} from offset ${page.offset})`,
          "",
          ...page.items.map(entryLine),
        ];
        if (page.has_more) lines.push("", `More available: call again with offset=${page.next_offset}.`);
        text = lines.join("\n");
      } else {
        text = JSON.stringify(output, null, 2);
      }

      return { content: [{ type: "text", text }], structuredContent: output };
    },
  );
}
