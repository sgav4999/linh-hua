// Study Desk model: pure functions over the Dashboard read (no DOM, no
// Supabase). dashboard.js loads the data and draws; this file decides what a
// course's progress, next lesson, tools and status are, which course is in
// focus, and which courses the student sees. Nothing here names a course.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./courses-data.js"), require("./exam-config.js"));
  else root.LinhDashboardModel = factory(root.LinhCourses, root.LinhExamConfig);
})(typeof self !== "undefined" ? self : this, function (Courses, ExamConfig) {
  "use strict";

  const byPosition = (a, b) =>
    (a.position ?? Infinity) - (b.position ?? Infinity) || String(a.id).localeCompare(String(b.id));

  // Lesson id -> latest valid completion time (ms), or null when the row has
  // no usable timestamp. Rows without a lesson id are ignored.
  function progressIndex(rows) {
    const done = new Map();
    (rows || []).forEach((r) => {
      if (!r || r.lesson_id == null) return;
      const t = Date.parse(r.completed_at);
      const ms = Number.isFinite(t) ? t : null;
      const prev = done.has(r.lesson_id) ? done.get(r.lesson_id) : undefined;
      if (prev === undefined || (ms !== null && (prev === null || ms > prev))) done.set(r.lesson_id, ms);
    });
    return done;
  }

  // "20 course hours", "7.5 course hours", "1 course hour"; null when the
  // course has no (valid) hours.
  function formatHours(hours) {
    if (hours === null || hours === undefined || hours === "") return null;
    const n = Number(hours);
    if (!Number.isFinite(n) || n <= 0) return null;
    return `${n} course hour${n === 1 ? "" : "s"}`;
  }
  const metaLine = (hours) => {
    const h = formatHours(hours);
    return h ? `${h} · Self-paced` : "Self-paced";
  };

  // The tools a course has: its Study Guide only when the shared rule finds
  // one; its Practice Exam only when exam-config.js configures it.
  function toolsFor(row) {
    const sectionCount = Array.isArray(row.study_guide_sections) ? row.study_guide_sections.length : 0;
    return {
      studyGuide: Courses.studyGuideMode({ ...row, sectionCount }) !== null,
      practiceExam: ExamConfig.examConfigFor(row.slug) !== null,
    };
  }

  // One course from its database row and the student's progress. Each lesson
  // counts once per course, so a duplicated row can never push done past total.
  function buildCourse(row, done) {
    const seen = new Set();
    let last = null;
    const modules = (row.modules || []).slice().sort(byPosition).map((m) => {
      const lessons = (m.lessons || []).slice().sort(byPosition).filter((l) => !seen.has(l.id) && seen.add(l.id));
      let count = 0;
      lessons.forEach((l) => {
        if (!done.has(l.id)) return;
        count++;
        const t = done.get(l.id);
        if (t !== null && (last === null || t > last)) last = t;
      });
      return { title: m.title, lessons, total: lessons.length, done: count };
    });
    const total = modules.reduce((s, m) => s + m.total, 0);
    const completed = modules.reduce((s, m) => s + m.done, 0);
    let nextLesson = null;
    for (const m of modules) {
      const l = m.lessons.find((x) => !done.has(x.id));
      if (l) { nextLesson = { id: l.id, title: l.title, module: m.title }; break; }
    }
    const status = total === 0 ? "empty" : completed === 0 ? "new" : completed === total ? "complete" : "progress";
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      published: row.published === true,
      identity: row.identity || null,
      identity_secondary: row.identity_secondary || null,
      category: row.category || null,
      meta: metaLine(row.hours),
      modules: modules.filter((m) => m.total > 0).map(({ title, total: t, done: d }) => ({ title, total: t, done: d })),
      total,
      done: completed,
      status,
      nextLesson,
      lastCompletedAt: last,
      tools: toolsFor(row),
    };
  }

  // The courses this student sees: the published ones they are enrolled in
  // (the shared client mirror of the database rule). Missing or invalid
  // access shows nothing, never every course.
  function visibleCourses(courses, access) {
    return (courses || []).filter((c) => Courses.canAccessCourse(c, access));
  }

  // Rows arrive in catalog order (LinhCourses.loadDashboardCourses).
  function buildDesk(rows, progressRows, access) {
    const done = progressIndex(progressRows);
    return visibleCourses((rows || []).map((r) => buildCourse(r, done)), access);
  }

  // Focus: among partially completed courses, the newest completed lesson;
  // then more lessons done; then catalog order. No partial course: overview.
  function chooseView(courses) {
    if (!courses.length) return { mode: "empty", courses };
    const partial = courses.map((c, i) => ({ c, i })).filter(({ c }) => c.status === "progress");
    if (!partial.length) {
      const allComplete = courses.every((c) => c.status === "complete");
      return { mode: "overview", heading: allComplete ? "My courses" : "Choose where to start", courses };
    }
    const key = (c) => (c.lastCompletedAt === null ? -Infinity : c.lastCompletedAt);
    partial.sort((a, b) => key(b.c) - key(a.c) || b.c.done - a.c.done || a.i - b.i);
    const focus = partial[0].c;
    return { mode: "focus", focus, others: courses.filter((c) => c !== focus) };
  }

  return {
    progressIndex, formatHours, metaLine, toolsFor, buildCourse, visibleCourses, buildDesk, chooseView,
    loadAllPages: ExamConfig.loadAllPages,
  };
});
