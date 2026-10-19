// The "no access" view shared by the course content pages (course, Study
// Guide, Practice Exam): the reader is signed in and the course exists, but
// they are not enrolled in it. Shown in place of the content; the content
// itself is never requested (and database rules would not return it).
window.LinhAccessView = (function () {
  const NO_ACCESS = "You don't have access to this course yet.";

  function link(text, href, cls) {
    const a = document.createElement("a");
    a.className = "btn " + cls;
    a.href = href;
    a.textContent = text;
    return a;
  }

  // A status panel with the approved message and the two ways on.
  function noAccess() {
    const box = document.createElement("div");
    box.className = "access-state";
    box.setAttribute("role", "status");
    const title = document.createElement("h2");
    title.className = "access-state-title";
    title.textContent = NO_ACCESS;
    const actions = document.createElement("div");
    actions.className = "access-state-actions";
    actions.append(link("Browse courses", "courses.html", "btn-primary"), link("Back to dashboard", "dashboard.html", "btn-secondary"));
    box.append(title, actions);
    return box;
  }

  return { noAccess, NO_ACCESS };
})();
