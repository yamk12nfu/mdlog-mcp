import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { filterEntries, isKnownEntry, resolveEntryPath, scanEntries } from "../src/core/scan.js";
import { isValidCalendarDate } from "../src/core/dates.js";

const base = mkdtempSync(path.join(tmpdir(), "mdlog-scan-"));
const root = path.join(base, "root");
const outside = path.join(base, "outside");

mkdirSync(root);
mkdirSync(outside);
writeFileSync(path.join(outside, "secret.md"), "# Secret\ntop secret");
// Dated content outside the root: the pre-fix scanner would have picked
// these up through the symlinks below, so they catch real regressions.
writeFileSync(path.join(outside, "2026-01-01-evil.md"), "# Evil\nexfiltrated");

writeFileSync(path.join(root, "2026-08-10-alpha-digest.md"), "# Alpha Ten\nvercel incident notes");
mkdirSync(path.join(root, "2026-08-11"));
writeFileSync(path.join(root, "2026-08-11", "beta.md"), "# Beta Eleven\nmore notes");
mkdirSync(path.join(root, "weekly"));
writeFileSync(path.join(root, "weekly", "2026-08-04-weekly-review.md"), "# Weekly Review\nsummary");
writeFileSync(path.join(root, "2026-99-99-bad.md"), "# Bad Date");
mkdirSync(path.join(root, "2026-02-30"));
writeFileSync(path.join(root, "2026-02-30", "nested.md"), "# Impossible Date Dir");
mkdirSync(path.join(root, "2026-05-01", "2026-05-02"), { recursive: true });
writeFileSync(path.join(root, "2026-05-01", "2026-05-02", "deep.md"), "# Deep Entry");
writeFileSync(path.join(root, "notes.md"), "# Undated");
writeFileSync(path.join(root, "2026-06-06-longtitle.md"), `# ${"T".repeat(400)}\nbody`);
symlinkSync(outside, path.join(root, "linkdir"));
symlinkSync(outside, path.join(root, "2026-03-03"));
symlinkSync(path.join(outside, "secret.md"), path.join(root, "2026-04-04-leak.md"));
symlinkSync(root, path.join(root, "loop"));

after(() => rmSync(base, { recursive: true, force: true }));

test("isValidCalendarDate rejects impossible dates", () => {
  assert.equal(isValidCalendarDate("2026-08-10"), true);
  assert.equal(isValidCalendarDate("2026-99-99"), false);
  assert.equal(isValidCalendarDate("2026-02-30"), false);
  assert.equal(isValidCalendarDate("2024-02-29"), true);
  assert.equal(isValidCalendarDate("not-a-date"), false);
  assert.equal(isValidCalendarDate("0099-01-01"), true);
  assert.equal(isValidCalendarDate("0004-02-29"), true);
});

test("scanEntries finds dated entries in all layouts, newest first", () => {
  const entries = scanEntries(root);
  assert.deepEqual(
    entries.map((e) => [e.date, e.path]),
    [
      ["2026-08-11", "2026-08-11/beta.md"],
      ["2026-08-10", "2026-08-10-alpha-digest.md"],
      ["2026-08-04", "weekly/2026-08-04-weekly-review.md"],
      ["2026-06-06", "2026-06-06-longtitle.md"],
      ["2026-05-02", "2026-05-01/2026-05-02/deep.md"],
    ],
  );
});

test("nested dated directories use the nearest date (F-008)", () => {
  const deep = scanEntries(root).find((e) => e.slug === "deep");
  assert.ok(deep);
  assert.equal(deep.date, "2026-05-02");
  assert.equal(deep.category, "");
});

test("invalid calendar dates are skipped (F-007)", () => {
  const paths = scanEntries(root).map((e) => e.path);
  assert.ok(!paths.some((p) => p.includes("2026-99-99")));
  assert.ok(!paths.some((p) => p.includes("2026-02-30")));
});

test("symlinked files and directories are never scanned, even dated ones (F-001)", () => {
  const entries = scanEntries(root);
  const paths = entries.map((e) => e.path);
  assert.ok(!paths.some((p) => p.includes("linkdir")));
  assert.ok(!paths.some((p) => p.includes("leak")));
  assert.ok(!paths.some((p) => p.includes("evil")));
  assert.ok(!paths.some((p) => p.includes("loop")));
  // Dated symlinks are the dangerous variant: without the lstat guard the
  // scanner would list outside/secret.md under 2026-03-03/ and the dated
  // leak file, and recurse forever through loop/.
  assert.ok(!entries.some((e) => e.date === "2026-03-03" || e.date === "2026-04-04" || e.date === "2026-01-01"));
});

test("titles come from the first heading and are bounded", () => {
  const alpha = scanEntries(root).find((e) => e.slug === "alpha-digest");
  assert.equal(alpha?.title, "Alpha Ten");
  const long = scanEntries(root).find((e) => e.slug === "longtitle");
  assert.equal(long?.title.length, 300);
});

test("filterEntries applies date range, slug, and category filters", () => {
  const entries = scanEntries(root);
  assert.equal(filterEntries(entries, { from: "2026-08-01" }).length, 3);
  assert.equal(filterEntries(entries, { from: "2026-08-05", to: "2026-08-10" }).length, 1);
  assert.equal(filterEntries(entries, { slug_contains: "WEEKLY" }).length, 1);
  assert.equal(filterEntries(entries, { category: "weekly" }).length, 1);
  assert.equal(filterEntries(entries, { category: "" }).length, 4);
});

test("isKnownEntry only accepts scanned entries (F-004)", () => {
  assert.equal(isKnownEntry(root, "2026-08-11/beta.md"), true);
  assert.equal(isKnownEntry(root, "./2026-08-11/beta.md"), true);
  assert.equal(isKnownEntry(root, "notes.md"), false);
  assert.equal(isKnownEntry(root, "2026-04-04-leak.md"), false);
});

test("resolveEntryPath rejects escapes, symlink escapes, and non-markdown (F-001)", () => {
  assert.ok(resolveEntryPath(root, "2026-08-10-alpha-digest.md").endsWith("2026-08-10-alpha-digest.md"));
  assert.throws(() => resolveEntryPath(root, "../outside/secret.md"), /escapes the log directory/);
  assert.throws(() => resolveEntryPath(root, "2026-04-04-leak.md"), /escapes the log directory/);
  assert.throws(() => resolveEntryPath(root, "2026-03-03/secret.md"), /escapes the log directory/);
  assert.throws(() => resolveEntryPath(root, "2026-08-11/beta.txt"), /Only \.md files/);
  assert.throws(() => resolveEntryPath(root, "2026-08-11/missing.md"), /Entry not found/);
});
