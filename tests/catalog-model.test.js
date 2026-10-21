// Unit tests for catalog-model.js (the public Courses catalog), plus a source
// check that the catalog never names a course (Node's built-in runner):
//   node --test tests/catalog-model.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const M = require("../catalog-model.js");

// ---------------------------------------------------------------- fixtures
const cat = (slug, position, title) => ({ id: "cat-" + slug, slug, title: title || "Title " + slug, position });
const INS = cat("cat-one", 1, "First Category");
const SEC = cat("cat-two", 2, "Second Category");
let seq = 0;
function row(slug, extra) {
  return Object.assign({
    id: "id-" + slug + "-" + (++seq), slug, title: "Course " + slug, short_label: null, description: null, hours: null,
    identity: null, identity_secondary: null, position: 1, published: true, category: INS,
  }, extra || {});
}
const SIGNED_OUT = { kind: "signed-out" };
const ADMIN = { kind: "admin" };
const student = (rows) => ({ kind: "student", access: { enrolledCourseIds: new Set(rows.map((r) => r.id)) } });
const FAILED = { kind: "student", accessFailed: true };
const slugs = (catalog) => catalog.groups.flatMap((g) => g.courses.map((c) => c.slug));
const actions = (catalog) => catalog.groups.flatMap((g) => g.courses.map((c) => c.action));

// ---------------------------------------------------------------- course counts
for (const n of [0, 1, 2, 3, 5, 8]) {
  test(`catalog: ${n} published course(s) in one category`, () => {
    const rows = Array.from({ length: n }, (_, i) => row("course-" + i, { position: i + 1 }));
    const c = M.buildCatalog(rows, SIGNED_OUT);
    assert.equal(c.total, n);
    assert.equal(c.groups.length, n ? 1 : 0, "a category appears only with a published course");
    assert.deepEqual(slugs(c), rows.map((r) => r.slug));
    if (n) assert.equal(c.groups[0].title, "First Category");
  });
}

// ---------------------------------------------------------------- ordering and grouping
test("order: category position, then course position, then title, then slug", () => {
  const rows = [
    row("z", { title: "Zeta", position: 1, category: SEC }),
    row("b", { title: "Beta", position: 2 }),
    row("a2", { title: "Alpha", position: 1 }),
    row("a1", { title: "Alpha", position: 1 }),
    row("c0", { title: "Gamma", position: 0 }),
  ];
  const c = M.buildCatalog(rows, SIGNED_OUT);
  assert.deepEqual(c.groups.map((g) => g.title), ["First Category", "Second Category"]);
  assert.deepEqual(c.groups[0].courses.map((x) => x.slug), ["c0", "a1", "a2", "b"]);
  assert.deepEqual(c.groups[1].courses.map((x) => x.slug), ["z"]);
});

test("order does not depend on input order", () => {
  const rows = [row("x3", { position: 3 }), row("x1", { position: 1, category: SEC }), row("x2", { position: 2 })];
  const a = slugs(M.buildCatalog(rows, SIGNED_OUT));
  const b = slugs(M.buildCatalog(rows.slice().reverse(), SIGNED_OUT));
  assert.deepEqual(a, ["x2", "x3", "x1"]);
  assert.deepEqual(a, b);
});

test("multiple categories by category position; a category with no published course is omitted", () => {
  const rows = [row("p1", { category: SEC }), row("p2"), row("draft-only", { published: false, category: cat("cat-three", 0, "Third") })];
  const c = M.buildCatalog(rows, SIGNED_OUT);
  assert.deepEqual(c.groups.map((g) => g.title), ["First Category", "Second Category"]);
  assert.equal(c.total, 2);
});

test("uncategorized published courses come last under Other courses", () => {
  const rows = [row("u", { category: null, position: 0 }), row("k", { category: SEC })];
  const c = M.buildCatalog(rows, SIGNED_OUT);
  assert.deepEqual(c.groups.map((g) => g.title), ["Second Category", M.OTHER_TITLE]);
  assert.equal(M.OTHER_TITLE, "Other courses");
  assert.deepEqual(c.groups[1].courses.map((x) => x.slug), ["u"]);
});

test("future data: an unknown course in a known category and one in an unknown category", () => {
  const future = cat("future-category", 7, "Future Category");
  const rows = [row("known-a"), row("brand-new", { position: 2 }), row("elsewhere", { category: future })];
  const c = M.buildCatalog(rows, SIGNED_OUT);
  assert.deepEqual(c.groups.map((g) => [g.title, g.courses.map((x) => x.slug)]), [
    ["First Category", ["known-a", "brand-new"]],
    ["Future Category", ["elsewhere"]],
  ]);
});

test("published filter: a draft row passed in is defensively excluded", () => {
  const rows = [row("pub"), row("draft", { published: false }), row("odd", { published: "true" }), row("nul", { published: null })];
  const c = M.buildCatalog(rows, ADMIN);
  assert.deepEqual(slugs(c), ["pub"]);
  assert.equal(c.total, 1);
});

test("rows without a slug or null rows are ignored", () => {
  const c = M.buildCatalog([null, row("ok"), Object.assign(row("x"), { slug: "" })], SIGNED_OUT);
  assert.deepEqual(slugs(c), ["ok"]);
});

// ---------------------------------------------------------------- card fields
test("card: hours NULL shows Self-paced; integer and fractional hours use the shared rule", () => {
  const [a, b, d] = M.buildCatalog([row("h0"), row("h1", { position: 2, hours: "20.0" }), row("h2", { position: 3, hours: 7.5 })], SIGNED_OUT).groups[0].courses;
  assert.equal(a.meta, "Self-paced");
  assert.equal(b.meta, "20 course hours · Self-paced");
  assert.equal(d.meta, "7.5 course hours · Self-paced");
});

test("card: description shown exactly when present, left out when null or blank", () => {
  const text = "Covers the exam outline, from basics to review. It's plain text & stays plain.";
  const [withD, without, blank] = M.buildCatalog([row("d1", { description: text }), row("d2", { position: 2 }), row("d3", { position: 3, description: "   " })], SIGNED_OUT).groups[0].courses;
  assert.equal(withD.description, text);
  assert.equal(without.description, null);
  assert.equal(blank.description, null);
});

test("card: short label when present; identity passed through; only stored fields", () => {
  const card = M.buildCard(row("lab", { short_label: " Label ", identity: "violet", identity_secondary: "cobalt" }), SIGNED_OUT);
  assert.equal(card.label, "Label");
  assert.equal(card.identity, "violet");
  assert.equal(card.identity_secondary, "cobalt");
  assert.deepEqual(Object.keys(card).sort(), ["action", "description", "id", "identity", "identity_secondary", "label", "meta", "slug", "title"]);
  assert.equal(M.buildCard(row("nolab"), SIGNED_OUT).label, null);
});

// ---------------------------------------------------------------- CTA matrix
test("CTA: signed out gets status text, never a link or a fake button", () => {
  const c = M.buildCatalog([row("a"), row("b", { position: 2 })], SIGNED_OUT);
  actions(c).forEach((a) => assert.deepEqual(a, { type: "status", text: "Enrollment opens soon" }));
  assert.deepEqual(c.account, { text: "Already enrolled? Log in", href: "login.html" });
});

test("CTA: an enrolled student gets Open course with the course link", () => {
  const rows = [row("my-course"), row("other", { position: 2 })];
  const c = M.buildCatalog(rows, student(rows));
  actions(c).forEach((a, i) => assert.deepEqual(a, { type: "link", text: "Open course", href: "course.html?course=" + rows[i].slug }));
  assert.deepEqual(c.account, { text: "Go to your Dashboard", href: "dashboard.html" });
});

test("CTA: partial enrollment; a not-enrolled course never gets Open course", () => {
  const rows = [row("in"), row("out", { position: 2 })];
  const [a, b] = actions(M.buildCatalog(rows, student([rows[0]])));
  assert.equal(a.text, "Open course");
  assert.deepEqual(b, { type: "status", text: "Enrollment opens soon" });
});

test("CTA: zero enrollments shows every published course, with no Open course", () => {
  const rows = [row("a"), row("b", { position: 2 }), row("c", { position: 3 })];
  const c = M.buildCatalog(rows, student([]));
  assert.equal(c.total, 3);
  actions(c).forEach((a) => assert.equal(a.type, "status"));
});

test("CTA: admin gets Open course for every published course; drafts are still excluded", () => {
  const rows = [row("a"), row("b", { position: 2 }), row("hidden-draft", { published: false })];
  const c = M.buildCatalog(rows, ADMIN);
  assert.deepEqual(slugs(c), ["a", "b"]);
  actions(c).forEach((a) => assert.equal(a.text, "Open course"));
  assert.deepEqual(c.account, { text: "Go to your Dashboard", href: "dashboard.html" });
});

test("CTA: enrollment read failed -> neutral Dashboard link, never Open course, never 'not enrolled'", () => {
  const c = M.buildCatalog([row("a"), row("b", { position: 2 })], FAILED);
  actions(c).forEach((a) => assert.deepEqual(a, { type: "link", text: "Go to your Dashboard", href: "dashboard.html" }));
});

test("CTA: a student with missing or invalid access is treated as unknown (Dashboard link)", () => {
  [{ kind: "student" }, { kind: "student", access: null }, { kind: "student", access: { enrolledCourseIds: ["x"] } }].forEach((v) => {
    const a = M.cardAction(row("a"), v);
    assert.equal(a.text, "Go to your Dashboard");
  });
});

test("CTA: session failure (or any unknown viewer) is presented as signed out", () => {
  [null, undefined, {}, { kind: "guest" }, { kind: "signed-out", access: { enrolledCourseIds: new Set(["x"]) } }].forEach((v) => {
    assert.deepEqual(M.cardAction(row("a"), v), { type: "status", text: "Enrollment opens soon" });
    assert.deepEqual(M.accountLink(v), { text: "Already enrolled? Log in", href: "login.html" });
  });
});

test("CTA: the course link encodes the slug", () => {
  assert.equal(M.cardAction(row("a b/c"), ADMIN).href, "course.html?course=a%20b%2Fc");
});

// ---------------------------------------------------------------- no hard-coded course list
test("source: catalog-model.js and catalog.js contain no course slug, course name or category literal", () => {
  const banned = [/["'`]life["'`]/, /["'`]health["'`]/, /life-health-combo/, /series-6/, /series-63/, /insurance-licensing/, /securities-exams/,
    /Life Insurance/, /Health Insurance/, /Life & Health/, /Series 6/, /Insurance Licensing/, /Securities Exams/, /\$\s?\d/, /Best value/i, /course hours/];
  for (const f of ["catalog-model.js", "catalog.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    banned.forEach((re) => assert.ok(!re.test(src), `${f} must not contain ${re}`));
    assert.ok(!/switch\s*\(/.test(src), `${f} has no switch statement`);
    assert.ok(!/\.length\s*===?\s*[1-9]/.test(src), `${f} has no course-count branch`);
    assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src), `${f} never writes HTML`);
  }
});

// The obsolete static catalog (prices, savings, fixed hours, the comparison
// table, the price sum and the disabled enrollment buttons) must not come back
// on the Courses page. Scoped to the Phase 10 catalog files only: other pages
// (index.html, checkout.html) are outside this phase.
test("source: no obsolete static catalog pricing or structure on the Courses page", () => {
  const banned = [
    /\$149/, /\$249/, /\$298/, /Save \$49/i, /Best value/i, /20 course hours/i, /40 course hours/i,
    /Enrollment Coming Soon/i, /btn-coming-soon/, /catalog-table/, /catalog-sum/, /catalog-compare/,
    /catalog-specimen/, /catalog-op--/, /catalog-chip/, /catalog-price/, /catalog-savings/, /catalog-best/,
  ];
  for (const f of ["courses.html", "courses.css", "catalog-model.js", "catalog.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    banned.forEach((re) => assert.ok(!re.test(src), `${f} must not contain ${re}`));
  }
  // The catalog is rendered from data into its mount; no static course card remains.
  const html = fs.readFileSync(path.join(__dirname, "..", "courses.html"), "utf8");
  assert.ok(html.includes('id="catalogList"'), "courses.html has the catalog mount");
  assert.ok(!/<article\b/i.test(html), "courses.html contains no static course <article>");
  assert.ok(!/<table\b/i.test(html), "courses.html contains no comparison table");
  assert.ok(!/<(button|a)\b[^>]*\bdisabled\b/i.test(html), "courses.html contains no disabled control");
});

test("source: the catalog reads no course content tables", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "catalog.js"), "utf8");
  ["modules", "lessons", "practice_questions", "study_guide_sections", "lesson_progress", ".from("].forEach((t) => assert.ok(!src.includes(t), `catalog.js must not reference ${t}`));
});
