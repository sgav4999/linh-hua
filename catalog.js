// Courses catalog: renders the published courses from the database, grouped by
// category. Reads only: the published courses (LinhCourses.loadPublishedCourses,
// readable signed out) and, for a signed-in student, their own enrollments.
// Admins and signed-out visitors make no enrollment read. catalog-model.js
// decides grouping, card content and each card's action; nothing here names a
// course or a category. Everything database-supplied is written with
// textContent; nothing is parsed as HTML.
(function () {
  const list = document.getElementById("catalogList");
  if (!list) return;

  const ERROR_TEXT = "The course list could not be loaded. Please refresh the page to try again.";
  const EMPTY_TEXT = "New courses are being prepared. Check back soon.";

  // Marks that this script is running: the CSS failsafe (the failure line after
  // 6s) applies only while the list has no data-state, i.e. when this script
  // never ran. A slow but working load stays "loading" until show() replaces it.
  list.setAttribute("aria-busy", "true");
  list.setAttribute("data-state", "loading");

  // ---- small DOM helpers ----------------------------------------------------
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const sr = (text) => el("span", "catalog-sr", text);
  const decorative = (node) => {
    node.setAttribute("aria-hidden", "true");
    return node;
  };
  const link = (cls, text, href) => {
    const a = el("a", cls, text);
    a.href = href;
    return a;
  };
  let uid = 0;
  const nextId = (prefix) => prefix + "-" + (++uid);

  // ---- views ------------------------------------------------------------------
  function card(c) {
    const article = el("article", "catalog-card");
    if (window.LinhCourses) LinhCourses.applyCourseIdentity(article, c);
    const title = el("h3", "catalog-card-title");
    title.id = nextId("course");
    title.append(decorative(el("span", "catalog-card-mark")), c.title);
    article.setAttribute("aria-labelledby", title.id);

    const body = el("div", "catalog-card-body");
    if (c.label) body.append(el("p", "catalog-card-label", c.label));
    body.append(title);
    if (c.description) body.append(el("p", "catalog-card-desc", c.description));
    body.append(el("p", "catalog-card-meta", c.meta));

    const action = el("div", "catalog-card-action");
    if (c.action.type === "link") {
      const a = link("btn btn-secondary catalog-card-link", c.action.text, c.action.href);
      a.append(sr(": " + c.title));
      action.append(a);
    } else {
      action.append(el("p", "catalog-card-status", c.action.text));
    }
    body.append(action);

    article.append(decorative(el("span", "catalog-card-band")), body);
    return article;
  }

  function categorySection(group) {
    const section = el("section", "catalog-category");
    const h2 = el("h2", "catalog-category-title", group.title);
    h2.id = nextId("category");
    section.setAttribute("aria-labelledby", h2.id);
    const cards = el("div", "catalog-cards");
    group.courses.forEach((c) => cards.append(card(c)));
    section.append(h2, cards);
    return section;
  }

  function note(text) {
    const box = el("div", "catalog-state");
    const p = el("p", "catalog-state-text", text);
    p.setAttribute("role", "status");
    box.append(p);
    return box;
  }

  function emptyView() {
    const box = note(EMPTY_TEXT);
    box.append(link("btn btn-secondary", "Contact us", "contact.html"));
    return box;
  }

  function show(node, state) {
    list.textContent = "";
    list.append(node);
    list.setAttribute("data-state", state);
    list.removeAttribute("aria-busy");
    list.classList.remove("catalog-arrive");
    void list.offsetWidth; // restart the one data-arrival fade
    list.classList.add("catalog-arrive");
  }

  // The page-level account link (in the closing panel; its static default is
  // the signed-out "Already enrolled? Log in").
  function showAccount(account) {
    const a = document.getElementById("catalogAccountLink");
    if (!a || !account) return;
    a.textContent = account.text;
    a.href = account.href;
  }

  // ---- viewer ---------------------------------------------------------------------
  // A session that cannot be read is treated as signed out. Admins open every
  // published course without an enrollment read; a student's failed
  // enrollment read is reported as such, never as "not enrolled".
  async function readViewer() {
    let session = null;
    try {
      const res = await supabaseClient.auth.getSession();
      if (res && res.error) return { kind: "signed-out" };
      session = res && res.data ? res.data.session : null;
    } catch (e) {
      return { kind: "signed-out" };
    }
    if (!session || !session.user) return { kind: "signed-out" };
    if (LinhCourses.isAdminSession(session)) return { kind: "admin" };
    try {
      return { kind: "student", access: await LinhCourses.loadMyEnrollments(session.user.id) };
    } catch (e) {
      return { kind: "student", accessFailed: true };
    }
  }

  async function load() {
    const Model = window.LinhCatalogModel;
    if (!Model || !window.LinhCourses) {
      show(note(ERROR_TEXT), "error");
      return;
    }
    // The page-level account link depends only on who is looking, so it is
    // updated as soon as that is known, not after the course read.
    // (readViewer never rejects: any failure resolves to a safe viewer.)
    const viewerP = readViewer();
    viewerP.then((v) => showAccount(Model.accountLink(v)));
    const [courses, viewer] = await Promise.all([
      LinhCourses.loadPublishedCourses().then((rows) => ({ rows }), () => ({ failed: true })),
      viewerP,
    ]);
    if (courses.failed) {
      show(note(ERROR_TEXT), "error");
      return;
    }
    const catalog = Model.buildCatalog(courses.rows, viewer);
    if (!catalog.total) {
      show(emptyView(), "empty");
      return;
    }
    const frag = document.createDocumentFragment();
    catalog.groups.forEach((g) => frag.append(categorySection(g)));
    show(frag, "ready");
  }

  load().catch(() => show(note(ERROR_TEXT), "error"));
})();
