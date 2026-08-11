import assert from "node:assert/strict";
import { test } from "node:test";
import { paginate } from "../src/respond.js";

const items = Array.from({ length: 10 }, (_, i) => i);

test("paginate returns a window with pagination metadata", () => {
  const page = paginate(items, 3, 0);
  assert.deepEqual(page.items, [0, 1, 2]);
  assert.equal(page.total, 10);
  assert.equal(page.count, 3);
  assert.equal(page.has_more, true);
  assert.equal(page.next_offset, 3);
});

test("paginate handles the final partial page", () => {
  const page = paginate(items, 3, 9);
  assert.deepEqual(page.items, [9]);
  assert.equal(page.has_more, false);
  assert.equal(page.next_offset, undefined);
});

test("paginate handles an offset past the end", () => {
  const page = paginate(items, 3, 50);
  assert.deepEqual(page.items, []);
  assert.equal(page.count, 0);
  assert.equal(page.has_more, false);
});
