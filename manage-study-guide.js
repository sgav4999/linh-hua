const manageGuideRoot = document.getElementById("manageGuideRoot");
// No default course: without ?course= the page asks the admin to choose one.
const MANAGE_GUIDE_COURSE_SLUG = new URLSearchParams(window.location.search).get("course");
// The three original courses; students see their generated guide until an authored
// one is released. Must match LEGACY_GUIDE_COURSES in study-guide.js.
const MANAGE_GUIDE_LEGACY_COURSES = ["life", "health", "life-health-combo"];

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
const plural = (n, one, many) => n.toLocaleString("en-US") + " " + (n === 1 ? one : many);

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
  const isLegacy = MANAGE_GUIDE_LEGACY_COURSES.includes(course.slug);
  const studentFallback = isLegacy
    ? "the generated Study Guide"
    : "a “Study Guide isn’t available yet” message";

  const messageEl = document.getElementById("formMessage");
  const releaseEl = document.getElementById("guideRelease");
  const formContainer = document.getElementById("sectionFormContainer");
  const listEl = document.getElementById("sectionList");
  let sections = [];
  // Release state as last read from the database: { published, released }.
  let release = null;
  let releaseBusy = false;
  let editor = null; // { section, isDirty(), updateLive() } for the open form
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

  // Live = students can read these sections right now.
  const isLive = () => !!release && release.published && release.released;

  async function loadReleaseState() {
    const { data, error } = await supabaseClient
      .from("courses")
      .select("id, published, study_guide_released")
      .eq("id", courseId)
      .maybeSingle();
    if (error || !data) return null;
    return { published: data.published === true, released: data.study_guide_released === true };
  }

  // ---- Release panel ---------------------------------------------------------
  function renderRelease() {
    releaseEl.textContent = "";
    if (!release) {
      releaseEl.hidden = true;
      return;
    }
    releaseEl.hidden = false;
    const n = sections.length;
    const head = el("div", "admin-release-head");
    const heading = el("h2", "admin-release-title", "Student release");
    heading.id = "guideReleaseHeading";
    const state = !release.published ? "draft" : release.released ? "released" : "unreleased";
    const status = el("span", "admin-release-status",
      (release.published ? "Published" : "Draft") + " · " + (release.released ? "Released" : "Not released"));
    status.dataset.state = state;
    head.append(heading, status);
    releaseEl.append(head);

    const text = el("p", "admin-release-text");
    const actions = el("div", "admin-release-actions");
    let action = null;
    if (!release.published && !release.released) {
      text.textContent = "This course is a draft, so its Study Guide can’t be released yet. " +
        "Publish the course first. You can keep writing and arranging sections in the meantime.";
    } else if (!release.published) {
      text.textContent = "The Study Guide is marked released, but students can’t see it while the course is a draft. " +
        (n ? "If the course is published again, its " + plural(n, "authored section becomes", "authored sections become") + " visible to students right away."
          : "It has no sections, so if the course is published again students see " + studentFallback + ".");
      action = el("button", "btn btn-secondary", "Unrelease Study Guide");
      action.addEventListener("click", () => setReleased(false));
    } else if (!release.released) {
      text.textContent = "Students can’t see these authored sections yet; they see " + studentFallback + ". " +
        "Releasing shows the sections below to signed-in students.";
      action = el("button", "btn btn-primary", "Release Study Guide");
      action.addEventListener("click", () => setReleased(true));
      if (!n) {
        action.disabled = true;
        const why = el("span", "admin-hint", "Add at least one section before releasing.");
        why.id = "guideReleaseWhy";
        action.setAttribute("aria-describedby", why.id);
        actions.append(action, why);
        action = null;
      }
    } else {
      text.textContent = n
        ? (n === 1 ? "Students see this section now." : "Students see these " + plural(n, "section", "sections") + " now.") + " Changes you save on this page are live immediately."
        : "The Study Guide is released but has no sections, so students see " + studentFallback + ".";
      action = el("button", "btn btn-secondary", "Unrelease Study Guide");
      action.addEventListener("click", () => setReleased(false));
    }
    actions.querySelectorAll("button").forEach((x) => { x.type = "button"; });
    if (action) {
      action.type = "button";
      actions.append(action);
    }
    releaseEl.append(text);
    if (actions.childNodes.length) releaseEl.append(actions);
    if (releaseBusy) {
      releaseEl.setAttribute("aria-busy", "true");
      releaseEl.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    } else {
      releaseEl.removeAttribute("aria-busy");
    }
  }

  async function setReleased(next) {
    if (releaseBusy || !release) return;
    const verb = next ? "released" : "unreleased";
    // Work from the saved state and section list, not what happened to be on screen.
    // This read never touches an open editor: on failure nothing is changed or sent.
    const [freshState, freshSections] = await Promise.all([loadReleaseState(), loadSections()]);
    if (!freshState || freshSections === null) {
      showMessage("The Study Guide was not " + verb + ": its saved state could not be checked. " +
        "Nothing was changed, and any section you are editing is still open. Try again.", "error");
      return;
    }
    release = freshState;
    sections = freshSections;
    renderRelease();
    renderSections();
    if (editor) editor.updateLive();
    const n = sections.length;
    if (next && (!release.published || !n)) return;
    const ok = next
      ? window.confirm(`Release the Study Guide for “${course.title}”? Signed-in students will see its ` +
        plural(n, "authored section", "authored sections") + (isLegacy ? " instead of the generated Study Guide" : "") +
        " right away. Edits you save afterwards are live immediately.")
      : window.confirm(`Unrelease the Study Guide for “${course.title}”? Students will stop seeing its authored sections` +
        (isLegacy ? " and see the generated Study Guide again" : "") + ". The sections themselves are kept.");
    if (!ok) return;

    releaseBusy = true;
    renderRelease();
    const { error } = await supabaseClient
      .from("courses")
      .update({ study_guide_released: next })
      .eq("id", courseId);
    // Always show the saved state, whatever the request reported.
    const saved = await loadReleaseState();
    releaseBusy = false;
    if (saved) release = saved;
    if (error) {
      showMessage("The Study Guide could not be " + verb + ": " + error.message + " The status shown is the saved one.", "error");
    } else if (!saved) {
      showMessage("The change was sent, but the saved status could not be reloaded. Refresh the page to check it.", "error");
    } else if (saved.released !== next) {
      showMessage("The Study Guide was not " + verb + ". The status shown is the saved one.", "error");
    } else {
      showMessage(next ? "Study Guide released. Students now see the authored sections."
        : "Study Guide unreleased. Students no longer see the authored sections.", "success");
    }
    renderRelease();
    renderSections();
    if (editor) editor.updateLive();
  }

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

  // Reloads the release state and the list; an open editor stays as it is.
  async function refresh() {
    const [state, loaded] = await Promise.all([loadReleaseState(), loadSections()]);
    if (!state) showMessage("The Study Guide release status could not be loaded. Refresh the page to try again.", "error");
    if (loaded === null || !state) {
      release = null;
      sections = [];
      document.getElementById("sectionToolbar").hidden = true;
      closeEditor();
      listEl.textContent = "";
      renderRelease();
      return;
    }
    release = state;
    sections = loaded;
    document.getElementById("sectionToolbar").hidden = false;
    if (editor && editor.section && !sections.some((s) => s.id === editor.section.id)) closeEditor();
    renderRelease();
    renderSections();
    if (editor) editor.updateLive();
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

  // The last section of a released guide can't be deleted (unrelease first).
  const isProtectedLast = () => !!release && release.released && sections.length === 1;

  function renderSections() {
    listEl.textContent = "";

    if (!sections.length) {
      listEl.append(el("p", "manage-empty", "No authored sections yet. Click “+ Add section” to create the first one."));
      return;
    }

    // Positions must read 1..n in display order; otherwise offer a Renumber.
    if (!sections.every((s, i) => s.position === i + 1)) {
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
      const handle = el("span", "drag-handle", "⠿");
      handle.title = "Drag to reorder";
      titleWrap.append(handle);
      const hasHeading = section.heading != null && section.heading.trim() !== "";
      const title = el("h3", hasHeading ? null : "admin-untitled", sectionLabel(section, index));
      titleWrap.append(title);
      header.append(titleWrap);
      const actions = el("div", "manage-actions");
      const del = button("Delete", () => deleteSection(section, index), "btn-manage-danger");
      actions.append(button("Edit", () => openEditor(section, index)), del);
      header.append(actions);
      card.append(header, el("p", "admin-hint", characterCount(section.content).toLocaleString("en-US") + " characters of content"));
      if (isProtectedLast()) {
        del.disabled = true;
        const why = el("p", "admin-hint", "This is the only section of a released Study Guide, so it can’t be deleted. " +
          "Unrelease the Study Guide first, or add another section.");
        why.id = "guideLastSectionWhy";
        del.setAttribute("aria-describedby", why.id);
        card.append(why);
      }
      listEl.append(card);
    });

    if (sections.length > 1) {
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

  // Notes about markup the student page won't show as written (checked on the
  // source text; nothing is changed).
  function contentWarnings(value) {
    const out = [];
    if (/<img[\s/>]/i.test(value)) {
      out.push("This content has an image (an img tag). Images aren’t supported in the student Study Guide yet and are removed when students view it.");
    }
    if (/<h[12][\s/>]/i.test(value)) {
      out.push("This content has an h1 or h2. Students see its text without the heading style; use h3–h6 for headings inside a section.");
    }
    return out;
  }

  // existing === null for a new section.
  function openEditor(existing, index) {
    if (!confirmDiscard()) return;
    closeEditor();

    const form = el("form", "manage-form admin-section-form");
    form.noValidate = true;
    form.append(el("h3", null, existing ? "Edit " + sectionLabel(existing, index) : "New section"));
    const liveNote = el("p", "admin-live-note");
    liveNote.append(el("strong", null, "Live"), document.createTextNode(" Saving changes the student Study Guide immediately."));
    form.append(liveNote);

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
    const contentHint = el("span", "admin-hint", "HTML is saved exactly as entered, including spacing and line breaks. " +
      "Students see a cleaned copy: scripts, styles, forms, embedded media and images are removed, h1/h2 show as plain text " +
      "(use h3–h6), and web links open in a new tab.");
    contentHint.id = "sectionContentHint";
    const warningsEl = el("div", "admin-content-warnings");
    warningsEl.id = "sectionContentWarnings";
    warningsEl.setAttribute("aria-live", "polite");
    content.setAttribute("aria-describedby", contentHint.id + " " + warningsEl.id);

    // Values go in through .value only (never as markup), so entities stay as typed.
    heading.value = existing ? existing.heading || "" : "";
    content.value = existing ? existing.content : "";

    function renderWarnings() {
      const list = contentWarnings(content.value);
      warningsEl.textContent = "";
      list.forEach((t) => warningsEl.append(el("p", "admin-content-warning", t)));
    }
    renderWarnings();

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
    let warningTimer = null;
    content.addEventListener("input", () => {
      clearTimeout(warningTimer);
      warningTimer = setTimeout(renderWarnings, 300);
    });

    const errorEl = el("p", "admin-form-error");
    errorEl.setAttribute("role", "alert");

    const actions = el("div", "manage-form-actions");
    const submit = el("button", "btn btn-primary");
    submit.type = "submit";
    const cancel = el("button", "btn btn-secondary", "Cancel");
    cancel.type = "button";
    actions.append(submit, cancel);

    form.append(headingLabel, heading, headingHint, contentLabel, content, contentHint, warningsEl, previewBar, frame, errorEl, actions);

    const headingChanged = () => heading.value !== asInputText(existing ? existing.heading : "");
    const contentChanged = () => content.value !== asTextareaText(existing ? existing.content : "");
    const updateLive = () => {
      const live = isLive();
      liveNote.hidden = !live;
      submit.textContent = (existing ? "Save section" : "Add section") + (live ? " (live)" : "");
    };
    editor = { section: existing, isDirty: () => headingChanged() || contentChanged(), updateLive };
    updateLive();

    cancel.addEventListener("click", () => {
      if (confirmDiscard()) closeEditor();
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.textContent = "";
      // A blank heading is stored as NULL; any other heading exactly as typed.
      const headingValue = heading.value.trim() === "" ? null : heading.value;
      const liveSuffix = isLive() ? " The change is live for students." : "";

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
        showMessage("Section updated." + liveSuffix, "success");
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
        showMessage("Section added." + liveSuffix, "success");
      }
      refresh();
    });

    formContainer.append(form);
    heading.focus();
  }

  async function deleteSection(section, index) {
    // Check against the saved state, not what happened to be on screen.
    const [state, saved] = await Promise.all([loadReleaseState(), loadSections()]);
    if (!state || saved === null) {
      showMessage("The section was not deleted: the Study Guide could not be checked. Refresh the page to try again.", "error");
      return;
    }
    release = state;
    sections = saved;
    if (!sections.some((s) => s.id === section.id)) {
      showMessage("That section no longer exists. The list has been reloaded.", "error");
      renderRelease();
      renderSections();
      return;
    }
    if (isProtectedLast()) {
      showMessage("This is the only section of a released Study Guide, so it can’t be deleted. " +
        "Unrelease the Study Guide first, or add another section.", "error");
      renderRelease();
      renderSections();
      return;
    }
    const n = characterCount(section.content).toLocaleString("en-US");
    if (!window.confirm(`Delete the section "${sectionLabel(section, index)}"? Its ${n} characters of content are permanently removed ` +
      "from this course's Study Guide" + (isLive() ? ", and students stop seeing it immediately" : "") +
      ". Lessons, questions and other sections are not affected. This can't be undone.")) return;
    const { error } = await supabaseClient.from("study_guide_sections").delete().eq("id", section.id);
    if (error) return showMessage("The section could not be deleted: " + error.message, "error");
    if (editor && editor.section && editor.section.id === section.id) closeEditor();
    showMessage("Section deleted.", "success");
    refresh();
  }

  document.getElementById("addSectionBtn").addEventListener("click", () => openEditor(null, sections.length));
  refresh();
}

if (manageGuideRoot) {
  initManageGuide();
}
