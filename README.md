# mdlog-mcp

MCP (Model Context Protocol) server for searching **date-organized markdown logs** — daily digests, journals, meeting notes, or any markdown corpus where dates live in filenames or directory names.

Point it at a directory and ask your AI agent things like *"What did my digest say about Next.js caching back in May?"* — the agent finds it via full-text search instead of you grepping by hand.

## Recognized layouts

Any markdown file whose date appears in the filename **or** a parent directory name becomes an entry:

```
logs/
├── 2026-04-24-ai-web-dev-digest.md        # date in filename
├── 2026-08-10/
│   ├── ai-web-dev-digest.md               # date in directory name
│   └── infra-security-data-digest.md
└── weekly/
    └── 2026-08-10-weekly-review.md        # works in subdirectories too
```

- **date**: `YYYY-MM-DD` from the filename prefix or the nearest dated directory (must be a real calendar date)
- **slug**: the rest of the filename (e.g. `ai-web-dev-digest`) — acts as the entry type
- **category**: the subdirectory (e.g. `weekly`), with date directories stripped
- Undated markdown files are ignored and cannot be read through the tools
- Symlinks inside the directory are never followed

## Tools

All tools are read-only.

| Tool | Purpose |
|---|---|
| `mdlog_overview` | Corpus summary: entry count, date range, types, latest entries. Call first. |
| `mdlog_list_entries` | List entries newest-first, filtered by date range / slug / category, paginated. |
| `mdlog_search` | Full-text AND search with line-numbered snippets and context lines. |
| `mdlog_get_entry` | Read one entry's full content, chunked for long files. |

Every tool supports `response_format: "markdown" | "json"` (where applicable) and returns `structuredContent` alongside text.

## Setup

Requires Node.js >= 20.

### Claude Code

```bash
claude mcp add --scope user mdlog -- npx -y @yamk12nfu/mdlog-mcp --dir /path/to/your/logs
```

Or from a local checkout:

```bash
npm install && npm run build
claude mcp add --scope user mdlog -- node /path/to/mdlog-mcp/dist/index.js --dir /path/to/your/logs
```

### Claude Desktop / other MCP clients

```json
{
  "mcpServers": {
    "mdlog": {
      "command": "npx",
      "args": ["-y", "@yamk12nfu/mdlog-mcp", "--dir", "/path/to/your/logs"]
    }
  }
}
```

The target directory can also be set via the `MDLOG_DIR` environment variable instead of `--dir`.

## Example prompts

Once connected, ask your agent:

- "5月ごろのダイジェストで Next.js のキャッシュの話なかったっけ？"
- "What security incidents were covered in my digests between June and July?"
- "Summarize the last three weekly reviews."

## Development

```bash
npm install
npm run build       # compile to dist/
npm run test        # run the test suite (node:test via tsx)
npm run dev         # run from src/ with tsx
node dist/index.js --dir ./sample-logs
```

Debug interactively with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js --dir /path/to/your/logs
```

## License

MIT
