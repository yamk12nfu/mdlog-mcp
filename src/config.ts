import { statSync } from "node:fs";
import { createRequire } from "node:module";

export const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

/**
 * Resolve the log directory from `--dir` or MDLOG_DIR, handling `--help`.
 * Exits the process on missing/invalid configuration.
 */
export function resolveRootDir(): string {
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
