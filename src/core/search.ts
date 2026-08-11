import { readFileSync } from "node:fs";
import path from "node:path";
import type { LogEntry } from "./scan.js";

export interface Snippet {
  /** 1-indexed line number of the first line in the snippet */
  line: number;
  /** Matched line plus surrounding context lines, joined with newlines */
  text: string;
}

export interface FileMatch {
  entry: LogEntry;
  snippets: Snippet[];
  /** Total number of matching lines in the file (snippets may be fewer) */
  match_count: number;
}

/**
 * A file matches when every term appears somewhere in its content
 * (case-insensitive AND). Snippets are built from lines containing any term,
 * with overlapping context ranges merged.
 */
export function searchEntries(
  root: string,
  entries: LogEntry[],
  terms: string[],
  contextLines: number,
  maxSnippetsPerFile: number,
): FileMatch[] {
  const lowered = terms.map((t) => t.toLowerCase());
  const results: FileMatch[] = [];

  for (const entry of entries) {
    let content: string;
    try {
      content = readFileSync(path.join(root, entry.path), "utf8");
    } catch {
      continue;
    }
    const contentLower = content.toLowerCase();
    if (!lowered.every((t) => contentLower.includes(t))) continue;

    const lines = content.split("\n");
    const matchingLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      if (lowered.some((t) => lineLower.includes(t))) matchingLines.push(i);
    }

    const snippets: Snippet[] = [];
    let lastEnd = -1;
    for (const lineIdx of matchingLines) {
      if (snippets.length >= maxSnippetsPerFile) break;
      const start = Math.max(0, lineIdx - contextLines);
      const end = Math.min(lines.length - 1, lineIdx + contextLines);
      if (start <= lastEnd && snippets.length > 0) {
        // Extend the previous snippet instead of emitting an overlapping one
        const prev = snippets[snippets.length - 1];
        const prevStart = prev.line - 1;
        prev.text = lines.slice(prevStart, end + 1).join("\n");
        lastEnd = end;
        continue;
      }
      snippets.push({ line: start + 1, text: lines.slice(start, end + 1).join("\n") });
      lastEnd = end;
    }

    results.push({ entry, snippets, match_count: matchingLines.length });
  }

  return results;
}
