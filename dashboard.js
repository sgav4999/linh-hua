// Student Dashboard: renders the Study Desk from the student's real progress.
// auth.js stays the gate (signed-out redirect) and fills the name, email, avatar
// and role. This file only reads: the three courses with their modules and
// lessons, and the signed-in user's lesson_progress rows. Everything visitor- or
// database-supplied is written with textContent; nothing is parsed as HTML.
(function () {
  const root = document.documentElement;
  const desk = document.querySelector(".dash-desk .container");
  if (!desk) return;

  // Course identity comes from the page (the same names, hours and order as the
  // Courses page); the fixed order also breaks ties between in-progress courses.
  const COURSES = [
    { slug: "life", title: "Life Insurance License", hours: 20 },
    { slug: "health", title: "Health Insurance License", hours: 20 },
    { slug: "life-health-combo", title: "Life & Health Combo", hours: 40 },
  ];
  const ERROR_TEXT = "Progress could not be loaded. Your courses are still available.";

  // Until the role is known, neither the student desk nor the admin tools show
  // (only for this page's own session check, never while waiting for data).
  // If the role cannot be determined, the page settles on the neutral course
  // list with the quiet notice; the admin tools are never shown on a guess.
  root.classList.add("dash-pending");
  const settleRole = (role) => {
    root.setAttribute("data-dash-role", role || "unknown");
    root.classList.remove("dash-pending");
    const stale = desk.querySelector(".dash-note");
    if (role && stale) stale.remove(); // a slow session check recovered after the fallback
    if (!role && !stale) {
      const heading = desk.querySelector(".dash-section-title");
      if (heading) heading.after(errorNote());
    }
  };
  const safety = setTimeout(() => settleRole(null), 4000);

  // ---- small DOM helpers ----------------------------------------------------
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const sr = (text) => el("span", "dash-sr", text);
  const mark = (slug) => {
    const m = el("span", "dash-mark dash-mark--" + (slug === "life-health-combo" ? "combo" : slug));
    m.setAttribute("aria-hidden", "true");
    return m;
  };
  const q = (slug) => encodeURIComponent(slug);
  let uid = 0;
  const nextId = (prefix) => prefix + "-" + (++uid);

  // ---- data -------------------------------------------------------------------
  const byPosition = (a, b) =>
    (a.position ?? Infinity) - (b.position ?? Infinity) || String(a.id).localeCompare(String(b.id));

  // doneIds is a Set of unique lesson ids, and each lesson counts once per
  // course, so a duplicated row can never push completed past total.
  function buildCourse(base, row, doneIds) {
    if (!row) return { ...base, status: "unavailable" };
    const seen = new Set();
    const modules = (row.modules || []).slice().sort(byPosition).map((m) => {
      const lessons = (m.lessons || []).slice().sort(byPosition).filter((l) => !seen.has(l.id) && seen.add(l.id));
      return {
        title: m.title,
        lessons,
        total: lessons.length,
        done: lessons.filter((l) => doneIds.has(l.id)).length,
      };
    });
    const total = modules.reduce((s, m) => s + m.total, 0);
    const done = modules.reduce((s, m) => s + m.done, 0);
    let nextLesson = null;
    for (const m of modules) {
      const l = m.lessons.find((x) => !doneIds.has(x.id));
      if (l) { nextLesson = { id: l.id, title: l.title, module: m.title }; break; }
    }
    const status = total === 0 ? "empty" : done === 0 ? "new" : done === total ? "complete" : "progress";
    return { ...base, modules: modules.filter((m) => m.total > 0), total, done, status, nextLesson };
  }

  // ---- views ------------------------------------------------------------------
  const counted = (c) => c.status === "new" || c.status === "progress" || c.status === "complete";
  const actionLabel = (c) =>
    c.status === "new" ? "Start" : c.status === "progress" ? "Continue" : c.status === "complete" ? "Review course" : "Open course";
  const actionHref = (c) =>
    c.status === "progress" && c.nextLesson
      ? "course.html?course=" + q(c.slug) + "#" + encodeURIComponent(c.nextLesson.id)
      : "course.html?course=" + q(c.slug);
  const valueText = (c) =>
    c.status === "complete" ? "All " + c.total + " lessons complete" : c.done + " of " + c.total + " lessons complete";

  function countLine(c) {
    const p = el("p", "dash-count");
    p.setAttribute("aria-hidden", "true"); // the progressbar carries the same words
    if (c.status === "complete") p.append("All ", el("strong", null, String(c.total)), " lessons complete");
    else p.append(el("strong", null, String(c.done)), " of " + c.total + " lessons complete");
    return p;
  }

  function progressbar(node, c, labelledBy) {
    node.setAttribute("role", "progressbar");
    node.setAttribute("aria-labelledby", labelledBy);
    node.setAttribute("aria-valuemin", "0");
    node.setAttribute("aria-valuemax", String(c.total));
    node.setAttribute("aria-valuenow", String(c.done));
    node.setAttribute("aria-valuetext", valueText(c));
    return node;
  }

  function bar(c, labelledBy) {
    const b = el("div", "dash-bar");
    b.style.setProperty("--f", (c.total ? c.done / c.total : 0).toFixed(4));
    return progressbar(b, c, labelledBy);
  }

  function toolLinks(c) {
    const p = el("p", "dash-tool-links");
    const guide = el("a", null, "Study Guide");
    guide.href = "study-guide.html?course=" + q(c.slug);
    guide.append(sr(", " + c.title));
    const exam = el("a", null, "Practice Exam");
    exam.href = "practice-exam.html?course=" + q(c.slug);
    exam.append(sr(", " + c.title));
    p.append(guide, exam);
    return p;
  }

  function actionLink(c, cls) {
    const a = el("a", "btn " + cls, actionLabel(c));
    a.href = actionHref(c);
    a.append(sr(": " + c.title));
    return a;
  }

  function overview(courses, heading, note) {
    const frag = document.createDocumentFragment();
    const h2 = el("h2", "dash-section-title", heading);
    h2.id = "deskTitle";
    frag.append(h2);
    if (note) frag.append(note);
    const grid = el("div", "dash-overview dash-panel dash-ticks");
    courses.forEach((c) => {
      const a = el("article", "dash-course");
      a.dataset.course = c.slug;
      const name = el("h3", "dash-course-name");
      name.id = nextId("course");
      name.append(mark(c.slug), c.title);
      a.setAttribute("aria-labelledby", name.id);
      a.append(name, el("p", "dash-course-meta", c.hours + " course hours · Self-paced"));
      if (counted(c)) a.append(countLine(c), bar(c, name.id));
      const actions = el("div", "dash-course-actions");
      actions.append(actionLink(c, "btn-secondary dash-action"), toolLinks(c));
      a.append(actions);
      grid.append(a);
    });
    frag.append(grid);
    return frag;
  }

  function focusDesk(focus, others, note) {
    const frag = document.createDocumentFragment();
    const h2 = el("h2", "dash-section-title", "Continue where you left off");
    h2.id = "deskTitle";
    frag.append(h2);
    if (note) frag.append(note);

    const grid = el("div", "dash-deskgrid");
    const plate = el("article", "dash-plate dash-panel dash-ticks");
    plate.dataset.course = focus.slug;
    const name = el("h3", "dash-plate-name");
    name.id = nextId("focus");
    name.append(mark(focus.slug), focus.title);
    plate.setAttribute("aria-labelledby", name.id);

    // Module segments, sized by each module's lessons; the group is the course's
    // progressbar, its segments are visual detail only.
    const mods = el("div", "dash-modules");
    focus.modules.forEach((m) => {
      const seg = el("div", "dash-module");
      seg.style.setProperty("--n", String(m.total));
      const b = el("div", "dash-bar");
      b.style.setProperty("--f", (m.done / m.total).toFixed(4));
      seg.append(b, el("span", "dash-module-label", m.title), el("span", "dash-module-count", m.done + " of " + m.total));
      mods.append(seg);
    });
    progressbar(mods, focus, name.id);

    const next = el("div", "dash-next");
    const info = el("div");
    info.append(el("span", "dash-next-label", "Next lesson"));
    if (focus.nextLesson) {
      info.append(el("span", "dash-next-title", focus.nextLesson.title), el("span", "dash-next-module", focus.nextLesson.module));
    }
    next.append(info, actionLink(focus, "btn-primary"));

    plate.append(name, el("p", "dash-course-meta", focus.hours + " course hours · Self-paced"), countLine(focus), mods, next);

    const rail = el("aside", "dash-rail dash-panel");
    const railTitle = el("h3", "dash-rail-title", "Study tools");
    railTitle.id = nextId("rail");
    railTitle.append(sr(": " + focus.title));
    rail.setAttribute("aria-labelledby", railTitle.id);
    const list = el("ul", "dash-rail-list");
    [
      ["study-guide", "Study Guide", "A condensed, printable summary of the key facts from every lesson."],
      ["practice-exam", "Practice Exam", "Test yourself with practice questions and review what you missed."],
    ].forEach(([page, label, desc]) => {
      const li = el("li");
      const a = el("a", "dash-tool");
      a.href = page + ".html?course=" + q(focus.slug);
      const n = el("span", "dash-tool-name", label);
      n.append(sr(", " + focus.title));
      a.append(n, el("span", "dash-tool-desc", desc));
      li.append(a);
      list.append(li);
    });
    rail.append(railTitle, list);
    grid.append(plate, rail);
    frag.append(grid);

    if (others.length) {
      const shelf = el("section", "dash-subsection");
      const sh = el("h2", "dash-section-title", "Other courses");
      sh.id = "shelfTitle";
      shelf.setAttribute("aria-labelledby", sh.id);
      const rows = el("ul", "dash-shelf-list dash-panel");
      others.forEach((c) => {
        const li = el("li", "dash-row");
        li.dataset.course = c.slug;
        const info = el("div");
        const rn = el("h3", "dash-row-name");
        rn.id = nextId("row");
        rn.append(mark(c.slug), c.title);
        info.append(rn);
        if (counted(c)) info.append(countLine(c), bar(c, rn.id));
        const acts = el("div", "dash-row-actions");
        acts.append(actionLink(c, "btn-secondary"), toolLinks(c));
        li.append(info, acts);
        rows.append(li);
      });
      shelf.append(sh, rows);
      frag.append(shelf);
    }
    return frag;
  }

  function errorNote() {
    const p = el("p", "dash-note", ERROR_TEXT);
    p.setAttribute("role", "status");
    return p;
  }

  function show(frag) {
    desk.textContent = "";
    desk.append(frag);
    desk.removeAttribute("aria-busy");
    desk.classList.remove("dash-arrive");
    void desk.offsetWidth; // restart the one data-arrival fade
    desk.classList.add("dash-arrive");
  }

  // Loading: the static courses stay (names and routes), the count lines are held
  // by quiet static placeholders; no percentages are shown before the data.
  function showLoading() {
    desk.setAttribute("aria-busy", "true");
    desk.querySelectorAll(".dash-course").forEach((course) => {
      if (course.querySelector(".dash-skel")) return;
      const s = el("span", "dash-skel");
      s.setAttribute("aria-hidden", "true");
      course.querySelector(".dash-course-meta").after(s);
    });
  }

  function render(courses) {
    const failed = courses.some((c) => c.status === "unavailable");
    const note = failed ? errorNote() : null;
    const inProgress = courses.filter((c) => c.status === "progress");
    if (!inProgress.length) {
      const allDone = courses.every((c) => c.status === "complete");
      show(overview(courses, allDone ? "My courses" : failed ? "My courses" : "Choose where to start", note));
      return;
    }
    // Focus: the only in-progress course; among several, the most lessons
    // completed; a tie keeps the fixed Life, Health, Combo order.
    const focus = inProgress.slice().sort((a, b) => b.done - a.done || COURSES.findIndex((x) => x.slug === a.slug) - COURSES.findIndex((x) => x.slug === b.slug))[0];
    show(focusDesk(focus, courses.filter((c) => c !== focus), note));
  }

  async function load() {
    let session = null;
    try {
      // also throws when the Supabase script failed to load (auth.js never created the client)
      ({ data: { session } } = await supabaseClient.auth.getSession());
    } catch (e) {
      clearTimeout(safety);
      settleRole(null); // the session could not be read: neutral list, no admin tools
      return;
    }
    if (!session) { clearTimeout(safety); return; } // auth.js sends signed-out visitors to login.html

    const isAdmin = session.user.app_metadata && session.user.app_metadata.role === "admin";
    clearTimeout(safety);
    if (isAdmin) { settleRole("admin"); return; } // admins see their tools; no progress reads

    showLoading();
    settleRole("student");

    try {
      const [coursesRes, progressRes] = await Promise.all([
        supabaseClient
          .from("courses")
          .select("id, slug, modules(id, title, position, lessons(id, title, position))")
          .in("slug", COURSES.map((c) => c.slug)),
        supabaseClient.from("lesson_progress").select("lesson_id").eq("user_id", session.user.id),
      ]);
      if (coursesRes.error || progressRes.error || !Array.isArray(coursesRes.data)) throw new Error("read failed");
      const doneIds = new Set((progressRes.data || []).map((r) => r && r.lesson_id).filter((id) => id != null));
      const rows = new Map(coursesRes.data.map((r) => [r.slug, r]));
      render(COURSES.map((c) => buildCourse(c, rows.get(c.slug), doneIds)));
    } catch (e) {
      render(COURSES.map((c) => ({ ...c, status: "unavailable" })));
    }
  }

  load();
})();
