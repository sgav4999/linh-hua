// Public offering vs learning access (2026-11 owner direction: offer Life & Health Combo, SIE, Series 6
// and Series 63 to new customers; take the individual Life and Health courses off the public list while
// their enrolled students keep everything). The public list is data-driven (courses.listed); learning
// access stays "published and enrolled" (or admin) and never reads the listing flag.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../courses-data.js");
const Home = require("../home-model.js");
const Catalog = require("../catalog-model.js");
const Dash = require("../dashboard-model.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

// Production-shaped rows: two categories, six published courses, Life and Health not listed.
const INS = { id: "cat-ins", slug: "insurance-licensing", title: "Insurance Licensing", position: 1 };
const SEC = { id: "cat-sec", slug: "securities-exams", title: "Securities Exams", position: 2 };
const row = (slug, title, category, position, listed) => ({
  id: "id-" + slug, slug, title, short_label: null, category_id: category.id, position, published: true, listed,
  identity: null, identity_secondary: null, hours: null, description: null, category,
});
const SIX = [
  row("life", "Life Insurance License", INS, 1, false),
  row("health", "Health Insurance License", INS, 2, false),
  row("life-health-combo", "Life & Health Combo", INS, 3, true),
  row("series-63", "Series 63", SEC, 1, true),
  row("series-6", "Series 6", SEC, 2, true),
  row("sie", "SIE", SEC, 3, true),
];

// A recording stand-in for the Supabase client query builder.
function recorder(rows) {
  const calls = [];
  const builder = (table) => {
    const q = {
      select(cols) { calls.push(["select", table, cols]); return q; },
      eq(col, val) { calls.push(["eq", table, col, val]); return q; },
      in(col, val) { calls.push(["in", table, col, val]); return q; },
      order() { return q; },
      range() { return q; },
      maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
      then(ok, bad) { return Promise.resolve({ data: rows, error: null }).then(ok, bad); },
    };
    return q;
  };
  return { calls, client: { from: (t) => { calls.push(["from", t]); return builder(t); }, auth: { getSession: async () => ({ data: { session: null } }) } } };
}
async function withClient(client, fn) {
  global.supabaseClient = client;
  try { return await fn(); } finally { delete global.supabaseClient; }
}
const filters = (calls) => calls.filter((c) => c[0] === "eq").map((c) => c[2] + "=" + c[3]);

test("loadOfferedCourses reads published AND listed courses (the public offering)", async () => {
  const r = recorder(SIX.filter((x) => x.listed));
  const out = await withClient(r.client, () => C.loadOfferedCourses());
  assert.deepEqual(filters(r.calls), ["published=true", "listed=true"]);
  assert.ok(r.calls.find((c) => c[0] === "select")[2].includes("listed"), "selects the listing flag");
  assert.deepEqual(out.map((x) => x.slug), ["life-health-combo", "series-63", "series-6", "sie"]);
});

test("the old unfiltered public read is gone, so no page can list a course by accident", () => {
  assert.equal(C.loadPublishedCourses, undefined);
  for (const f of ["catalog.js", "home-courses.js"]) {
    assert.match(read(f), /loadOfferedCourses\(\)/, f + " uses the offered read");
    assert.doesNotMatch(read(f), /loadPublishedCourses/, f);
  }
});

test("learning-access and Dashboard reads never filter on the listing flag", async () => {
  for (const [name, call] of [
    ["loadDashboardCourses", () => C.loadDashboardCourses()],
    ["loadAllCourses", () => C.loadAllCourses()],
    ["loadCourseBySlug", () => C.loadCourseBySlug("life")],
  ]) {
    const r = recorder(SIX);
    await withClient(r.client, call).catch(() => null);
    assert.ok(!filters(r.calls).some((f) => f.startsWith("listed")), name + " must not filter on listed");
    assert.ok(!r.calls.some((c) => c[0] === "select" && /\blisted\b/.test(c[2])), name + " must not depend on the listed column");
  }
  const src = read("courses-data.js");
  const access = src.slice(src.indexOf("function canAccessCourse"), src.indexOf("function canAccessCourse") + 400);
  assert.doesNotMatch(access, /listed/, "canAccessCourse ignores the listing flag");
});

test("an enrolled student keeps access to a course that is no longer listed", () => {
  const life = SIX[0];
  assert.equal(life.listed, false);
  assert.equal(C.canAccessCourse(life, { enrolledCourseIds: new Set([life.id]) }), true);
  assert.equal(C.canAccessCourse(life, { enrolledCourseIds: new Set() }), false, "not enrolled: no access");
});

test("homepage preview from the real selector: Combo, Series 63, Series 6 (four offered courses, two categories)", () => {
  const offered = SIX.filter((x) => x.listed);
  const p = Home.selectPreview(offered);
  assert.deepEqual(p.items.map((x) => x.slug), ["life-health-combo", "series-63", "series-6"]);
  assert.equal(p.total, 4);
  assert.equal(p.categoryCount, 2);
  // the generic listing rule also holds if unlisted rows ever reach the selector
  assert.deepEqual(Home.selectPreview(SIX).items.map((x) => x.slug), ["life-health-combo", "series-63", "series-6"]);
  assert.equal(Home.selectPreview(SIX).total, 4);
});

test("catalog: exactly the four offered courses, in category then course order", () => {
  for (const rows of [SIX.filter((x) => x.listed), SIX]) {
    const cat = Catalog.buildCatalog(rows, null);
    assert.equal(cat.total, 4);
    assert.deepEqual(cat.groups.map((g) => [g.slug, g.courses.map((c) => c.title)]), [
      ["insurance-licensing", ["Life & Health Combo"]],
      ["securities-exams", ["Series 63", "Series 6", "SIE"]],
    ]);
  }
});

test("Dashboard: a student enrolled in Life and Health still sees both (listing is not access)", () => {
  const rows = SIX.map((r) => Object.assign({}, r, { study_guide_released: false, study_guide_sections: [], modules: [{ id: r.slug + "-m1", title: "M1", position: 1, lessons: [{ id: r.slug + "-l1", title: "L1", position: 1 }] }] }));
  const enrolled = new Set([rows[0].id, rows[1].id]);
  const desk = Dash.buildDesk(rows, [], { enrolledCourseIds: enrolled });
  assert.deepEqual(desk.map((c) => c.slug), ["life", "health"]);
  // no code reference to the listing field (the word may appear in prose comments)
  assert.doesNotMatch(read("dashboard-model.js"), /\.listed\b|["']listed["']/);
  assert.doesNotMatch(read("dashboard.js"), /\.listed\b|["']listed["']/);
});

test("selectors stay generic: no course or category is named in the public renderers or models", () => {
  for (const f of ["home-model.js", "home-courses.js", "catalog-model.js", "catalog.js"]) {
    assert.doesNotMatch(read(f), /["'](life|health|life-health-combo|series-6|series-63|sie)["']/, f);
  }
});

test("cache references updated only where the offered read is used", () => {
  const index = read("index.html"), courses = read("courses.html");
  for (const s of ["courses-data", "home-model", "home-courses"]) assert.match(index, new RegExp(`<script src="${s}\\.js\\?v=20261121o1"></script>`));
  for (const s of ["courses-data", "catalog-model", "catalog"]) assert.match(courses, new RegExp(`<script src="${s}\\.js\\?v=20261121o1"></script>`));
});
