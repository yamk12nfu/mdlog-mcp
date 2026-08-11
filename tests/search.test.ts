import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { scanEntries } from "../src/core/scan.js";
import { searchEntries } from "../src/core/search.js";

const root = mkdtempSync(path.join(tmpdir(), "mdlog-search-"));

writeFileSync(
  path.join(root, "2026-08-10-log.md"),
  ["pad", "ctx-a", "hit one alpha", "mid", "hit two alpha", "ctx-b", "pad", "beta lives here"].join("\n"),
);
writeFileSync(path.join(root, "2026-08-09-other.md"), "only alpha here\nnothing else");

after(() => rmSync(root, { recursive: true, force: true }));

const entries = () => scanEntries(root);

test("all terms must appear in the same file (AND semantics)", () => {
  assert.equal(searchEntries(root, entries(), ["alpha", "beta"], 1, 3).length, 1);
  assert.equal(searchEntries(root, entries(), ["alpha"], 1, 3).length, 2);
  assert.equal(searchEntries(root, entries(), ["alpha", "zzz"], 1, 3).length, 0);
});

test("matching is case-insensitive", () => {
  assert.equal(searchEntries(root, entries(), ["ALPHA", "Beta"], 1, 3).length, 1);
});

test("match_count counts every matching line", () => {
  const [match] = searchEntries(root, entries(), ["alpha", "beta"], 0, 10);
  assert.equal(match.match_count, 3);
});

test("overlapping context ranges merge into one snippet", () => {
  const [match] = searchEntries(
    root,
    entries().filter((e) => e.slug === "log"),
    ["hit"],
    1,
    10,
  );
  assert.equal(match.snippets.length, 1);
  assert.equal(match.snippets[0].line, 2);
  assert.ok(match.snippets[0].text.includes("ctx-a"));
  assert.ok(match.snippets[0].text.includes("ctx-b"));
});

test("overlap extension still runs at the snippet cap (F-006)", () => {
  const [match] = searchEntries(
    root,
    entries().filter((e) => e.slug === "log"),
    ["hit"],
    1,
    1,
  );
  assert.equal(match.snippets.length, 1);
  assert.ok(
    match.snippets[0].text.includes("ctx-b"),
    "second overlapping match must extend the capped snippet instead of being dropped",
  );
});
