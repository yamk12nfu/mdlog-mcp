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
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { z } from "zod";
import { filterEntries, resolveEntryPath, scanEntries, type LogEntry } from "./scan.js";
import { searchEntries } from "./search.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

const CHARACTER_LIMIT = 25000;

enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

// ---------------------------------------------------------------------------
// CLI / configuration
// ---------------------------------------------------------------------------

function resolveRootDir(): string {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.error(
      [
        `mdlog-mcp v${pkg.version} — MCP server for date-organized markdown logs`,
        "",
        "Usage:",
        "  mdlog-mcp --dir <path>     Directory to scan for dated markdown files",
        "  MDLOG_DIR=<path> mdlog-mcp Same, via environment variable",
        "",
        "Recognized entry layouts (relative to --dir):",
        "  2026-08-10-my-digest.md          date in filename",
        "  2026-08-10/my-digest.md          date in directory name",
        "  weekly/2026-08-10-review.md      works in subdirectories too",
      ].join("\n"),
    );
    process.exit(0);
  }
  const dirFlag = args.indexOf("--dir");
  const dir = dirFlag !== -1 ? args[dirFlag + 1] : process.env.MDLOG_DIR;
  if (!dir) {
    console.error("ERROR: log directory not specified. Use --dir <path> or set MDLOG_DIR.");
    process.exit(1);
  }
  try {
    if (!statSync(dir).isDirectory()) {
      console.error(`ERROR: not a directory: ${dir}`);
      process.exit(1);
    }
  } catch {
    console.error(`ERROR: directory not found: ${dir}`);
    process.exit(1);
  }
  return dir;
}

const ROOT_DIR = resolveRootDir();

// ---------------------------------------------------------------------------
// Shared schemas and helpers
// ---------------------------------------------------------------------------

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

const responseFormat = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable");

const entryOutputShape = {
  date: z.string(),
  slug: z.string(),
  title: z.string(),
  path: z.string(),
  category: z.string(),
};

interface Page<T> {
  total: number;
  count: number;
  offset: number;
  items: T[];
  has_more: boolean;
  next_offset?: number;
}

function paginate<T>(items: T[], limit: number, offset: number): Page<T> {
  const page = items.slice(offset, offset + limit);
  const hasMore = offset + page.length < items.length;
  return {
    total: items.length,
    count: page.length,
    offset,
    items: page,
    has_more: hasMore,
    ...(hasMore ? { next_offset: offset + page.length } : {}),
  };
}

function errorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

function entryLine(e: LogEntry): string {
  const cat = e.category ? ` [${e.category}]` : "";
  return `- **${e.date}** ${e.slug}${cat} — ${e.title} (\`${e.path}\`)`;
}

// ---------------------------------------------------------------------------
// Server and tools
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "mdlog-mcp",
  version: pkg.version,
});

// --- mdlog_overview --------------------------------------------------------

const OverviewInput = {
  latest_count: z.number().int().min(0).max(20).default(5)
    .describe("How many of the most recent entries to include (default: 5)"),
  response_format: responseFormat,
};

server.registerTool(
  "mdlog_overview",
  {
    title: "Log Directory Overview",
    description: `Get a summary of the markdown log directory: how many entries exist, the covered date range, entry types (slugs) with counts, categories, and the most recent entries.

Call this first to understand what data is available before using mdlog_search or mdlog_list_entries.

Args:
  - latest_count (number): How many recent entries to include, 0-20 (default: 5)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: total entry count, first/last date, slugs [{slug, count, latest_date}], categories [{category, count}], latest entries [{date, slug, title, path}].`,
    inputSchema: OverviewInput,
    outputSchema: {
      total_entries: z.number(),
      first_date: z.string(),
      last_date: z.string(),
      slugs: z.array(z.object({ slug: z.string(), count: z.number(), latest_date: z.string() })),
      categories: z.array(z.object({ category: z.string(), count: z.number() })),
      latest: z.array(z.object({ date: z.string(), slug: z.string(), title: z.string(), path: z.string() })),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (params) => {
    const entries = scanEntries(ROOT_DIR);
    if (entries.length === 0) {
      return errorResult(
        `No dated markdown entries found under ${ROOT_DIR}. Expected filenames like 2026-08-10-foo.md or directories like 2026-08-10/.`,
      );
    }

    const slugMap = new Map<string, { count: number; latest_date: string }>();
    const categoryMap = new Map<string, number>();
    for (const e of entries) {
      const s = slugMap.get(e.slug);
      if (s) {
        s.count++;
        if (e.date > s.latest_date) s.latest_date = e.date;
      } else {
        slugMap.set(e.slug, { count: 1, latest_date: e.date });
      }
      categoryMap.set(e.category, (categoryMap.get(e.category) ?? 0) + 1);
    }

    const output = {
      total_entries: entries.length,
      first_date: entries[entries.length - 1].date,
      last_date: entries[0].date,
      slugs: [...slugMap.entries()]
        .map(([slug, v]) => ({ slug, ...v }))
        .sort((a, b) => b.count - a.count),
      categories: [...categoryMap.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
      latest: entries.slice(0, params.latest_count).map(({ date, slug, title, path }) => ({ date, slug, title, path })),
    };

    let text: string;
    if (params.response_format === ResponseFormat.MARKDOWN) {
      const lines = [
        `# mdlog overview`,
        "",
        `${output.total_entries} entries from ${output.first_date} to ${output.last_date}`,
        "",
        "## Entry types (slugs)",
        ...output.slugs.map((s) => `- ${s.slug}: ${s.count} entries (latest: ${s.latest_date})`),
        "",
        "## Categories",
        ...output.categories.map((c) => `- ${c.category || "(root)"}: ${c.count} entries`),
      ];
      if (output.latest.length > 0) {
        lines.push("", "## Latest entries");
        for (const e of output.latest) lines.push(`- **${e.date}** ${e.slug} — ${e.title} (\`${e.path}\`)`);
      }
      text = lines.join("\n");
    } else {
      text = JSON.stringify(output, null, 2);
    }

    return { content: [{ type: "text", text }], structuredContent: output };
  },
);

// --- mdlog_list_entries ----------------------------------------------------

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
    const entries = filterEntries(scanEntries(ROOT_DIR), params);
    if (entries.length === 0) {
      return {
        content: [{
          type: "text",
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

// --- mdlog_search ----------------------------------------------------------

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

    const entries = filterEntries(scanEntries(ROOT_DIR), params);
    const matches = searchEntries(ROOT_DIR, entries, terms, params.context_lines, params.max_snippets_per_file);

    if (matches.length === 0) {
      return {
        content: [{
          type: "text",
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

// --- mdlog_get_entry -------------------------------------------------------

const GetInput = {
  path: z.string().min(1).max(500)
    .describe("Entry path relative to the log directory, as returned by mdlog_list_entries or mdlog_search. Example: '2026-08-10/ai-web-dev-digest.md'"),
  offset: z.number().int().min(0).default(0)
    .describe("Character offset to start reading from, for long entries (default: 0)"),
  max_chars: z.number().int().min(100).max(100000).default(20000)
    .describe("Maximum characters to return (default: 20000)"),
};

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
      absPath = resolveEntryPath(ROOT_DIR, params.path);
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
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

    return { content: [{ type: "text", text: header + chunk }], structuredContent: output };
  },
);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`mdlog-mcp v${pkg.version} running via stdio (dir: ${ROOT_DIR})`);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
