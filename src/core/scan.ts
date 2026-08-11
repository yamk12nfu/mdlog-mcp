import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { DATE_RE, isValidCalendarDate } from "./dates.js";

export interface LogEntry {
  /** ISO date (YYYY-MM-DD) extracted from the filename or the nearest dated directory */
  date: string;
  /** Identifier derived from the filename, e.g. "ai-web-dev-digest" */
  slug: string;
  /** First `# ` heading in the file, falling back to the slug */
  title: string;
  /** Path relative to the scan root */
  path: string;
  /** Relative directory with date segments removed, "" for the root */
  category: string;
}

const DATE_IN_FILENAME = /^(\d{4}-\d{2}-\d{2})[-_](.+)\.md$/;
const SKIP_DIRS = new Set(["node_modules", "dist"]);

// Title extraction reads file contents, so cache by mtime to keep
// repeated list/overview calls cheap while staying fresh as logs grow.
const titleCache = new Map<string, { mtimeMs: number; title: string }>();

function extractTitle(absPath: string, fallback: string): string {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(absPath).mtimeMs;
  } catch {
    return fallback;
  }
  const cached = titleCache.get(absPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.title;

  let title = fallback;
  try {
    const content = readFileSync(absPath, "utf8");
    const match = content.match(/^#\s+(.+)$/m);
    if (match) title = match[1].trim();
  } catch {
    // unreadable file: keep fallback
  }
  titleCache.set(absPath, { mtimeMs, title });
  return title;
}

/**
 * Recursively scan `root` for markdown files that carry a real calendar date
 * either in the filename (`2026-08-10-foo.md`) or in a parent directory
 * (`2026-08-10/foo.md`); the nearest dated ancestor wins. Undated markdown
 * files are ignored. Symlinks are never followed, so entries cannot point
 * outside the root and link cycles cannot cause infinite recursion.
 * Results are sorted newest first.
 */
export function scanEntries(root: string): LogEntry[] {
  const entries: LogEntry[] = [];

  function walk(dir: string, relSegments: string[]): void {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      let stat;
      try {
        stat = lstatSync(abs);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        walk(abs, [...relSegments, name]);
        continue;
      }
      if (!name.endsWith(".md")) continue;

      let date: string | undefined;
      let slug: string | undefined;

      const fileMatch = name.match(DATE_IN_FILENAME);
      if (fileMatch && isValidCalendarDate(fileMatch[1])) {
        date = fileMatch[1];
        slug = fileMatch[2];
      } else {
        for (let i = relSegments.length - 1; i >= 0; i--) {
          if (isValidCalendarDate(relSegments[i])) {
            date = relSegments[i];
            slug = name.replace(/\.md$/, "");
            break;
          }
        }
      }
      if (!date || !slug) continue;

      const category = relSegments.filter((seg) => !DATE_RE.test(seg)).join("/");
      entries.push({
        date,
        slug,
        title: extractTitle(abs, slug),
        path: [...relSegments, name].join("/"),
        category,
      });
    }
  }

  walk(root, []);
  entries.sort((a, b) => (a.date === b.date ? a.path.localeCompare(b.path) : b.date.localeCompare(a.date)));
  return entries;
}

export interface EntryFilter {
  from?: string;
  to?: string;
  slug_contains?: string;
  category?: string;
}

export function filterEntries(entries: LogEntry[], filter: EntryFilter): LogEntry[] {
  return entries.filter((e) => {
    if (filter.from && e.date < filter.from) return false;
    if (filter.to && e.date > filter.to) return false;
    if (filter.slug_contains && !e.slug.toLowerCase().includes(filter.slug_contains.toLowerCase())) return false;
    if (filter.category !== undefined && e.category !== filter.category) return false;
    return true;
  });
}

/** True when relPath is one of the entries scanEntries would return. */
export function isKnownEntry(root: string, relPath: string): boolean {
  const normalized = path.normalize(relPath);
  return scanEntries(root).some((e) => path.normalize(e.path) === normalized);
}

/**
 * Resolve a client-supplied relative path, rejecting escapes from the root.
 * Containment is enforced on the real path, so symlinks pointing outside the
 * root are rejected even though they sit lexically inside it.
 */
export function resolveEntryPath(root: string, relPath: string): string {
  const rootReal = realpathSync(path.resolve(root));
  const abs = path.resolve(rootReal, relPath);
  const prefix = rootReal + path.sep;
  if (!abs.startsWith(prefix)) {
    throw new Error(`Path escapes the log directory: ${relPath}`);
  }
  if (!abs.endsWith(".md")) {
    throw new Error(`Only .md files can be read: ${relPath}`);
  }
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    throw new Error(`Entry not found: ${relPath}`);
  }
  if (!real.startsWith(prefix)) {
    throw new Error(`Path escapes the log directory: ${relPath}`);
  }
  return real;
}
