import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CHARACTER_LIMIT } from "../constants.js";
import { filterEntries, scanEntries } from "../core/scan.js";
import { searchEntries } from "../core/search.js";
import { errorResult, paginate } from "../respond.js";
import { dateString, ResponseFormat, responseFormat } from "../schemas.js";

const SearchInput = {
  query: z.string().min(1).max(200)
    .describe("Search terms separated by spaces. A file matches when it contains ALL terms (case-insensitive). Example: 'Next.js cache'"),
  from: dateString.optional().describe("Only search entries on or after this date (YYYY-MM-DD)"),
  to: dateString.optional().describe("Only search entries on or before this date (YYYY-MM-DD)"),
  slug_contains: z.string().max(100).optional()
    .describe("Only search entries whose slug contains this substring (case-insensitive)"),
  context_lines: z.number().int().min(0).max(5).default(1)
    .describe("Lines of context around each matching line in snippets (default: 1)"),
  max_snippets_per_file: z.number().int().min(1).max(10).default(3)
    .describe("Maximum snippets to return per file (default: 3)"),
  limit: z.number().int().min(1).max(50).default(10).describe("Maximum files to return (default: 10)"),
  offset: z.number().int().min(0).default(0).describe("Number of matched files to skip for pagination"),
  response_format: responseFormat,
};

export function registerSearch(server: McpServer, root: string): void {
  server.registerTool(
    "mdlog_search",
    {
      title: "Search Log Entries",
      description: `Full-text search across dated markdown log entries. Returns matching files (newest first) with line-numbered snippets around each hit.

A file matches when it contains ALL space-separated terms, case-insensitive. Snippets show lines containing any term, plus context lines.

Args:
  - query (string): Space-separated AND terms, e.g. 'Vercel incident'
  - from / to (YYYY-MM-DD): Inclusive date range filter
  - slug_contains (string): Entry type filter, e.g. 'infra'
  - context_lines (number): Context lines per snippet, 0-5 (default: 1)
  - max_snippets_per_file (number): Snippet cap per file, 1-10 (default: 3)
  - limit / offset: Pagination over matched files (default: 10 / 0)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: matched files [{date, slug, title, path, match_count, snippets: [{line, text}]}] with pagination metadata. Use mdlog_get_entry with a returned 'path' to read the full entry.`,
      inputSchema: SearchInput,
      outputSchema: {
        total: z.number(),
        count: z.number(),
        offset: z.number(),
        has_more: z.boolean(),
        next_offset: z.number().optional(),
        truncated: z.boolean().optional(),
        files: z.array(z.object({
          date: z.string(),
          slug: z.string(),
          title: z.string(),
          path: z.string(),
          match_count: z.number(),
          snippets: z.array(z.object({ line: z.number(), text: z.string() })),
        })),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      if (params.from && params.to && params.from > params.to) {
        return errorResult(`'from' (${params.from}) is after 'to' (${params.to}). Swap the values.`);
      }
      const terms = params.query.split(/\s+/).filter(Boolean);
      if (terms.length === 0) {
        return errorResult("Query contained no search terms. Provide at least one non-space term.");
      }

      const entries = filterEntries(scanEntries(root), params);
      const matches = searchEntries(root, entries, terms, params.context_lines, params.max_snippets_per_file);

      if (matches.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No entries matched '${params.query}'. All terms must appear in the same file — try fewer or shorter terms, or widen the date range.`,
          }],
          structuredContent: { total: 0, count: 0, offset: params.offset, has_more: false, files: [] },
        };
      }

      const page = paginate(matches, params.limit, params.offset);
      const toFileOutput = (m: (typeof matches)[number]) => ({
        date: m.entry.date,
        slug: m.entry.slug,
        title: m.entry.title,
        path: m.entry.path,
        match_count: m.match_count,
        snippets: m.snippets,
      });

      let files = page.items.map(toFileOutput);
      let truncated = false;
      const buildOutput = () => ({
        total: page.total,
        count: files.length,
        offset: page.offset,
        has_more: page.has_more || truncated,
        ...(page.next_offset !== undefined ? { next_offset: page.next_offset } : {}),
        ...(truncated ? { truncated: true } : {}),
        files,
      });
      const buildText = (): string => {
        if (params.response_format === ResponseFormat.JSON) return JSON.stringify(buildOutput(), null, 2);
        const lines = [
          `# Search results for '${params.query}' (${page.total} files matched, showing ${files.length} from offset ${page.offset})`,
        ];
        for (const f of files) {
          lines.push("", `## ${f.date} ${f.slug} — ${f.title}`, `path: \`${f.path}\` (${f.match_count} matching lines)`);
          for (const s of f.snippets) {
            lines.push("", `L${s.line}:`, "```", s.text, "```");
          }
        }
        if (truncated) lines.push("", "Response was truncated to fit size limits. Narrow the query or lower limit/context_lines.");
        else if (page.has_more) lines.push("", `More files available: call again with offset=${page.next_offset}.`);
        return lines.join("\n");
      };

      let text = buildText();
      while (text.length > CHARACTER_LIMIT && files.length > 1) {
        files = files.slice(0, Math.ceil(files.length / 2));
        truncated = true;
        text = buildText();
      }

      return { content: [{ type: "text", text }], structuredContent: buildOutput() };
    },
  );
}
