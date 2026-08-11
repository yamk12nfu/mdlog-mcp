# Product Overview

mdlog-mcp は、日付で整理された Markdown ログ（日次ダイジェスト・ジャーナル・議事録など）を
全文検索するための MCP (Model Context Protocol) サーバー。npm パッケージ
`@yamk12nfu/mdlog-mcp` として公開され、`npx -y @yamk12nfu/mdlog-mcp --dir <path>` で起動する。

## エントリ認識ルール

対象ディレクトリ内の Markdown ファイルは、次の規則で「エントリ」になる（README「Recognized layouts」）。

- **date**: ファイル名の `YYYY-MM-DD` プレフィックス、または最も近い日付ディレクトリ名から取る。
  実在するカレンダー日付であることが必須。
- **slug**: ファイル名の残り部分（例: `ai-web-dev-digest`）。エントリ種別として機能する。
- **category**: サブディレクトリ名（日付ディレクトリは除去）。
- 日付を持たない Markdown はエントリにならず、ツール経由では読めない。
- ディレクトリ内の symlink は追わない。

## 提供ツール（すべて読み取り専用）

| ツール | 役割 |
|---|---|
| `mdlog_overview` | コーパス概要（件数・日付範囲・種別・最新）。最初に呼ぶ |
| `mdlog_list_entries` | 新しい順の一覧。日付範囲 / slug / category で絞り込み、ページネーション対応 |
| `mdlog_search` | AND 全文検索。行番号付きスニペットと前後行を返す |
| `mdlog_get_entry` | 1 エントリの全文取得。長文はチャンク分割 |

各ツールは `response_format: "markdown" | "json"` に対応し、テキストと併せて
`structuredContent` を返す。

## 実行要件と設定

- Node.js >= 20（`package.json` の `engines`）。
- 対象ディレクトリは `--dir` フラグまたは環境変数 `MDLOG_DIR` で指定する。
- 開発コマンドは npm: `npm run build`（tsc）/ `npm test`（node:test を tsx で実行）/
  `npm run dev`（tsx で src/ から起動）。
