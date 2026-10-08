const manageGuideRoot = document.getElementById("manageGuideRoot");
// No default course: without ?course= the page asks the admin to choose one.
const MANAGE_GUIDE_COURSE_SLUG = new URLSearchParams(window.location.search).get("course");

// The preview iframe has no sandbox allowances and its document starts with this
// policy, so authored HTML can render but cannot run scripts, submit forms,
// open windows, reach this page or load anything from another server.
const PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
const PREVIEW_STYLE =
  "body{margin:16px;font:15px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1d2030;background:#fff;overflow-wrap:anywhere}" +
  "body.dark{color:#e6e8f2;background:#171a26}" +
  "h1,h2,h3,h4{line-height:1.3;margin:1.2em 0 .5em}h2:first-child{margin-top:0}" +
  "p,ul,ol,table{margin:0 0 .9em}ul,ol{padding-left:1.4em}" +
  "table{border-collapse:collapse}th,td{border:1px solid #c9ccd8;padding:4px 8px;text-align:left}" +
  "code{font-family:ui-monospace,Consolas,monospace;font-size:.9em}img{max-width:100%}" +
  // Visual only: links (including image-map areas) cannot be clicked, so nothing in
  // the preview can navigate the frame or reach another server.
  "a,area{pointer-events:none;cursor:default}";

// A textarea turns CRLF (and a lone CR) into LF. Stored text is compared in that
// form so opening an editor never counts as an edit; the stored value itself is
// never changed by this.
const asTextareaText = (s) => (s || "").replace(/\r\n?/g, "\n");
// A single-line input drops line breaks from its value.
const asInputText = (s) => (s || "").replace(/[\r\n]/g, "");
const characterCount = (s) => Array.from(s || "").length;

async function initManageGuide() {
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

  const bar = await LinhAdminCourseBar.render(document.getElementById("adminCourseBar"), {
    page: "guide",
    slug: MANAGE_GUIDE_COURSE_SLUG,
  });
  if (bar.status !== "ok") return;
  const course = bar.course;
  const courseId = course.id;
  // Authored sections of a published course are readable through the API, and the
  // student page has no release switch yet, so only draft courses are editable here.
  const editable = !course.published;

  const messageEl = document.getElementById("formMessage");
  const formContainer = document.getElementById("sectionFormContainer");
  const listEl = document.getElementById("sectionList");
  let sections = [];
  let editor = null; // { section, isDirty() } for the open form
  let messageTimeout = null;

  function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = "form-message " + type;
    clearTimeout(messageTimeout);
    if (type === "success") {
      messageTimeout = setTimeout(() => {
        messageEl.className = "form-message";
      }, 4000);
    }
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function button(label, onClick, extraClass) {
    const b = el("button", "btn-manage" + (extraClass ? " " + extraClass : ""), label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  document.getElementById("manageGuideTitle").textContent = "Manage Study Guide: " + course.title;

  const notes = document.getElementById("guideNotes");
  if (!editable) {
    notes.append(el("p", "admin-note",
      "This course is published. Authored Study Guide editing is temporarily available only for draft courses. " +
      "Release controls will be added before authored guides replace the current student Study Guide."));
  }
  notes.append(el("p", "admin-note",
    "Students still see the existing generated Study Guide. Authored sections will be connected to the student page in a later update."));

  // Warn before leaving (including course or tab switches) while an open form has edits.
  window.addEventListener("beforeunload", (e) => {
    if (editor && editor.isDirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  function confirmDiscard() {
    return !(editor && editor.isDirty()) || window.confirm("Discard your unsaved changes to this section?");
  }

  function closeEditor() {
    editor = null;
    formContainer.textContent = "";
  }

  const sectionLabel = (section, index) => section.heading != null && section.heading.trim() !== ""
    ? section.heading
    : "Section " + (index + 1);

  async function loadSections() {
    const { data, error } = await supabaseClient
      .from("study_guide_sections")
      .select("id, heading, content, position, created_at")
      .eq("course_id", courseId)
      .order("position")
      .order("created_at")
      .order("id");
    if (error) {
      showMessage("Study Guide sections could not be loaded: " + error.message, "error");
      return null;
    }
    return data || [];
  }

  // Reloads the list only; an open editor stays as it is.
  async function refresh() {
    const loaded = await loadSections();
    if (loaded === null) {
      sections = [];
      document.getElementById("sectionToolbar").hidden = true;
      closeEditor();
      listEl.textContent = "";
      return;
    }
    sections = loaded;
    if (editable) document.getElementById("sectionToolbar").hidden = false;
    if (editor && editor.section && !sections.some((s) => s.id === editor.section.id)) closeEditor();
    renderSections();
  }

  async function setPositions(ids) {
    const { error } = await supabaseClient.rpc("admin_set_positions", {
      p_entity: "study_guide_sections",
      p_parent: courseId,
      p_ids: ids,
    });
    if (error) {
      showMessage("The new order could not be saved (" + error.message + "). The list has been reloaded from the server.", "error");
      return false;
    }
    return true;
  }

  function renderSections() {
    listEl.textContent = "";

    if (!sections.length) {
      listEl.append(el("p", "manage-empty", editable
        ? "No authored sections yet. Click “+ Add section” to create the first one."
        : "No authored sections yet."));
      return;
    }

    // Positions must read 1..n in display order; otherwise offer a Renumber.
    if (editable && !sections.every((s, i) => s.position === i + 1)) {
      const warning = el("div", "admin-position-warning");
      warning.append(el("span", null, "Sections have duplicate or missing positions. The order shown is the saved order."),
        button("Renumber", async () => {
          if (await setPositions(sections.map((s) => s.id))) showMessage("Section order saved.", "success");
          refresh();
        }));
      listEl.append(warning);
    }

    sections.forEach((section, index) => {
      const card = el("div", "manage-module-card");
      card.dataset.sectionId = section.id;
      const header = el("div", "manage-module-header");
      const titleWrap = el("div", "manage-title-wrap");
      if (editable) {
        const handle = el("span", "drag-handle", "⠿");
        handle.title = "Drag to reorder";
        titleWrap.append(handle);
      }
      const hasHeading = section.heading != null && section.heading.trim() !== "";
      const title = el("h3", hasHeading ? null : "admin-untitled", sectionLabel(section, index));
      titleWrap.append(title);
      header.append(titleWrap);
      if (editable) {
        const actions = el("div", "manage-actions");
        actions.append(button("Edit", () => openEditor(section, index)),
          button("Delete", () => deleteSection(section, index), "btn-manage-danger"));
        header.append(actions);
      }
      card.append(header, el("p", "admin-hint", characterCount(section.content).toLocaleString("en-US") + " characters of content"));
      listEl.append(card);
    });

    if (editable && sections.length > 1) {
      makeListDraggable(listEl, ".manage-module-card", ".drag-handle", async (items) => {
        const ids = items.map((item) => item.dataset.sectionId);
        if (await setPositions(ids)) showMessage("Section order saved.", "success");
        refresh();
      });
    }
  }

  function previewDocument(heading, content) {
    const headingEl = el("h2", null, heading);
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    return "<!doctype html><html><head><meta charset=\"utf-8\">" +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"" + PREVIEW_CSP + "\">" +
      "<base target=\"_blank\"><style>" + PREVIEW_STYLE + "</style></head>" +
      "<body" + (dark ? " class=\"dark\"" : "") + ">" + (heading.trim() !== "" ? headingEl.outerHTML : "") +
      content + "</body></html>";
  }

  // existing === null for a new section.
  function openEditor(existing, index) {
    if (!editable) return;
    if (!confirmDiscard()) return;
    closeEditor();

    const form = el("form", "manage-form admin-section-form");
    form.noValidate = true;
    form.append(el("h3", null, existing ? "Edit " + sectionLabel(existing, index) : "New section"));

    const headingLabel = el("label", null, "Heading (optional)");
    headingLabel.htmlFor = "sectionHeadingInput";
    const heading = el("input");
    heading.type = "text";
    heading.id = "sectionHeadingInput";
    heading.autocomplete = "off";
    const headingHint = el("span", "admin-hint", "Shown as the section title. Leave blank for no heading.");
    headingHint.id = "sectionHeadingHint";
    heading.setAttribute("aria-describedby", headingHint.id);

    const contentLabel = el("label", null, "Content (HTML)");
    contentLabel.htmlFor = "sectionContentInput";
    const content = el("textarea", "admin-source");
    content.id = "sectionContentInput";
    content.rows = 16;
    content.spellcheck = false;
    content.setAttribute("autocapitalize", "off");
    content.setAttribute("autocomplete", "off");
    const contentHint = el("span", "admin-hint", "HTML is saved exactly as entered, including spacing and line breaks.");
    contentHint.id = "sectionContentHint";
    content.setAttribute("aria-describedby", contentHint.id);

    // Values go in through .value only (never as markup), so entities stay as typed.
    heading.value = existing ? existing.heading || "" : "";
    content.value = existing ? existing.content : "";

    const previewToggle = button("Show preview", () => togglePreview());
    previewToggle.setAttribute("aria-expanded", "false");
    previewToggle.setAttribute("aria-controls", "sectionPreviewFrame");
    const previewBar = el("div", "admin-preview-actions");
    previewBar.append(previewToggle, el("span", "admin-hint",
      "Preview is visual only; links are not interactive. It shows how a browser reads the HTML, not the final student styling."));
    const frame = el("iframe", "admin-preview-frame");
    frame.id = "sectionPreviewFrame";
    frame.title = "Study Guide section preview";
    frame.setAttribute("sandbox", "");
    // Kept out of keyboard navigation; the editable source is the labelled textarea.
    frame.tabIndex = -1;
    frame.hidden = true;
    let previewTimer = null;

    function renderPreview() {
      frame.srcdoc = previewDocument(heading.value, content.value);
    }
    function togglePreview() {
      const show = frame.hidden;
      frame.hidden = !show;
      previewToggle.textContent = show ? "Hide preview" : "Show preview";
      previewToggle.setAttribute("aria-expanded", String(show));
      if (show) renderPreview();
      else frame.removeAttribute("srcdoc");
    }
    const schedulePreview = () => {
      if (frame.hidden) return;
      clearTimeout(previewTimer);
      previewTimer = setTimeout(renderPreview, 300);
    };
    heading.addEventListener("input", schedulePreview);
    content.addEventListener("input", schedulePreview);

    const errorEl = el("p", "admin-form-error");
    errorEl.setAttribute("role", "alert");

    const actions = el("div", "manage-form-actions");
    const submit = el("button", "btn btn-primary", existing ? "Save section" : "Add section");
    submit.type = "submit";
    const cancel = el("button", "btn btn-secondary", "Cancel");
    cancel.type = "button";
    actions.append(submit, cancel);

    form.append(headingLabel, heading, headingHint, contentLabel, content, contentHint, previewBar, frame, errorEl, actions);

    const headingChanged = () => heading.value !== asInputText(existing ? existing.heading : "");
    const contentChanged = () => content.value !== asTextareaText(existing ? existing.content : "");
    editor = { section: existing, isDirty: () => headingChanged() || contentChanged() };

    cancel.addEventListener("click", () => {
      if (confirmDiscard()) closeEditor();
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.textContent = "";
      // A blank heading is stored as NULL; any other heading exactly as typed.
      const headingValue = heading.value.trim() === "" ? null : heading.value;

      if (existing) {
        const patch = {};
        if (headingChanged()) patch.heading = headingValue;
        if (contentChanged()) {
          if (content.value.trim() === "") {
            errorEl.textContent = "Enter the section content.";
            return;
          }
          patch.content = content.value;
        }
        if (!Object.keys(patch).length) {
          showMessage("No changes to save.", "success");
          return;
        }
        submit.disabled = true;
        const { error } = await supabaseClient.from("study_guide_sections").update(patch).eq("id", existing.id);
        submit.disabled = false;
        if (error) {
          errorEl.textContent = "The section could not be saved: " + error.message;
          return;
        }
        closeEditor();
        showMessage("Section updated.", "success");
      } else {
        if (content.value.trim() === "") {
          errorEl.textContent = "Enter the section content.";
          return;
        }
        submit.disabled = true;
        // Next free position: max(position) + 1, or 1 when there are none.
        const { data: last, error: positionError } = await supabaseClient
          .from("study_guide_sections")
          .select("position")
          .eq("course_id", courseId)
          .order("position", { ascending: false })
          .limit(1);
        if (positionError) {
          submit.disabled = false;
          errorEl.textContent = "The section could not be saved: " + positionError.message;
          return;
        }
        const position = last && last.length ? last[0].position + 1 : 1;
        const { error } = await supabaseClient
          .from("study_guide_sections")
          .insert({ course_id: courseId, heading: headingValue, content: content.value, position });
        submit.disabled = false;
        if (error) {
          errorEl.textContent = "The section could not be saved: " + error.message;
          return;
        }
        closeEditor();
        showMessage("Section added.", "success");
      }
      refresh();
    });

    formContainer.append(form);
    heading.focus();
  }

  async function deleteSection(section, index) {
    if (!editable) return;
    const n = characterCount(section.content).toLocaleString("en-US");
    if (!window.confirm(`Delete the section "${sectionLabel(section, index)}"? Its ${n} characters of content are permanently removed ` +
      "from this course's Study Guide. Lessons, questions and other sections are not affected. This can't be undone.")) return;
    const { error } = await supabaseClient.from("study_guide_sections").delete().eq("id", section.id);
    if (error) return showMessage("The section could not be deleted: " + error.message, "error");
    if (editor && editor.section && editor.section.id === section.id) closeEditor();
    showMessage("Section deleted.", "success");
    refresh();
  }

  if (editable) {
    document.getElementById("addSectionBtn").addEventListener("click", () => openEditor(null, sections.length));
  }
  refresh();
}

if (manageGuideRoot) {
  initManageGuide();
}
