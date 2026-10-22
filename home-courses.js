// Homepage course preview: up to three published courses from the database,
// chosen by home-model.js (one from each category first), drawn as plain
// plates under "Choose your licensing path". Reads only the published courses
// (LinhCourses.loadPublishedCourses, readable signed out); nothing here looks
// at who is signed in. Everything database-supplied is written with
// textContent. The plates are not links: the section's static "Explore all
// courses" link is the way on to the full catalog, and any failure here simply
// leaves that heading and link as they are. Nothing here names a course or a
// category: every course and category comes from the data.
(function (root) {
  "use strict";

  const OTHER_TITLE = "Other courses"; // the catalog's label for courses without a category
  const EMPTY_TEXT = "New courses are being prepared. Check back soon."; // the catalog's empty line

  const text = (v) => (v == null ? "" : String(v));
  const trimmed = (v) => text(v).trim();
  const same = (a, b) => trimmed(a).replace(/\s+/g, " ").toLowerCase() === trimmed(b).replace(/\s+/g, " ").toLowerCase();

  // The group a selected course shows under: the catalog's category identity
  // (id, else slug) and title (title, else slug, else "Other courses").
  const groupOf = (c) => (c.category ? "category:" + text(c.category.id || c.category.slug) : "other");
  const groupTitle = (c) => (c.category ? trimmed(c.category.title) || trimmed(c.category.slug) || OTHER_TITLE : OTHER_TITLE);

  // One context line per selected course: its group's title when the selected
  // courses come from more than one group, otherwise none at all. Decided from
  // the selection itself, never from how many categories the catalog has.
  function contextFor(items) {
    const list = Array.isArray(items) ? items : [];
    const several = new Set(list.map(groupOf)).size > 1;
    return list.map((c) => (several ? groupTitle(c) : null));
  }

  if (typeof module === "object" && module.exports) {
    module.exports = { contextFor, OTHER_TITLE, EMPTY_TEXT };
    return;
  }

  const mount = document.getElementById("homeCoursePreview");
  if (!mount) return;
  // Reserves the row's space while the read is pending (home.css; released
  // after 6s if the read hangs). Without this script nothing is reserved.
  mount.setAttribute("data-state", "loading");
  mount.setAttribute("aria-busy", "true");

  const el = (tag, cls, value) => {
    const e = document.createElement(tag);
    e.className = cls;
    if (value != null) e.textContent = value;
    return e;
  };

  function plate(Courses, course, context) {
    const article = el("article", "home-course-plate");
    Courses.applyCourseIdentity(article, course);
    const band = el("span", "home-course-plate-band");
    band.setAttribute("aria-hidden", "true");
    const body = el("div", "home-course-plate-body");
    if (context) body.append(el("p", "home-course-plate-context", context));
    // The short label, unless it would only repeat the title
    const label = Courses.courseLabel(course);
    if (trimmed(label) && !same(label, course.title)) body.append(el("p", "home-course-plate-label", label));
    body.append(el("h3", "home-course-plate-title", text(course.title)));
    if (trimmed(course.description)) body.append(el("p", "home-course-plate-desc", text(course.description)));
    body.append(el("p", "home-course-plate-meta", Courses.metaLine(course.hours)));
    article.append(band, body);
    return article;
  }

  function finish(state, nodes) {
    mount.textContent = "";
    nodes.forEach((n) => mount.append(n));
    if (state === "ready") mount.setAttribute("data-count", String(nodes.length));
    else mount.removeAttribute("data-count");
    mount.setAttribute("data-state", state);
    mount.removeAttribute("aria-busy");
    if (state === "ready") mount.classList.add("is-arriving");
  }

  async function load() {
    const Courses = root.LinhCourses;
    const Model = root.LinhHomeModel;
    if (!Courses || !Model) throw new Error("Course preview unavailable.");
    const { items } = Model.selectPreview(await Courses.loadPublishedCourses());
    if (!items.length) {
      const note = el("p", "home-course-preview-note", EMPTY_TEXT);
      note.setAttribute("role", "status");
      finish("empty", [note]);
      return;
    }
    const lines = contextFor(items);
    finish("ready", items.map((c, i) => plate(Courses, c, lines[i])));
  }

  // Any failure (the read, the model or drawing) ends quietly: no plates, no
  // reserved space, and the static heading and link stay as they are.
  load().catch(() => finish("failed", []));
})(typeof self !== "undefined" ? self : this);
