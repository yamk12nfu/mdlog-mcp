import type { LogEntry } from "./core/scan.js";

export interface Page<T> {
  total: number;
  count: number;
  offset: number;
  items: T[];
  has_more: boolean;
  next_offset?: number;
}

export function paginate<T>(items: T[], limit: number, offset: number): Page<T> {
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

export function errorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

export function entryLine(e: LogEntry): string {
  const cat = e.category ? ` [${e.category}]` : "";
  return `- **${e.date}** ${e.slug}${cat} — ${e.title} (\`${e.path}\`)`;
}
