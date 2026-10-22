// Unit tests for home-model.js (the homepage course preview), plus a source
// check that the model never names a course or a category (Node's built-in runner):
//   node --test tests/home-model.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const M = require("../home-model.js");

// ---------------------------------------------------------------- fixtures
const cat = (slug, position) => ({ id: "cat-" + slug, slug, title: "Title " + slug, position });
const A = cat("alpha", 1);
const B = cat("beta", 2);
const C = cat("gamma", 3);
function row(slug, category, position, extra) {
  return Object.assign({
    id: "id-" + slug, slug, title: "Course " + slug, short_label: null, description: null, hours: null,
    identity: null, identity_secondary: null, position, published: true, category,
  }, extra || {});
}
// n courses in a category, positions 1..n, slugs <prefix>1..<prefix>n
const many = (prefix, category, n) => Array.from({ length: n }, (_, i) => row(prefix + (i + 1), category, i + 1));
const slugs = (preview) => preview.items.map((r) => r.slug);
// A fixed, non-sorted arrangement of the same rows
const scramble = (rows) => rows.map((r, i) => [r, (i * 7 + 3) % rows.length]).sort((x, y) => x[1] - y[1]).map((x) => x[0]);

// ---------------------------------------------------------------- A. current shape
test("A: 3 published courses in one category: all 3, in catalog order", () => {
  const p = M.selectPreview(many("a", A, 3));
  assert.deepEqual(slugs(p), ["a1", "a2", "a3"]);
  assert.equal(p.total, 3);
  assert.equal(p.categoryCount, 1);
});

// ---------------------------------------------------------------- B. category fairness
test("B: 3 in category A + 1 in category B, cap 3: A1, B1, A2", () => {
  const p = M.selectPreview([...many("a", A, 3), ...many("b", B, 1)], 3);
  assert.deepEqual(slugs(p), ["a1", "b1", "a2"]);
  assert.equal(p.total, 4);
  assert.equal(p.categoryCount, 2);
});

// ---------------------------------------------------------------- C. three categories
test("C: courses across 3 categories, cap 3: the first course of each", () => {
  const p = M.selectPreview([...many("a", A, 3), ...many("b", B, 2), ...many("c", C, 1)], 3);
  assert.deepEqual(slugs(p), ["a1", "b1", "c1"]);
  assert.equal(p.total, 6);
  assert.equal(p.categoryCount, 3);
});

// ---------------------------------------------------------------- D. multiple rounds
test("D: cap above the category count continues round-robin into the second round", () => {
  const rows = [...many("a", A, 3), ...many("b", B, 2), ...many("c", C, 1)];
  assert.deepEqual(slugs(M.selectPreview(rows, 5)), ["a1", "b1", "c1", "a2", "b2"]);
  assert.deepEqual(slugs(M.selectPreview(rows, 6)), ["a1", "b1", "c1", "a2", "b2", "a3"]);
  // A category that runs out is skipped in later rounds
  assert.deepEqual(slugs(M.selectPreview(rows, 4)), ["a1", "b1", "c1", "a2"]);
});

// ---------------------------------------------------------------- E / F. 5 and 8 courses
test("E: 5 courses across 2 categories: 3 shown, round-robin", () => {
  const p = M.selectPreview([...many("a", A, 3), ...many("b", B, 2)]);
  assert.deepEqual(slugs(p), ["a1", "b1", "a2"]);
  assert.equal(p.total, 5);
  assert.equal(p.categoryCount, 2);
});

test("F: 8 courses across 2 categories: still only 3 shown", () => {
  const p = M.selectPreview([...many("a", A, 4), ...many("b", B, 4)]);
  assert.deepEqual(slugs(p), ["a1", "b1", "a2"]);
  assert.equal(p.total, 8);
  assert.equal(p.categoryCount, 2);
});

test("F: 8 courses where the second category sorts first by position", () => {
  const first = cat("zeta", 0);
  const p = M.selectPreview([...many("a", A, 4), ...many("z", first, 4)]);
  assert.deepEqual(slugs(p), ["z1", "a1", "z2"], "category order follows the shared catalog order, not input or name");
});

// ---------------------------------------------------------------- G. unknown category
test("G: an unseen category with arbitrary data is grouped like any other", () => {
  const novel = { id: "9f0c", slug: "brand-new-family", title: "Something Never Seen", position: 7 };
  const p = M.selectPreview([...many("a", A, 2), row("x-1", novel, 1), row("x-2", novel, 2)]);
  assert.deepEqual(slugs(p), ["a1", "x-1", "a2"]);
  assert.equal(p.categoryCount, 2);
});

test("G: a category identified only by slug (no id) still groups its courses", () => {
  const slugOnly = { slug: "slug-only", title: "T", position: 2 };
  const p = M.selectPreview([...many("a", A, 2), row("s1", slugOnly, 1), row("s2", slugOnly, 2)], 4);
  assert.deepEqual(slugs(p), ["a1", "s1", "a2", "s2"]);
  assert.equal(p.categoryCount, 2);
});

// ---------------------------------------------------------------- H. uncategorised
test("H: uncategorised courses form the last group and are not counted as a category", () => {
  const rows = [row("u1", null, 1), row("u2", undefined, 2), ...many("a", A, 2), ...many("b", B, 1)];
  const p = M.selectPreview(rows, 5);
  assert.deepEqual(slugs(p), ["a1", "b1", "u1", "a2", "u2"]);
  assert.equal(p.total, 5);
  assert.equal(p.categoryCount, 2);
});

test("H: only uncategorised courses: catalog order, categoryCount 0", () => {
  const p = M.selectPreview([row("u2", null, 2), row("u1", null, 1)]);
  assert.deepEqual(slugs(p), ["u1", "u2"]);
  assert.equal(p.categoryCount, 0);
});

// ---------------------------------------------------------------- I / J / K. filtering
test("I: drafts (published false or missing) are excluded even when passed in", () => {
  const rows = [row("a1", A, 1), row("a2", A, 2, { published: false }), row("a3", A, 3, { published: undefined }), row("b1", B, 1, { published: false })];
  const p = M.selectPreview(rows);
  assert.deepEqual(slugs(p), ["a1"]);
  assert.equal(p.total, 1);
  assert.equal(p.categoryCount, 1, "a category with only drafts is not represented");
});

test("J: published must be the boolean true (\"true\", 1 and truthy objects are excluded)", () => {
  const rows = [row("a1", A, 1, { published: "true" }), row("a2", A, 2, { published: 1 }), row("a3", A, 3, { published: {} }), row("a4", A, 4)];
  assert.deepEqual(slugs(M.selectPreview(rows)), ["a4"]);
});

test("K: rows without a usable slug are excluded; null and non-object rows are ignored", () => {
  const rows = [null, undefined, 0, "row", row("a1", A, 1), row("", A, 2), row("   ", A, 3), row(null, A, 4), row(42, A, 5), Object.assign(row("x", A, 6), { slug: undefined })];
  const p = M.selectPreview(rows);
  assert.deepEqual(slugs(p), ["a1"]);
  assert.equal(p.total, 1);
});

test("K: a non-array input is treated as no courses", () => {
  for (const bad of [null, undefined, {}, "rows", 3]) assert.deepEqual(M.selectPreview(bad), { items: [], total: 0, categoryCount: 0 });
});

// ---------------------------------------------------------------- L. order independence
test("L: input order does not change the output", () => {
  const rows = [...many("a", A, 3), ...many("b", B, 2), ...many("c", C, 2), row("u1", null, 1)];
  const expected = slugs(M.selectPreview(rows, 8));
  assert.deepEqual(expected, ["a1", "b1", "c1", "u1", "a2", "b2", "c2", "a3"]);
  for (const arranged of [rows.slice().reverse(), scramble(rows), scramble(rows.slice().reverse())]) {
    assert.deepEqual(slugs(M.selectPreview(arranged, 8)), expected);
    assert.deepEqual(slugs(M.selectPreview(arranged)), expected.slice(0, 3));
  }
});

test("L: ties inside a category fall back to the shared order (title, then slug)", () => {
  const rows = [row("q-b", A, 1, { title: "Same" }), row("q-a", A, 1, { title: "Same" }), row("p", A, 1, { title: "Earlier" })];
  assert.deepEqual(slugs(M.selectPreview(rows)), ["p", "q-a", "q-b"]);
});

// ---------------------------------------------------------------- M. immutability
test("M: the input array and rows are not changed; items are the caller's rows", () => {
  const rows = scramble([...many("a", A, 3), ...many("b", B, 2), row("d", B, 3, { published: false })]);
  const before = JSON.stringify(rows);
  const order = rows.slice();
  const p = M.selectPreview(rows);
  assert.equal(JSON.stringify(rows), before);
  rows.forEach((r, i) => assert.equal(r, order[i], "array order unchanged"));
  p.items.forEach((item) => assert.ok(rows.includes(item), "an item is one of the supplied rows"));
  assert.notEqual(p.items, rows);
});

test("M: frozen input is accepted", () => {
  const rows = Object.freeze([...many("a", A, 2), ...many("b", B, 1)].map(Object.freeze));
  assert.deepEqual(slugs(M.selectPreview(rows)), ["a1", "b1", "a2"]);
});

// ---------------------------------------------------------------- N / O / P. small counts
test("N: zero courses", () => {
  assert.deepEqual(M.selectPreview([]), { items: [], total: 0, categoryCount: 0 });
});

test("O: one course", () => {
  const p = M.selectPreview([row("only", A, 1)]);
  assert.deepEqual(slugs(p), ["only"]);
  assert.equal(p.total, 1);
  assert.equal(p.categoryCount, 1);
});

test("P: two courses, in one category and in two", () => {
  assert.deepEqual(slugs(M.selectPreview(many("a", A, 2))), ["a1", "a2"]);
  const p = M.selectPreview([row("b1", B, 1), row("a1", A, 1)]);
  assert.deepEqual(slugs(p), ["a1", "b1"]);
  assert.equal(p.categoryCount, 2);
});

// ---------------------------------------------------------------- Q. cap
test("Q: default cap is 3", () => {
  assert.equal(M.DEFAULT_CAP, 3);
  assert.equal(M.selectPreview(many("a", A, 8)).items.length, 3);
});

test("Q: explicit caps 1, 2 and above the total", () => {
  const rows = [...many("a", A, 3), ...many("b", B, 1)];
  assert.deepEqual(slugs(M.selectPreview(rows, 1)), ["a1"]);
  assert.deepEqual(slugs(M.selectPreview(rows, 2)), ["a1", "b1"]);
  assert.deepEqual(slugs(M.selectPreview(rows, 10)), ["a1", "b1", "a2", "a3"]);
});

test("Q: a cap that is not a positive whole number falls back to the default (3)", () => {
  const rows = many("a", A, 5);
  for (const bad of [undefined, null, 0, -1, 2.5, NaN, Infinity, "2", "abc", {}, true]) {
    assert.deepEqual(slugs(M.selectPreview(rows, bad)), ["a1", "a2", "a3"], "cap " + String(bad));
  }
});

test("Q: total and categoryCount do not depend on the cap", () => {
  const rows = [...many("a", A, 3), ...many("b", B, 2), ...many("c", C, 1)];
  for (const cap of [1, 3, 99]) {
    const p = M.selectPreview(rows, cap);
    assert.equal(p.total, 6);
    assert.equal(p.categoryCount, 3);
  }
});

// ---------------------------------------------------------------- R. source scans
const SOURCE = fs.readFileSync(path.join(__dirname, "..", "home-model.js"), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");

test("R: no current course slug appears as a string literal", () => {
  for (const s of ["life", "health", "life-health-combo", "series-6", "series-63"]) {
    assert.doesNotMatch(SOURCE, new RegExp("[\"'`]" + s + "[\"'`]", "i"), s);
  }
});

test("R: no current course or category name appears anywhere in the file", () => {
  for (const name of ["Life Insurance License", "Health Insurance License", "Life & Health Combo", "Life &amp; Health Combo", "Insurance Licensing", "Securities Exams", "Series 6", "Series 63", "SIE"]) {
    assert.ok(!SOURCE.includes(name), name);
  }
});

test("R: no switch, fixed three-row branch or plain first-three slice", () => {
  assert.doesNotMatch(CODE, /\bswitch\s*\(/);
  assert.doesNotMatch(CODE, /\.length\s*[=!]==?\s*3\b/);
  assert.doesNotMatch(CODE, /\.slice\(\s*0\s*,\s*3\s*\)/);
  assert.doesNotMatch(CODE, /\bcase\s+["'`]/);
  // 3 appears exactly once in code: the generic cap
  assert.deepEqual(CODE.match(/\b3\b/g), ["3"]);
  assert.match(CODE, /DEFAULT_CAP\s*=\s*3\b/);
});

test("R: pure: no DOM, network or storage access, and the shared order is reused", () => {
  for (const banned of [/\bdocument\b/, /\bwindow\b/, /supabaseClient/, /\.from\(\s*["'`]/, /\bfetch\(/, /localStorage/, /innerHTML/]) {
    assert.doesNotMatch(CODE, banned, String(banned));
  }
  assert.match(CODE, /Courses\.byCatalogOrder/);
  assert.doesNotMatch(CODE, /localeCompare|\.position\b/, "ordering is not re-implemented");
});
