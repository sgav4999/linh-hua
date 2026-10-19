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
// Phase 8 behaviour tests use an all-enrolled student; access itself is tested below.
const deskAll = (rows, prog) => M.buildDesk(rows, prog, { enrolledCourseIds: new Set(rows.map((r) => r.id)) });
const lessonIds = (row) => row.modules.flatMap((m) => m.lessons.map((l) => l.id));
const done = (ids, at) => ids.map((id, i) => ({ lesson_id: id, completed_at: at ? new Date(Date.parse(at) + i * 1000).toISOString() : "2026-10-01T00:00:00Z" }));

// ---------------------------------------------------------------- course counts and generic slugs
for (const n of [0, 1, 2, 3, 5, 8]) {
  test(`desk: ${n} published course(s) flow through the generic path`, () => {
    const rows = Array.from({ length: n }, (_, i) => course(i === n - 1 ? "sie" : "course-" + i, [2, 3], { position: i + 1 }));
    const desk = deskAll(rows, []);
    assert.equal(desk.length, n);
    assert.deepEqual(desk.map((c) => c.slug), rows.map((r) => r.slug), "catalog order kept");
    const view = M.chooseView(desk);
    assert.equal(view.mode, n === 0 ? "empty" : "overview");
  });
}

test("generic future course (sie): unknown identity, no tools, normal model", () => {
  const row = course("sie", [3, 2], { identity: "teal", hours: "12.5" });
  const c = deskAll([row], done(lessonIds(row).slice(0, 2), "2026-10-10T10:00:00Z"))[0];
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
  const [a, b, c, d, e] = deskAll([empty, hollow, fresh, partial, full], prog);
  assert.deepEqual([a.status, b.status, c.status, d.status, e.status], ["empty", "empty", "new", "progress", "complete"]);
  assert.equal(a.total, 0); assert.equal(b.total, 0); assert.deepEqual(b.modules, []);
  assert.equal(c.nextLesson.id, "c-m0-l0");
  assert.equal(d.nextLesson.id, "d-m0-l1");
  assert.equal(e.nextLesson, null);
  assert.equal(e.done, 3);
});

test("modules with zero lessons are dropped from segments but the course still counts", () => {
  const row = course("x", [0, 3, 0, 2]);
  const c = deskAll([row], done(["x-m1-l0"]))[0];
  assert.deepEqual(c.modules.map((m) => [m.total, m.done]), [[3, 1], [2, 0]]);
  assert.equal(c.total, 5);
});

test("stale progress ids are ignored; duplicate lesson ids count once; done never exceeds total", () => {
  const row = course("y", [2, 2]);
  row.modules[1].lessons.push({ ...row.modules[0].lessons[0], position: 9 }); // same id again
  const prog = [...done(lessonIds(course("y", [2, 2]))), { lesson_id: "deleted-lesson", completed_at: "2026-10-02T00:00:00Z" }, { lesson_id: "y-m0-l0", completed_at: "2026-10-03T00:00:00Z" }];
  const c = deskAll([row], prog)[0];
  assert.equal(c.total, 4);
  assert.equal(c.done, 4);
  assert.equal(c.status, "complete");
});

test("reversible completion: removing a progress row lowers the count on the next build", () => {
  const row = course("r", [3]);
  const all = done(lessonIds(row));
  assert.equal(deskAll([row], all)[0].status, "complete");
  const after = deskAll([row], all.filter((p) => p.lesson_id !== "r-m0-l1"))[0];
  assert.equal(after.done, 2); assert.equal(after.status, "progress"); assert.equal(after.nextLesson.id, "r-m0-l1");
});

test("module and lesson ordering by position, then id", () => {
  const row = course("o", [2, 2]);
  row.modules.reverse(); // module 2 first in the data
  row.modules.forEach((m) => m.lessons.reverse());
  row.modules[1].lessons.push({ id: "o-m0-a", title: "tie a", position: 2 }); // ties position 2 with o-m0-l1, sorts before it by id
  const c = deskAll([row], [])[0];
  assert.deepEqual(c.modules.map((m) => m.title), ["o module 1", "o module 2"]);
  assert.equal(c.nextLesson.id, "o-m0-l0");
  const c2 = deskAll([row], done(["o-m0-l0"]))[0];
  assert.equal(c2.nextLesson.id, "o-m0-a");
});

test("mixed courses: overview heading 'Choose where to start'; all complete: 'My courses'", () => {
  const a = course("a", [1]), b = course("b", [1]);
  assert.equal(M.chooseView(deskAll([a, b], done(lessonIds(a)))).heading, "Choose where to start");
  assert.equal(M.chooseView(deskAll([a, b], done([...lessonIds(a), ...lessonIds(b)]))).heading, "My courses");
});

// ---------------------------------------------------------------- focus
test("focus: several partial courses -> newest completed_at wins", () => {
  const a = course("a", [4]), b = course("b", [4]), c = course("c", [4]);
  const prog = [
    ...done(lessonIds(a).slice(0, 3), "2026-10-01T00:00:00Z"), // most done, oldest
    ...done(lessonIds(b).slice(0, 1), "2026-10-09T00:00:00Z"), // newest
    ...done(lessonIds(c).slice(0, 2), "2026-10-05T00:00:00Z"),
  ];
  const v = M.chooseView(deskAll([a, b, c], prog));
  assert.equal(v.mode, "focus");
  assert.equal(v.focus.slug, "b");
  assert.deepEqual(v.others.map((x) => x.slug), ["a", "c"]);
});

test("focus: tied timestamps -> more lessons done, then catalog order", () => {
  const a = course("a", [4]), b = course("b", [4]), c = course("c", [4]);
  const t = "2026-10-05T00:00:00.000Z";
  const same = (ids) => ids.map((id) => ({ lesson_id: id, completed_at: t }));
  let v = M.chooseView(deskAll([a, b, c], [...same(lessonIds(a).slice(0, 1)), ...same(lessonIds(b).slice(0, 2)), ...same(lessonIds(c).slice(0, 2))]));
  assert.equal(v.focus.slug, "b"); // b and c tie on time and count; b is earlier in catalog order
  v = M.chooseView(deskAll([a, b, c], [...same(lessonIds(a).slice(0, 1)), ...same(lessonIds(b).slice(0, 1)), ...same(lessonIds(c).slice(0, 3))]));
  assert.equal(v.focus.slug, "c"); // more done
});

test("focus: missing/invalid timestamps rank below valid ones, then by count and catalog order", () => {
  const a = course("a", [4]), b = course("b", [4]), c = course("c", [4]);
  const bad = (ids) => ids.map((id) => ({ lesson_id: id, completed_at: "not a date" }));
  let v = M.chooseView(deskAll([a, b, c], [...bad(lessonIds(a).slice(0, 3)), ...done(lessonIds(b).slice(0, 1), "2020-01-01T00:00:00Z"), ...bad(lessonIds(c).slice(0, 2))]));
  assert.equal(v.focus.slug, "b"); // the only valid timestamp
  v = M.chooseView(deskAll([a, b, c], [...bad(lessonIds(a).slice(0, 1)), ...bad(lessonIds(b).slice(0, 2)), ...bad(lessonIds(c).slice(0, 2))]));
  assert.equal(v.focus.slug, "b"); // all unavailable: count, then catalog order
});

test("focus: completed and new courses never take focus", () => {
  const a = course("a", [2]), b = course("b", [2]), c = course("c", [2]);
  let v = M.chooseView(deskAll([a, b, c], done(lessonIds(a), "2026-10-10T00:00:00Z")));
  assert.equal(v.mode, "overview"); // a complete, b and c new
  v = M.chooseView(deskAll([a, b, c], [...done(lessonIds(a), "2026-10-10T00:00:00Z"), ...done(lessonIds(c).slice(0, 1), "2026-01-01T00:00:00Z")]));
  assert.equal(v.mode, "focus"); assert.equal(v.focus.slug, "c"); // the newer completion is in a complete course
});

// ---------------------------------------------------------------- tools
test("Study Guide availability: legacy courses, released authored guides with visible sections, none otherwise", () => {
  const legacy = course("life", [1]);
  const authored = course("series-x", [1], { study_guide_released: true, study_guide_sections: [{ id: 1 }] });
  const releasedButEmpty = course("series-y", [1], { study_guide_released: true, study_guide_sections: [] });
  const unreleased = course("series-z", [1], { study_guide_released: false, study_guide_sections: [] });
  const [a, b, c, d] = deskAll([legacy, authored, releasedButEmpty, unreleased], []);
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
  const tools = deskAll(rows, []).map((c) => c.tools.practiceExam);
  assert.deepEqual(tools, [true, true, true, true, true, false, false]);
});

// ---------------------------------------------------------------- access (Phase 9)
const access = (...ids) => ({ enrolledCourseIds: new Set(ids) });

test("canAccessCourse: published + enrolled only; missing or invalid access is false", () => {
  const pub = { id: "c1", published: true }, draft = { id: "c2", published: false };
  assert.equal(C.canAccessCourse(pub, access("c1")), true);
  assert.equal(C.canAccessCourse(pub, access("c9")), false, "published, not enrolled");
  assert.equal(C.canAccessCourse(draft, access("c2")), false, "draft + enrolled grants nothing");
  assert.equal(C.canAccessCourse(draft, access()), false, "draft, not enrolled");
  assert.equal(C.canAccessCourse(pub, undefined), false, "missing access");
  assert.equal(C.canAccessCourse(pub, null), false);
  assert.equal(C.canAccessCourse(pub, { enrolledCourseIds: ["c1"] }), false, "invalid access (not a Set)");
  assert.equal(C.canAccessCourse(pub, { enrollments: [{ course_id: "c1" }] }), false, "invalid access (wrong shape)");
  assert.equal(C.canAccessCourse({ id: "c1", published: "true" }, access("c1")), false, "published must be true, not truthy");
  assert.equal(C.canAccessCourse(null, access("c1")), false);
});

test("visibleCourses: only enrolled published courses; missing access shows nothing", () => {
  const rows = [course("a", [1]), course("b", [1]), course("c", [1])];
  const [a, b, c] = rows;
  assert.equal(M.buildDesk(rows, [], access(a.id, b.id, c.id)).length, 3, "3 enrolled -> 3");
  assert.deepEqual(M.buildDesk(rows, [], access(a.id, c.id)).map((x) => x.slug), ["a", "c"], "subset, catalog order kept");
  assert.deepEqual(M.buildDesk(rows, [], access()), [], "0 enrolled -> []");
  assert.deepEqual(M.buildDesk(rows, []), [], "missing access -> [] (never every course)");
  assert.deepEqual(M.buildDesk(rows, [], { enrollments: [] }), [], "invalid access -> []");
  assert.equal(M.chooseView(M.buildDesk(rows, [], access())).mode, "empty");
  const input = M.buildDesk(rows, [], access(a.id, b.id, c.id));
  assert.notEqual(M.visibleCourses(input, access(a.id, b.id, c.id)), input, "a copy, not the same array");
});

test("visibleCourses: a draft row with an enrollment never appears", () => {
  const live = course("live", [1]), draft = course("draft", [1], { published: false });
  assert.deepEqual(M.buildDesk([live, draft], [], access(live.id, draft.id)).map((x) => x.slug), ["live"]);
});

test("a future course needs only publication + enrollment (no slug list in the model)", () => {
  const future = course("series-65", [2, 2], { identity: "teal" });
  const desk = M.buildDesk([course("life", [1]), future], [], access(future.id));
  assert.deepEqual(desk.map((x) => x.slug), ["series-65"]);
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "dashboard-model.js"), "utf8");
  assert.doesNotMatch(src, /["'](life|health|life-health-combo|series-6|series-63|sie|series-65)["']/);
});

// ---------------------------------------------------------------- access loaders (fake client)
function fakeClient(tables) {
  const calls = [];
  const from = (table) => {
    const q = { table, filters: [], select: null, range: null };
    calls.push(q);
    const b = {
      select(sel) { q.select = sel; return b; }, eq(k, v) { q.filters.push([k, v]); return b; }, order() { return b; },
      range(f2, t) { q.range = [f2, t]; return b; }, in() { return b; },
      maybeSingle() { return Promise.resolve(tables[table](q)); },
      then(res, rej) { return Promise.resolve(tables[table](q)).then(res, rej); },
    };
    return b;
  };
  return { calls, from };
}
async function withClient(client, fn) {
  global.supabaseClient = client;
  try { return await fn(); } finally { delete global.supabaseClient; }
}
const STUDENT = { user: { id: "u1", app_metadata: { provider: "email" } } };
const ADMIN = { user: { id: "a1", app_metadata: { provider: "email", role: "admin" } } };

test("loadMyEnrollments: own rows only -> { enrolledCourseIds: Set }", async () => {
  const client = fakeClient({ enrollments: () => ({ data: [{ course_id: "c1" }, { course_id: "c2" }], error: null }) });
  const a = await withClient(client, () => C.loadMyEnrollments("u1"));
  assert.deepEqual([...a.enrolledCourseIds].sort(), ["c1", "c2"]);
  assert.deepEqual(client.calls[0].filters, [["user_id", "u1"]]);
  assert.equal(client.calls[0].select, "course_id");
});

test("loadMyEnrollments: a read error, a missing user or a full page throws (never all, never empty)", async () => {
  const err = fakeClient({ enrollments: () => ({ data: null, error: { message: "boom" } }) });
  await assert.rejects(withClient(err, () => C.loadMyEnrollments("u1")), /could not be loaded/);
  await assert.rejects(withClient(err, () => C.loadMyEnrollments(null)), /could not be loaded/);
  const full = fakeClient({ enrollments: () => ({ data: Array.from({ length: 1000 }, (_, i) => ({ course_id: "c" + i })), error: null }) });
  await assert.rejects(withClient(full, () => C.loadMyEnrollments("u1")), /could not be loaded/);
});

test("loadCourseAccess: admin / enrolled / no-access / unavailable / error", async () => {
  const pub = { id: "c1", slug: "x", title: "X", published: true };
  const mk = (course, courseErr, enr) => fakeClient({
    courses: () => (courseErr ? { data: null, error: { message: "boom" } } : { data: course, error: null }),
    enrollments: () => enr,
  });
  const ok = (ids) => ({ data: ids.map((id) => ({ course_id: id })), error: null });
  let c = mk(pub, false, ok(["c1"]));
  assert.equal((await withClient(c, () => C.loadCourseAccess(STUDENT, "x"))).state, "enrolled");
  c = mk(pub, false, ok([]));
  let r = await withClient(c, () => C.loadCourseAccess(STUDENT, "x"));
  assert.equal(r.state, "no-access");
  assert.equal(r.course.title, "X");
  c = mk(pub, false, { data: null, error: { message: "boom" } });
  assert.equal((await withClient(c, () => C.loadCourseAccess(STUDENT, "x"))).state, "error", "enrollment error is an error, not no-access");
  c = mk(null, false, ok(["c1"])); // database rules return no row for a student (draft) or the slug is unknown
  assert.equal((await withClient(c, () => C.loadCourseAccess(STUDENT, "series-6"))).state, "unavailable");
  c = mk(pub, true, ok(["c1"]));
  assert.equal((await withClient(c, () => C.loadCourseAccess(STUDENT, "x"))).state, "error", "course read error");
  c = mk({ ...pub, published: false }, false, ok([]));
  r = await withClient(c, () => C.loadCourseAccess(ADMIN, "x"));
  assert.equal(r.state, "admin");
  assert.equal(c.calls.filter((q) => q.table === "enrollments").length, 0, "admins read no enrollments");
  c = mk(pub, false, ok(["c1"]));
  assert.equal((await withClient(c, () => C.loadCourseAccess(STUDENT, ""))).state, "unavailable");
  assert.equal(c.calls.length, 0, "no slug: nothing read");
  c = mk(pub, false, ok([]));
  r = await withClient(c, () => C.loadCourseAccess(STUDENT, "x", access("c1")));
  assert.equal(r.state, "enrolled");
  assert.equal(c.calls.filter((q) => q.table === "enrollments").length, 0, "passed access is reused");
});

test("isAdminSession reads JWT app_metadata.role only", () => {
  assert.equal(C.isAdminSession(ADMIN), true);
  assert.equal(C.isAdminSession(STUDENT), false);
  assert.equal(C.isAdminSession({ user: { id: "x", app_metadata: {}, user_metadata: { role: "admin" } } }), false, "user-supplied metadata is not authority");
  assert.equal(C.isAdminSession(null), false);
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
  const desk = deskAll([course("p", [3])], out);
  assert.equal(desk[0].done, 0); // unrelated lessons ignored
  await assert.rejects(M.loadAllPages(page(real.slice(0, 5)), 1000), /Duplicate/); // no id: refused, never a silent partial read
});

test("progress paging: an error stops loading (no partial progress)", async () => {
  await assert.rejects(M.loadAllPages(async (from) => (from === 0 ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: "x" + i })), error: null } : { data: null, error: { message: "boom" } }), 1000), /boom/);
});
