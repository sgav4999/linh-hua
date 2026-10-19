const studentsRoot = document.getElementById("studentsRoot");

async function initStudents() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }
  const role = session.user.app_metadata && session.user.app_metadata.role;
  if (role !== "admin") {
    window.location.href = "dashboard.html";
    return;
  }

  const messageEl = document.getElementById("formMessage");
  const tbody = document.getElementById("studentsTableBody");
  const statsEl = document.getElementById("studentStats");
  const searchInput = document.getElementById("studentSearch");
  const currentUserId = session.user.id;
  let profiles = [];

  // ---- Course access (Phase 9) ---------------------------------------------
  // An admin grants a course (one enrollment row: source "admin", granted_by =
  // this admin) or revokes it (deletes that exact student + course row). The
  // database rules decide what is allowed; this page never writes another
  // source and never edits a row. Admin accounts get no controls: their access
  // comes from their JWT role, not from enrollments. (profiles.role only picks
  // the rows that show the control here; it authorizes nothing.)
  let courses = null; // every course, published and draft; null = could not load
  const expanded = new Set(); // students whose access panel is open
  const accessCache = new Map(); // student id -> Map(course id -> source) | null (read failed)
  const busy = new Set(); // students with a grant/revoke in flight
  const statusFor = new Map(); // student id -> { text, kind }
  const SOURCE_LABEL = { legacy: "Legacy", admin: "Admin", purchase: "Purchase" };
  const hasAccessControls = (p) => p.id !== currentUserId && p.role !== "admin";
  const panelId = (p) => "access-" + p.id;
  const who = (p) => p.full_name || p.email;

  function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = "form-message " + type;
  }

  function formatDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderRows(rows) {
    tbody.innerHTML = "";

    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.className = "students-empty";
      td.textContent = "No accounts match your search.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    rows.forEach((p) => {
      const tr = document.createElement("tr");

      const nameTd = document.createElement("td");
      nameTd.textContent = p.full_name || "—";

      const emailTd = document.createElement("td");
      emailTd.textContent = p.email;

      const roleTd = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "role-badge " + (p.role === "admin" ? "role-badge-admin" : "role-badge-student");
      badge.textContent = p.role === "admin" ? "Admin" : "Student";
      roleTd.appendChild(badge);

      const joinedTd = document.createElement("td");
      joinedTd.textContent = formatDate(p.created_at);

      const actionsTd = document.createElement("td");
      if (p.id === currentUserId) {
        actionsTd.textContent = "—";
      } else {
        const actions = el("div", "students-actions");
        const actionBtn = document.createElement("button");
        actionBtn.type = "button";
        const promoting = p.role !== "admin";
        actionBtn.className = "btn-manage" + (promoting ? "" : " btn-manage-danger");
        actionBtn.textContent = promoting ? "Promote to Admin" : "Demote to Student";
        actionBtn.addEventListener("click", () => handleRoleChange(p, actionBtn));
        actions.appendChild(actionBtn);
        if (hasAccessControls(p)) {
          const accessBtn = el("button", "btn-manage", "Course access");
          accessBtn.type = "button";
          accessBtn.setAttribute("aria-expanded", String(expanded.has(p.id)));
          accessBtn.setAttribute("aria-controls", panelId(p));
          accessBtn.dataset.accessToggle = p.id;
          accessBtn.addEventListener("click", () => toggleAccess(p));
          actions.appendChild(accessBtn);
        }
        actionsTd.appendChild(actions);
      }

      tr.appendChild(nameTd);
      tr.appendChild(emailTd);
      tr.appendChild(roleTd);
      tr.appendChild(joinedTd);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
      if (hasAccessControls(p) && expanded.has(p.id)) tbody.appendChild(accessRow(p));
    });
  }

  function accessRow(p) {
    const tr = el("tr", "students-access-row");
    const td = document.createElement("td");
    td.colSpan = 5;
    const panel = el("div", "students-access");
    panel.id = panelId(p);
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "Course access for " + who(p));
    td.appendChild(panel);
    tr.appendChild(td);
    drawPanel(p, panel);
    return tr;
  }

  // Draws one student's panel from the cache (no request here).
  function drawPanel(p, panel) {
    if (!panel) return;
    panel.textContent = "";
    panel.append(el("h3", "students-access-title", "Course access"));
    const status = statusFor.get(p.id);
    if (!courses) {
      panel.append(el("p", "students-access-status error", "Courses could not be loaded. Refresh the page to manage access."));
      return;
    }
    const mine = accessCache.get(p.id);
    if (mine === undefined) {
      panel.append(el("p", "students-access-status", "Loading access…"));
      return;
    }
    if (mine === null) {
      panel.append(el("p", "students-access-status error", "This student's access could not be loaded. Close and reopen to try again."));
      return;
    }
    panel.append(el("p", "students-access-note", "A draft course can be granted ahead of time; access activates when it is published."));
    const list = el("ul", "students-access-list");
    const pending = busy.has(p.id);
    courses.forEach((c) => {
      const source = mine.get(c.id);
      const item = el("li", "students-access-item");
      const info = el("div", "students-access-course");
      info.append(el("strong", null, c.title));
      const state = c.published ? "Published" : "Draft — access activates when published";
      const access = source ? "Access: " + (SOURCE_LABEL[source] || "Granted") : "No access";
      info.append(el("span", "students-access-meta", state + " · " + access));
      const btn = el("button", "btn-manage" + (source ? " btn-manage-danger" : ""), source ? "Revoke access" : "Grant access");
      btn.type = "button";
      btn.disabled = pending;
      btn.dataset.course = c.id;
      btn.setAttribute("aria-label", (source ? "Revoke access to " : "Grant access to ") + c.title + " for " + who(p));
      btn.addEventListener("click", () => (source ? revoke(p, c, source) : grant(p, c)));
      item.append(info, btn);
      list.append(item);
    });
    panel.append(list);
    const statusEl = el("p", "students-access-status" + (status && status.kind === "error" ? " error" : ""), status ? status.text : "");
    statusEl.setAttribute("role", "status");
    panel.append(statusEl);
  }
  const redraw = (p) => drawPanel(p, document.getElementById(panelId(p)));
  // Re-rendering replaces the buttons; keyboard focus returns to the new one.
  const focusToggle = (p) => {
    const b = tbody.querySelector("[data-access-toggle=\"" + CSS.escape(p.id) + "\"]");
    if (b) b.focus();
  };
  const focusCourseButton = (p, c) => {
    const panel = document.getElementById(panelId(p));
    const b = panel && panel.querySelector("button[data-course=\"" + CSS.escape(c.id) + "\"]");
    if (b) b.focus();
  };

  // This student's enrollment rows only (refreshed after every change).
  async function loadAccess(p) {
    try {
      const { data, error } = await supabaseClient.from("enrollments").select("course_id, source").eq("user_id", p.id);
      accessCache.set(p.id, error || !Array.isArray(data) ? null : new Map(data.map((r) => [r.course_id, r.source])));
    } catch (e) {
      accessCache.set(p.id, null);
    }
  }

  async function toggleAccess(p) {
    if (expanded.has(p.id)) {
      expanded.delete(p.id);
      applySearch();
      focusToggle(p);
      return;
    }
    expanded.add(p.id);
    accessCache.delete(p.id);
    statusFor.delete(p.id);
    applySearch();
    focusToggle(p);
    await loadAccess(p);
    redraw(p);
  }

  // Runs one grant/revoke: buttons stay disabled until the database answers,
  // success is only reported when it confirms exactly one row, and the
  // student's rows are re-read either way.
  async function mutate(p, c, pendingText, request, okText, failText) {
    if (busy.has(p.id)) return;
    busy.add(p.id);
    statusFor.set(p.id, { text: pendingText, kind: "pending" });
    redraw(p);
    let ok = false;
    let detail = "";
    try {
      const { data, error } = await request();
      ok = !error && Array.isArray(data) && data.length === 1;
      if (error) detail = error.message;
    } catch (e) {
      detail = e && e.message;
    }
    await loadAccess(p);
    busy.delete(p.id);
    statusFor.set(p.id, ok ? { text: okText, kind: "success" } : { text: failText + (detail ? " (" + detail + ")" : ""), kind: "error" });
    redraw(p);
    focusCourseButton(p, c);
  }

  function grant(p, c) {
    return mutate(
      p,
      c,
      "Granting access to " + c.title + "…",
      () => supabaseClient
        .from("enrollments")
        .insert({ user_id: p.id, course_id: c.id, source: "admin", granted_by: currentUserId })
        .select("course_id"),
      "Access to " + c.title + " granted.",
      "Access to " + c.title + " was not granted."
    );
  }

  function revoke(p, c, source) {
    const confirmed = window.confirm(
      "Remove " + who(p) + "'s access to " + c.title + "?\n\nThey lose its lessons, Study Guide and Practice Exam right away. " +
      "Their progress is kept." + (source === "legacy" ? " Granting it again later records it as an admin grant." : "")
    );
    if (!confirmed) return;
    return mutate(
      p,
      c,
      "Removing access to " + c.title + "…",
      () => supabaseClient
        .from("enrollments")
        .delete()
        .eq("user_id", p.id)
        .eq("course_id", c.id)
        .select("course_id"),
      "Access to " + c.title + " removed.",
      "Access to " + c.title + " was not removed."
    );
  }

  async function handleRoleChange(profile, btn) {
    const action = profile.role === "admin" ? "demote" : "promote";
    const verb = action === "promote" ? "Promote" : "Demote";
    const confirmed = window.confirm(
      `${verb} ${profile.email} ${action === "promote" ? "to admin" : "to a student"}?`
    );
    if (!confirmed) return;

    btn.disabled = true;
    // The deployed Edge Function is still named "set-staff-role" — that's
    // just its internal endpoint slug and isn't shown anywhere; only the
    // role value it reads/writes ("admin") changed.
    const { data, error } = await supabaseClient.functions.invoke("set-staff-role", {
      body: { email: profile.email, action },
    });

    if (error) {
      let msg = error.message;
      try {
        if (error.context && typeof error.context.json === "function") {
          const body = await error.context.json();
          if (body && body.error) msg = body.error;
        }
      } catch (_) {
        // fall back to error.message
      }
      showMessage(msg || "Could not update that account's role.", "error");
      btn.disabled = false;
      return;
    }
    if (data && data.error) {
      showMessage(data.error, "error");
      btn.disabled = false;
      return;
    }

    profile.role = data.role;
    if (profile.role === "admin") expanded.delete(profile.id);
    showMessage(`${profile.email} is now ${data.role === "admin" ? "an admin" : "a student"}.`, "success");
    renderStats(profiles);
    applySearch();
  }

  function renderStats(rows) {
    const studentCount = rows.filter((p) => p.role !== "admin").length;
    const adminCount = rows.filter((p) => p.role === "admin").length;
    statsEl.textContent = `${studentCount} student${studentCount === 1 ? "" : "s"} · ${adminCount} admin${adminCount === 1 ? "" : "s"}`;
  }

  function applySearch() {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      renderRows(profiles);
      return;
    }
    const filtered = profiles.filter(
      (p) =>
        (p.full_name && p.full_name.toLowerCase().includes(query)) ||
        p.email.toLowerCase().includes(query)
    );
    renderRows(filtered);
  }

  searchInput.addEventListener("input", applySearch);

  const [{ data, error }, loadedCourses] = await Promise.all([
    supabaseClient
      .from("profiles")
      .select("id, email, full_name, role, created_at")
      .order("created_at", { ascending: false }),
    window.LinhCourses ? LinhCourses.loadAllCourses().catch(() => null) : Promise.resolve(null),
  ]);
  courses = loadedCourses;

  if (error) {
    showMessage("Could not load students: " + error.message, "error");
    return;
  }

  profiles = data || [];
  renderStats(profiles);
  renderRows(profiles);
}

if (studentsRoot) {
  initStudents();
}
