// Unit tests for dashboard-model.js and the shared course helpers it uses
// (Node's built-in runner, no dependencies):
//   node --test tests/dashboard-model.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../dashboard-model.js");
const C = require("../courses-data.js");

// ---------------------------------------------------------------- fixtures
const cat = (slug, position) => ({ id: "cat-" + slug, slug, title: slug, position });
let seq = 0;
// course(slug, [lessonsPerModule...], extra)
function course(slug, shape, extra) {
  const modules = shape.map((n, m) => ({
    id: `${slug}-m${m}`,
    title: `${slug} module ${m + 1}`,
    position: m + 1,
    lessons: Array.from({ length: n }, (_, l) => ({ id: `${slug}-m${m}-l${l}`, title: `${slug} lesson ${m + 1}.${l + 1}`, position: l + 1 })),
  }));
  return Object.assign({
    id: "id-" + slug + "-" + (++seq), slug, title: slug.toUpperCase(), short_label: null, hours: null,
    identity: null, identity_secondary: null, position: 1, published: true, study_guide_released: false,
    study_guide_sections: [], category: cat("insurance-licensing", 1), modules,
  }, extra || {});
}
const lessonIds = (row) => row.modules.flatMap((m) => m.lessons.map((l) => l.id));
const done = (ids, at) => ids.map((id, i) => ({ lesson_id: id, completed_at: at ? new Date(Date.parse(at) + i * 1000).toISOString() : "2026-10-01T00:00:00Z" }));

// ---------------------------------------------------------------- course counts and generic slugs
for (const n of [0, 1, 2, 3, 5, 8]) {
  test(`desk: ${n} published course(s) flow through the generic path`, () => {
    const rows = Array.from({ length: n }, (_, i) => course(i === n - 1 ? "sie" : "course-" + i, [2, 3], { position: i + 1 }));
    const desk = M.buildDesk(rows, []);
    assert.equal(desk.length, n);
    assert.deepEqual(desk.map((c) => c.slug), rows.map((r) => r.slug), "catalog order kept");
    const view = M.chooseView(desk);
    assert.equal(view.mode, n === 0 ? "empty" : "overview");
  });
}

test("generic future course (sie): unknown identity, no tools, normal model", () => {
  const row = course("sie", [3, 2], { identity: "teal", hours: "12.5" });
  const c = M.buildDesk([row], done(lessonIds(row).slice(0, 2), "2026-10-10T10:00:00Z"))[0];
  assert.equal(c.slug, "sie");
  assert.equal(c.identity, "teal"); // passed through; identity.css falls back to neutral for unknown tokens
  assert.equal(c.meta, "12.5 course hours · Self-paced");
  assert.deepEqual(c.tools, { studyGuide: false, practiceExam: false });
  assert.equal(c.status, "progress");
  assert.equal(c.total, 5); assert.equal(c.done, 2);
  assert.equal(M.chooseView([c]).mode, "focus");
});

// ---------------------------------------------------------------- progress states
test("status: zero lessons, modules without lessons, new, partial, complete", () => {
  const empty = course("a", []);
  const hollow = course("b", [0, 0]);
  const fresh = course("c", [2, 2]);
  const partial = course("d", [2, 2]);
  const full = course("e", [2, 1]);
  const prog = [...done(lessonIds(partial).slice(0, 1)), ...done(lessonIds(full))];
  const [a, b, c, d, e] = M.buildDesk([empty, hollow, fresh, partial, full], prog);
  assert.deepEqual([a.status, b.status, c.status, d.status, e.status], ["empty", "empty", "new", "progress", "complete"]);
  assert.equal(a.total, 0); assert.equal(b.total, 0); assert.deepEqual(b.modules, []);
  assert.equal(c.nextLesson.id, "c-m0-l0");
  assert.equal(d.nextLesson.id, "d-m0-l1");
  assert.equal(e.nextLesson, null);
  assert.equal(e.done, 3);
});

test("modules with zero lessons are dropped from segments but the course still counts", () => {
  const row = course("x", [0, 3, 0, 2]);
  const c = M.buildDesk([row], done(["x-m1-l0"]))[0];
  assert.deepEqual(c.modules.map((m) => [m.total, m.done]), [[3, 1], [2, 0]]);
  assert.equal(c.total, 5);
});

test("stale progress ids are ignored; duplicate lesson ids count once; done never exceeds total", () => {
  const row = course("y", [2, 2]);
  row.modules[1].lessons.push({ ...row.modules[0].lessons[0], position: 9 }); // same id again
  const prog = [...done(lessonIds(course("y", [2, 2]))), { lesson_id: "deleted-lesson", completed_at: "2026-10-02T00:00:00Z" }, { lesson_id: "y-m0-l0", completed_at: "2026-10-03T00:00:00Z" }];
  const c = M.buildDesk([row], prog)[0];
  assert.equal(c.total, 4);
  assert.equal(c.done, 4);
  assert.equal(c.status, "complete");
});

test("reversible completion: removing a progress row lowers the count on the next build", () => {
  const row = course("r", [3]);
  const all = done(lessonIds(row));
  assert.equal(M.buildDesk([row], all)[0].status, "complete");
  const after = M.buildDesk([row], all.filter((p) => p.lesson_id !== "r-m0-l1"))[0];
  assert.equal(after.done, 2); assert.equal(after.status, "progress"); assert.equal(after.nextLesson.id, "r-m0-l1");
});

test("module and lesson ordering by position, then id", () => {
  const row = course("o", [2, 2]);
  row.modules.reverse(); // module 2 first in the data
  row.modules.forEach((m) => m.lessons.reverse());
  row.modules[1].lessons.push({ id: "o-m0-a", title: "tie a", position: 2 }); // ties position 2 with o-m0-l1, sorts before it by id
  const c = M.buildDesk([row], [])[0];
  assert.deepEqual(c.modules.map((m) => m.title), ["o module 1", "o module 2"]);
  assert.equal(c.nextLesson.id, "o-m0-l0");
  const c2 = M.buildDesk([row], done(["o-m0-l0"]))[0];
  assert.equal(c2.nextLesson.id, "o-m0-a");
});

test("mixed courses: overview heading 'Choose where to start'; all complete: 'My courses'", () => {
  const a = course("a", [1]), b = course("b", [1]);
  assert.equal(M.chooseView(M.buildDesk([a, b], done(lessonIds(a)))).heading, "Choose where to start");
  assert.equal(M.chooseView(M.buildDesk([a, b], done([...lessonIds(a), ...lessonIds(b)]))).heading, "My courses");
});

// ---------------------------------------------------------------- focus
test("focus: several partial courses -> newest completed_at wins", () => {
  const a = course("a", [4]), b = course("b", [4]), c = course("c", [4]);
  const prog = [
    ...done(lessonIds(a).slice(0, 3), "2026-10-01T00:00:00Z"), // most done, oldest
    ...done(lessonIds(b).slice(0, 1), "2026-10-09T00:00:00Z"), // newest
    ...done(lessonIds(c).slice(0, 2), "2026-10-05T00:00:00Z"),
  ];
  const v = M.chooseView(M.buildDesk([a, b, c], prog));
  assert.equal(v.mode, "focus");
  assert.equal(v.focus.slug, "b");
  assert.deepEqual(v.others.map((x) => x.slug), ["a", "c"]);
});

test("focus: tied timestamps -> more lessons done, then catalog order", () => {
  const a = course("a", [4]), b = course("b", [4]), c = course("c", [4]);
  const t = "2026-10-05T00:00:00.000Z";
  const same = (ids) => ids.map((id) => ({ lesson_id: id, completed_at: t }));
  let v = M.chooseView(M.buildDesk([a, b, c], [...same(lessonIds(a).slice(0, 1)), ...same(lessonIds(b).slice(0, 2)), ...same(lessonIds(c).slice(0, 2))]));
  assert.equal(v.focus.slug, "b"); // b and c tie on time and count; b is earlier in catalog order
  v = M.chooseView(M.buildDesk([a, b, c], [...same(lessonIds(a).slice(0, 1)), ...same(lessonIds(b).slice(0, 1)), ...same(lessonIds(c).slice(0, 3))]));
  assert.equal(v.focus.slug, "c"); // more done
});

test("focus: missing/invalid timestamps rank below valid ones, then by count and catalog order", () => {
  const a = course("a", [4]), b = course("b", [4]), c = course("c", [4]);
  const bad = (ids) => ids.map((id) => ({ lesson_id: id, completed_at: "not a date" }));
  let v = M.chooseView(M.buildDesk([a, b, c], [...bad(lessonIds(a).slice(0, 3)), ...done(lessonIds(b).slice(0, 1), "2020-01-01T00:00:00Z"), ...bad(lessonIds(c).slice(0, 2))]));
  assert.equal(v.focus.slug, "b"); // the only valid timestamp
  v = M.chooseView(M.buildDesk([a, b, c], [...bad(lessonIds(a).slice(0, 1)), ...bad(lessonIds(b).slice(0, 2)), ...bad(lessonIds(c).slice(0, 2))]));
  assert.equal(v.focus.slug, "b"); // all unavailable: count, then catalog order
});

test("focus: completed and new courses never take focus", () => {
  const a = course("a", [2]), b = course("b", [2]), c = course("c", [2]);
  let v = M.chooseView(M.buildDesk([a, b, c], done(lessonIds(a), "2026-10-10T00:00:00Z")));
  assert.equal(v.mode, "overview"); // a complete, b and c new
  v = M.chooseView(M.buildDesk([a, b, c], [...done(lessonIds(a), "2026-10-10T00:00:00Z"), ...done(lessonIds(c).slice(0, 1), "2026-01-01T00:00:00Z")]));
  assert.equal(v.mode, "focus"); assert.equal(v.focus.slug, "c"); // the newer completion is in a complete course
});

// ---------------------------------------------------------------- tools
test("Study Guide availability: legacy courses, released authored guides with visible sections, none otherwise", () => {
  const legacy = course("life", [1]);
  const authored = course("series-x", [1], { study_guide_released: true, study_guide_sections: [{ id: 1 }] });
  const releasedButEmpty = course("series-y", [1], { study_guide_released: true, study_guide_sections: [] });
  const unreleased = course("series-z", [1], { study_guide_released: false, study_guide_sections: [] });
  const [a, b, c, d] = M.buildDesk([legacy, authored, releasedButEmpty, unreleased], []);
  assert.deepEqual([a, b, c, d].map((x) => x.tools.studyGuide), [true, true, false, false]);
  // the shared rule directly
  assert.equal(C.studyGuideMode({ published: true, slug: "health", study_guide_released: false, sectionCount: 0 }), "legacy");
  assert.equal(C.studyGuideMode({ published: true, slug: "health", study_guide_released: true, sectionCount: 3 }), "authored");
  assert.equal(C.studyGuideMode({ published: true, slug: "life-health-combo", study_guide_released: true, sectionCount: 0 }), "legacy");
  assert.equal(C.studyGuideMode({ published: true, slug: "sie", study_guide_released: false, sectionCount: 9 }), null);
  assert.equal(C.studyGuideMode(null), null);
  assert.deepEqual([...C.LEGACY_GUIDE_SLUGS], ["life", "health", "life-health-combo"]);
});

// Availability only: publication is not part of the rule. Who may read the
// course is decided by the read that produced it (the Dashboard's published
// filter, database rules on the Study Guide page, later Phase 9 access).
test("Study Guide mode ignores publication (availability only, access is the read's job)", () => {
  const cases = [
    ["published legacy, unreleased, no sections", { published: true, slug: "life", study_guide_released: false, sectionCount: 0 }, "legacy"],
    ["published legacy, released, with sections", { published: true, slug: "life", study_guide_released: true, sectionCount: 4 }, "authored"],
    ["published future, released, with sections", { published: true, slug: "series-65", study_guide_released: true, sectionCount: 2 }, "authored"],
    ["published future, unreleased", { published: true, slug: "series-65", study_guide_released: false, sectionCount: 0 }, null],
    ["unpublished future, released, readable sections (admin)", { published: false, slug: "series-6", study_guide_released: true, sectionCount: 5 }, "authored"],
    ["unpublished future, unreleased", { published: false, slug: "series-6", study_guide_released: false, sectionCount: 0 }, null],
  ];
  cases.forEach(([name, input, expected]) => assert.equal(C.studyGuideMode(input), expected, name));
});

test("Dashboard stays published-only: the loader filters published = true before the rule runs", async () => {
  const calls = [];
  const query = {
    select(f) { calls.push(["select", f]); return query; },
    eq(col, val) { calls.push(["eq", col, val]); return Promise.resolve({ data: [], error: null }); },
  };
  global.supabaseClient = { from(t) { calls.push(["from", t]); return query; } };
  try {
    assert.deepEqual(await C.loadDashboardCourses(), []);
  } finally {
    delete global.supabaseClient;
  }
  assert.deepEqual(calls.filter((c) => c[0] !== "select"), [["from", "courses"], ["eq", "published", true]]);
});

test("Practice Exam availability follows exam-config.js only", () => {
  const rows = ["life", "health", "life-health-combo", "series-6", "series-63", "sie", "series-65"].map((s) => course(s, [1]));
  const tools = M.buildDesk(rows, []).map((c) => c.tools.practiceExam);
  assert.deepEqual(tools, [true, true, true, true, true, false, false]);
});

// ---------------------------------------------------------------- access seam
test("Phase 8 visibleCourses returns every published input course (no enrollment filter)", () => {
  const rows = [course("a", [1]), course("b", [1]), course("c", [1])];
  const desk = M.buildDesk(rows, [], { enrollments: [] });
  assert.equal(desk.length, 3);
  const input = [{ slug: "a" }, { slug: "b" }];
  const out = M.visibleCourses(input, { enrollments: [{ course: "a" }] });
  assert.deepEqual(out, input);
  assert.notEqual(out, input, "a copy, not the same array");
});

// ---------------------------------------------------------------- catalog order (shared helper)
test("catalog order: category position, course position, title, slug; uncategorized last", () => {
  const rows = [
    { slug: "z", title: "Zeta", position: 1, category: cat("securities-exams", 2) },
    { slug: "b", title: "Beta", position: 2, category: cat("insurance-licensing", 1) },
    { slug: "a2", title: "Alpha", position: 1, category: cat("insurance-licensing", 1) },
    { slug: "a1", title: "Alpha", position: 1, category: cat("insurance-licensing", 1) },
    { slug: "u", title: "Uncategorized", position: 0, category: null },
  ];
  assert.deepEqual(rows.slice().sort(C.byCatalogOrder).map((r) => r.slug), ["a1", "a2", "b", "z", "u"]);
});

// ---------------------------------------------------------------- hours
test("hours: 20 / 7.5 / 1 / NULL", () => {
  assert.equal(M.metaLine(20), "20 course hours · Self-paced");
  assert.equal(M.metaLine("20.0"), "20 course hours · Self-paced");
  assert.equal(M.metaLine(7.5), "7.5 course hours · Self-paced");
  assert.equal(M.metaLine("1.0"), "1 course hour · Self-paced");
  assert.equal(M.metaLine(null), "Self-paced");
  assert.equal(M.metaLine(undefined), "Self-paced");
  assert.equal(M.metaLine(0), "Self-paced");
  assert.equal(M.metaLine("abc"), "Self-paced");
});

// ---------------------------------------------------------------- paging (shared pager)
for (const n of [0, 999, 1000, 1001, 2500]) {
  test(`progress paging: ${n} rows load completely in order`, async () => {
    const rows = Array.from({ length: n }, (_, i) => ({ id: "p" + String(i).padStart(5, "0"), lesson_id: "l" + i, completed_at: "2026-10-01T00:00:00Z" }));
    const calls = [];
    const out = await M.loadAllPages(async (from, to) => { calls.push([from, to]); return { data: rows.slice(from, to + 1), error: null }; }, 1000);
    assert.equal(out.length, n);
    assert.deepEqual(out.map((r) => r.lesson_id), rows.map((r) => r.lesson_id));
    assert.equal(calls.length, Math.floor(n / 1000) + 1);
  });
}

test("progress paging uses lesson_id as the row id (the Dashboard selects id:lesson_id); rows without it are rejected", async () => {
  const real = Array.from({ length: 2500 }, (_, i) => ({ lesson_id: "lesson-" + String(i).padStart(5, "0"), completed_at: "2026-10-01T00:00:00Z" }));
  const aliased = real.map((r) => ({ id: r.lesson_id, ...r }));
  const page = (rows) => async (from, to) => ({ data: rows.slice(from, to + 1), error: null });
  const out = await M.loadAllPages(page(aliased), 1000);
  assert.equal(out.length, 2500);
  const desk = M.buildDesk([course("p", [3])], out);
  assert.equal(desk[0].done, 0); // unrelated lessons ignored
  await assert.rejects(M.loadAllPages(page(real.slice(0, 5)), 1000), /Duplicate/); // no id: refused, never a silent partial read
});

test("progress paging: an error stops loading (no partial progress)", async () => {
  await assert.rejects(M.loadAllPages(async (from) => (from === 0 ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: "x" + i })), error: null } : { data: null, error: { message: "boom" } }), 1000), /boom/);
});
