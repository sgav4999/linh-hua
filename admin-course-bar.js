// Shared course selector for the admin pages (Manage Course, Manage Study Guide,
// Manage Exam).
// UI only: it does no authentication or role checks (each admin page guards
// itself, and the database rules are the security boundary). It never falls
// back to a default course.
//
// LinhAdminCourseBar.render(mountEl, { page, slug }) resolves to
//   { status: "ok" | "none" | "unknown" | "error", course, courses }
// where course is the selected course (status "ok") or null.
window.LinhAdminCourseBar = (() => {
  const PAGES = [
    { key: "content", label: "Content", href: "manage-course.html" },
    { key: "guide", label: "Study Guide", href: "manage-study-guide.html" },
    { key: "exam", label: "Practice Exam", href: "manage-exam.html" },
  ];

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  const courseUrl = (href, slug) => href + "?course=" + encodeURIComponent(slug);

  // Courses arrive in catalog order (category position, course position,
  // title; uncategorized last), so groups keep that order.
  function groups(courses) {
    const out = [];
    const byKey = new Map();
    courses.forEach((c) => {
      const key = c.category ? c.category.id : "";
      if (!byKey.has(key)) {
        const g = { label: c.category ? c.category.title : "No category", courses: [] };
        byKey.set(key, g);
        out.push(g);
      }
      byKey.get(key).courses.push(c);
    });
    return out;
  }

  async function render(mount, { page, slug }) {
    const current = PAGES.find((p) => p.key === page) || PAGES[0];
    mount.textContent = "";
    mount.classList.add("admin-bar");

    const form = el("form", "admin-bar-form");
    form.method = "get";
    form.action = current.href;
    const label = el("label", "admin-bar-label", "Course");
    label.htmlFor = "adminCourseSelect";
    const select = el("select", "admin-bar-select");
    select.id = "adminCourseSelect";
    select.name = "course";
    const open = el("button", "btn btn-secondary admin-bar-open", "Open");
    open.type = "submit";
    form.append(label, select, open);

    const note = el("p", "admin-bar-note");
    note.setAttribute("role", "status");
    mount.append(form, note);

    let courses;
    try {
      courses = await LinhCourses.loadAllCourses();
    } catch (e) {
      select.disabled = true;
      open.disabled = true;
      note.textContent = "Courses could not be loaded. Refresh the page to try again.";
      return { status: "error", course: null, courses: [] };
    }

    const course = slug ? courses.find((c) => c.slug === slug) || null : null;
    const status = course ? "ok" : slug ? "unknown" : "none";

    if (!course) {
      const placeholder = el("option", null, "Choose a course");
      placeholder.value = "";
      placeholder.disabled = true;
      placeholder.selected = true;
      select.append(placeholder);
    }
    groups(courses).forEach((g) => {
      const og = el("optgroup");
      og.label = g.label;
      g.courses.forEach((c) => {
        const o = el("option", null, c.published ? c.title : c.title + " (Draft)");
        o.value = c.slug;
        if (course && c.slug === course.slug) o.selected = true;
        og.append(o);
      });
      select.append(og);
    });
    if (!courses.length) {
      select.disabled = true;
      open.disabled = true;
    }

    if (status === "ok") {
      if (!course.published) form.append(el("span", "admin-draft-badge", "Draft"));
      const tabs = el("nav", "admin-bar-tabs");
      tabs.setAttribute("aria-label", "Course admin sections");
      PAGES.forEach((p) => {
        const a = el("a", "admin-bar-tab", p.label);
        a.href = courseUrl(p.href, course.slug);
        if (p.key === current.key) a.setAttribute("aria-current", "page");
        tabs.append(a);
      });
      mount.insertBefore(tabs, note);
      note.remove();
    } else if (status === "unknown") {
      note.classList.add("admin-bar-note--error");
      note.textContent = "That course doesn't exist. Choose another course.";
    } else {
      note.textContent = courses.length ? "Choose a course to manage." : "There are no courses yet.";
    }

    return { status, course, courses };
  }

  return { render, courseUrl };
})();
