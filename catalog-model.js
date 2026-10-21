// Courses catalog model: pure functions over the published-course read (no DOM,
// no Supabase). catalog.js loads the data and draws; this file decides which
// courses are listed, how they are grouped by category, what each card says
// and which action or status a visitor gets. Nothing here names a course or a
// category: every course and category comes from the data.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./courses-data.js"));
  else root.LinhCatalogModel = factory(root.LinhCourses);
})(typeof self !== "undefined" ? self : this, function (Courses) {
  "use strict";

  const OTHER_TITLE = "Other courses";
  const STATUS_SOON = "Enrollment opens soon";
  const OPEN_COURSE = "Open course";
  const TO_DASHBOARD = "Go to your Dashboard";

  const text = (v) => (v == null ? "" : String(v));
  const trimmed = (v) => text(v).trim();

  // Who is looking, as catalog.js determined it:
  //   { kind: "signed-out" }
  //   { kind: "admin" }
  //   { kind: "student", access }               enrollments read ({ enrolledCourseIds: Set })
  //   { kind: "student", accessFailed: true }   the enrollment read failed
  // A session that could not be read is "signed-out". Anything unrecognised
  // is treated as signed out too: no course is ever opened on a guess.
  const signedOut = Object.freeze({ kind: "signed-out" });
  function viewer(v) {
    if (!v || (v.kind !== "admin" && v.kind !== "student")) return signedOut;
    return v;
  }

  // The action or status on one course card.
  //   { type: "link", text, href }   a real link
  //   { type: "status", text }       plain text, nothing to click
  function cardAction(course, who) {
    const v = viewer(who);
    const open = { type: "link", text: OPEN_COURSE, href: "course.html?course=" + encodeURIComponent(course.slug) };
    if (v.kind === "admin") return open;
    if (v.kind === "student") {
      // Unknown enrollment state: a neutral route to the Dashboard, never "Open course"
      // and never a claim that the student is not enrolled.
      if (v.accessFailed || !isAccess(v.access)) return { type: "link", text: TO_DASHBOARD, href: "dashboard.html" };
      return Courses.canAccessCourse(course, v.access) ? open : { type: "status", text: STATUS_SOON };
    }
    return { type: "status", text: STATUS_SOON };
  }
  const isAccess = (access) => !!access && access.enrolledCourseIds instanceof Set;

  // The page-level account link (one per page, not per card).
  function accountLink(who) {
    const v = viewer(who);
    if (v.kind === "signed-out") return { text: "Already enrolled? Log in", href: "login.html" };
    return { text: TO_DASHBOARD, href: "dashboard.html" };
  }

  // One card from a course row. Only stored fields; a missing description or
  // short label is simply left out.
  function buildCard(row, who) {
    const description = trimmed(row.description) ? text(row.description) : null;
    return {
      id: row.id,
      slug: row.slug,
      title: text(row.title),
      label: trimmed(row.short_label) || null,
      description,
      meta: Courses.metaLine(row.hours),
      identity: row.identity || null,
      identity_secondary: row.identity_secondary || null,
      action: cardAction(row, who),
    };
  }

  // Published courses only (the loader already filters; this is defensive),
  // in catalog order: category position, course position, title, slug, with
  // courses without a category last under "Other courses". Only categories
  // that have a published course appear.
  function buildCatalog(rows, who) {
    const list = (rows || []).filter((r) => r && r.published === true && r.slug).slice().sort(Courses.byCatalogOrder);
    const groups = [];
    const byKey = new Map();
    list.forEach((r) => {
      const c = r.category || null;
      const key = c ? "category:" + text(c.id || c.slug) : "other";
      let g = byKey.get(key);
      if (!g) {
        g = { key, slug: c ? text(c.slug) || null : null, title: c ? trimmed(c.title) || trimmed(c.slug) || OTHER_TITLE : OTHER_TITLE, courses: [] };
        byKey.set(key, g);
        groups.push(g);
      }
      g.courses.push(buildCard(r, who));
    });
    // byCatalogOrder already places uncategorised courses last; keep it explicit.
    groups.sort((a, b) => (a.key === "other") - (b.key === "other"));
    return { groups, total: list.length, account: accountLink(who) };
  }

  return {
    buildCatalog, buildCard, cardAction, accountLink, viewer,
    OTHER_TITLE, STATUS_SOON, OPEN_COURSE, TO_DASHBOARD,
  };
});
