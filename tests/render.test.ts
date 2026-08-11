import assert from "node:assert/strict";
import { test } from "node:test";
import { CHARACTER_LIMIT } from "../src/constants.js";
import type { Page } from "../src/respond.js";
import { ResponseFormat } from "../src/schemas.js";
import { renderSearchResults, type SearchFileOutput } from "../src/tools/search.js";

function makeFile(i: number, snippetChars: number, snippetCount = 1): SearchFileOutput {
  return {
    date: "2026-08-10",
    slug: `entry-${i}`,
    title: `Entry ${i}`,
    path: `2026-08-10/entry-${i}.md`,
    match_count: snippetCount,
    snippets: Array.from({ length: snippetCount }, (_, s) => ({
      line: s * 10 + 1,
      text: "x".repeat(snippetChars),
    })),
  };
}

function makePage(files: SearchFileOutput[], total: number, offset: number): Page<SearchFileOutput> {
  const hasMore = total > offset + files.length;
  return {
    total,
    count: files.length,
    offset,
    items: files,
    has_more: hasMore,
    ...(hasMore ? { next_offset: offset + files.length } : {}),
  };
}

test("truncated pages keep dropped files reachable via next_offset (F-002)", () => {
  const files = Array.from({ length: 10 }, (_, i) => makeFile(i, 4000));
  const page = makePage(files, 12, 0);
  const { text, output } = renderSearchResults(page, "q", ResponseFormat.MARKDOWN);

  assert.ok(text.length <= CHARACTER_LIMIT);
  assert.equal(output.truncated, true);
  assert.ok(output.count < 10);
  assert.equal(output.has_more, true);
  assert.equal(output.next_offset, output.offset + output.count);
});

test("truncation on the final page still reports has_more with next_offset (F-002)", () => {
  const files = Array.from({ length: 10 }, (_, i) => makeFile(i, 4000));
  const page = makePage(files, 10, 0);
  const { output } = renderSearchResults(page, "q", ResponseFormat.MARKDOWN);

  assert.equal(output.truncated, true);
  assert.equal(output.has_more, true);
  assert.equal(output.next_offset, output.count);
});

test("a single oversized file is clamped under the limit (F-005)", () => {
  const page = makePage([makeFile(0, 100_000)], 1, 0);
  const { text, output } = renderSearchResults(page, "q", ResponseFormat.MARKDOWN);

  assert.ok(text.length <= CHARACTER_LIMIT, `text length ${text.length} exceeds limit`);
  assert.equal(output.truncated, true);
  assert.equal(output.has_more, false);
  assert.equal(output.next_offset, undefined);
});

test("a single file with many snippets drops snippets, not the file (F-005)", () => {
  const page = makePage([makeFile(0, 5000, 8)], 1, 0);
  const { text, output } = renderSearchResults(page, "q", ResponseFormat.MARKDOWN);

  assert.ok(text.length <= CHARACTER_LIMIT);
  assert.equal(output.count, 1);
  assert.equal(output.truncated, true);
  assert.ok(output.files[0].snippets.length < 8);
  assert.equal(output.has_more, false);
});

test("responses that fit are returned untouched", () => {
  const files = [makeFile(0, 100), makeFile(1, 100)];
  const page = makePage(files, 2, 0);
  const { output } = renderSearchResults(page, "q", ResponseFormat.MARKDOWN);

  assert.equal(output.truncated, undefined);
  assert.equal(output.count, 2);
  assert.equal(output.has_more, false);
  assert.equal(output.next_offset, undefined);
});

test("oversized titles cannot push the response over the limit", () => {
  const file = { ...makeFile(0, 100), title: "T".repeat(30_000) };
  for (const format of [ResponseFormat.MARKDOWN, ResponseFormat.JSON]) {
    const { text } = renderSearchResults(makePage([file], 1, 0), "q", format);
    assert.ok(text.length <= CHARACTER_LIMIT, `${format}: ${text.length} exceeds limit`);
  }
});

test("json format applies the same truncation accounting", () => {
  const files = Array.from({ length: 10 }, (_, i) => makeFile(i, 4000));
  const page = makePage(files, 12, 0);
  const { text, output } = renderSearchResults(page, "q", ResponseFormat.JSON);

  assert.ok(text.length <= CHARACTER_LIMIT);
  const parsed = JSON.parse(text);
  assert.equal(parsed.next_offset, output.offset + output.count);
  assert.equal(parsed.truncated, true);
});
