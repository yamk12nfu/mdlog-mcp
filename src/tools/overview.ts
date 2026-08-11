import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scanEntries } from "../core/scan.js";
import { errorResult } from "../respond.js";
import { ResponseFormat, responseFormat } from "../schemas.js";

const OverviewInput = {
  latest_count: z.number().int().min(0).max(20).default(5)
    .describe("How many of the most recent entries to include (default: 5)"),
  response_format: responseFormat,
};

export function registerOverview(server: McpServer, root: string): void {
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
      const entries = scanEntries(root);
      if (entries.length === 0) {
        return errorResult(
          `No dated markdown entries found under ${root}. Expected filenames like 2026-08-10-foo.md or directories like 2026-08-10/.`,
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
}
