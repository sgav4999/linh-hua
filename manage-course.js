const manageRoot = document.getElementById("manageRoot");
// No default course: without ?course= the page asks the admin to choose one.
const MANAGE_COURSE_SLUG = new URLSearchParams(window.location.search).get("course");

const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HOURS_FORMAT = /^\d{1,4}(\.\d)?$/; // numeric(5,1), > 0
const LESSON_TYPES = [
  ["video", "Video"],
  ["text", "Text"],
  ["quiz", "Progress Check (quiz)"],
];

async function initManage() {
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
  const courseFormContainer = document.getElementById("courseFormContainer");
  const detailsBtn = document.getElementById("courseDetailsBtn");
  let courseId = null;
  let course = null;
  let allCourses = [];
  let categories = [];
  let messageTimeout = null;

  function showMessage(text, type, persist) {
    messageEl.textContent = text;
    messageEl.className = "form-message " + type;
    clearTimeout(messageTimeout);
    if (!persist) {
      messageTimeout = setTimeout(() => {
        messageEl.className = "form-message";
      }, 4000);
    }
  }

  function button(label, onClick, extraClass) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = "btn-manage" + (extraClass ? " " + extraClass : "");
    b.addEventListener("click", onClick);
    return b;
  }

  function field(form, labelText, control, id, hint) {
    const label = document.createElement("label");
    label.textContent = labelText;
    label.htmlFor = id;
    control.id = id;
    form.append(label, control);
    if (hint) {
      const h = document.createElement("span");
      h.className = "admin-hint";
      h.id = id + "Hint";
      h.textContent = hint;
      control.setAttribute("aria-describedby", h.id);
      form.append(h);
    }
    return control;
  }

  function option(value, text) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    return o;
  }

  // Next free position among siblings: max(position) + 1, or 1 when empty.
  async function nextPosition(table, parentColumn, parentValue) {
    let query = supabaseClient.from(table).select("position");
    query = parentValue == null ? query.is(parentColumn, null) : query.eq(parentColumn, parentValue);
    const { data, error } = await query.order("position", { ascending: false }).limit(1);
    if (error) throw error;
    return data && data.length ? data[0].position + 1 : 1;
  }

  // Positions must read 1..n in display order; anything else (duplicates, gaps)
  // gets a warning with a Renumber action.
  const positionsClean = (rows) => rows.every((r, i) => r.position === i + 1);

  async function setPositions(entity, parentId, ids) {
    const { error } = await supabaseClient.rpc("admin_set_positions", { p_entity: entity, p_parent: parentId, p_ids: ids });
    if (error) {
      showMessage("The new order could not be saved (" + error.message + "). The list has been reloaded from the server.", "error", true);
      return false;
    }
    return true;
  }

  function positionWarning(label, onRenumber) {
    const w = document.createElement("div");
    w.className = "admin-position-warning";
    const t = document.createElement("span");
    t.textContent = label + " have duplicate or missing positions. The order shown is the saved order.";
    w.append(t, button("Renumber", onRenumber));
    return w;
  }

  // --- Course metadata (new course / course details) ---

  function identityOptions(select, current, exclude, emptyLabel) {
    select.textContent = "";
    select.append(option("", emptyLabel));
    LinhCourses.IDENTITY_TOKENS.filter((t) => t !== exclude).forEach((t) => {
      select.append(option(t, t.charAt(0).toUpperCase() + t.slice(1)));
    });
    // A stored token the registry doesn't know is kept until the admin picks another value.
    if (current && !LinhCourses.IDENTITY_TOKENS.includes(current)) {
      select.append(option(current, "Unknown (" + current + ")"));
    }
    select.value = current && current !== exclude ? current : "";
  }

  function buildCourseForm(existing) {
    const form = document.createElement("form");
    form.className = "manage-form admin-course-form";
    form.noValidate = true;
    const heading = document.createElement("h3");
    heading.textContent = existing ? "Course details" : "New course";
    form.append(heading);

    const title = field(form, "Title", document.createElement("input"), "courseTitleInput");
    title.type = "text";
    title.required = true;

    const slug = field(form, "Slug", document.createElement("input"), "courseSlugInput",
      existing ? "The slug is part of every course link and can't be changed." : "Lowercase letters, numbers and single hyphens, e.g. my-course. It can't be changed later.");
    slug.type = "text";
    slug.autocomplete = "off";
    slug.spellcheck = false;
    if (existing) slug.readOnly = true;

    const shortLabel = field(form, "Short label (optional)", document.createElement("input"), "courseShortLabelInput");
    shortLabel.type = "text";

    const category = field(form, "Category", document.createElement("select"), "courseCategorySelect");
    category.append(option("", "No category"));
    categories.forEach((c) => category.append(option(c.id, c.title)));

    const unknownIdentity = existing && existing.identity && !LinhCourses.IDENTITY_TOKENS.includes(existing.identity);
    const identity = field(form, "Identity", document.createElement("select"), "courseIdentitySelect",
      unknownIdentity ? "\"" + existing.identity + "\" isn't a known identity, so the course shows the Neutral colours. It's kept until you choose another." : null);
    const secondary = field(form, "Secondary identity", document.createElement("select"), "courseSecondarySelect",
      "Optional second colour (the Combo uses one). Needs a primary identity.");
    const preview = document.createElement("span");
    preview.className = "admin-identity-preview";
    preview.setAttribute("aria-hidden", "true");
    form.append(preview);

    const hours = field(form, "Course hours (optional)", document.createElement("input"), "courseHoursInput", "A number greater than 0, e.g. 20 or 7.5.");
    hours.type = "text";
    hours.inputMode = "decimal";

    const description = field(form, "Description (optional)", document.createElement("textarea"), "courseDescriptionInput");
    description.rows = 3;

    let published = null;
    if (existing) {
      published = field(form, "Status", document.createElement("select"), "coursePublishedSelect");
      published.append(option("false", "Draft"), option("true", "Published"));
    }

    const note = document.createElement("p");
    note.className = "admin-note";
    note.textContent = existing
      ? "Draft courses are hidden from course lists, but signed-in accounts can still read draft content through the API until the next security update. Don't add unpublished material yet."
      : "New courses start as drafts. Drafts are hidden from course lists, but signed-in accounts can still read draft content through the API until the next security update.";
    form.append(note);

    const errorEl = document.createElement("p");
    errorEl.className = "admin-form-error";
    errorEl.setAttribute("role", "alert");
    form.append(errorEl);

    const actions = document.createElement("div");
    actions.className = "manage-form-actions";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "btn btn-primary";
    submit.textContent = existing ? "Save course" : "Create draft course";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-secondary";
    cancel.textContent = "Cancel";
    actions.append(submit, cancel);
    form.append(actions);

    // Values
    if (existing) {
      title.value = existing.title || "";
      slug.value = existing.slug;
      shortLabel.value = existing.short_label || "";
      category.value = existing.category_id || "";
      hours.value = existing.hours == null ? "" : String(existing.hours);
      description.value = existing.description || "";
      published.value = existing.published ? "true" : "false";
    }
    const startIdentity = existing ? existing.identity : null;
    const startSecondary = existing ? existing.identity_secondary : null;
    identityOptions(identity, startIdentity, null, "Neutral");
    const syncSecondary = (keep) => {
      identityOptions(secondary, keep, identity.value, "None");
      secondary.disabled = identity.value === "";
      if (secondary.disabled) secondary.value = "";
      LinhCourses.applyCourseIdentity(preview, { identity: identity.value || null, identity_secondary: secondary.value || null });
    };
    syncSecondary(startSecondary);
    identity.addEventListener("change", () => syncSecondary(secondary.value));
    secondary.addEventListener("change", () => syncSecondary(secondary.value));

    return { form, title, slug, shortLabel, category, identity, secondary, hours, description, published, errorEl, submit, cancel };
  }

  function readCourseForm(f, existing) {
    const errors = [];
    const title = f.title.value.trim();
    const slug = f.slug.value.trim();
    const hoursText = f.hours.value.trim();
    if (!title) errors.push("Enter a title.");
    if (!existing) {
      if (!slug) errors.push("Enter a slug.");
      else if (!SLUG_FORMAT.test(slug)) errors.push("The slug can only use lowercase letters, numbers and single hyphens (for example my-course).");
      else if (allCourses.some((c) => c.slug === slug)) errors.push("That slug is already used by another course.");
    }
    let hours = null;
    if (hoursText) {
      if (!HOURS_FORMAT.test(hoursText) || Number(hoursText) <= 0) errors.push("Course hours must be a number greater than 0 with at most one decimal place.");
      else hours = Number(hoursText);
    }
    return {
      errors,
      values: {
        title,
        slug,
        short_label: f.shortLabel.value.trim() || null,
        category_id: f.category.value || null,
        identity: f.identity.value || null,
        identity_secondary: f.identity.value ? f.secondary.value || null : null,
        hours,
        description: f.description.value.trim() || null,
        published: f.published ? f.published.value === "true" : false,
      },
    };
  }

  function describeDbError(error) {
    if (error && error.code === "23505") return "That slug is already in use. Choose another one.";
    if (error && error.code === "42501") return "The database refused this change (permission). Make sure you're signed in as an admin. Details: " + error.message;
    return "The course could not be saved: " + (error && error.message ? error.message : "unknown error");
  }

  function closeCourseForm() {
    courseFormContainer.textContent = "";
    detailsBtn.setAttribute("aria-expanded", "false");
  }

  function openNewCourseForm() {
    closeCourseForm();
    const f = buildCourseForm(null);
    f.cancel.addEventListener("click", closeCourseForm);
    f.form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const { errors, values } = readCourseForm(f, null);
      f.errorEl.textContent = errors.join(" ");
      if (errors.length) return;
      f.submit.disabled = true;
      try {
        const position = await nextPosition("courses", "category_id", values.category_id);
        const payload = {
          slug: values.slug,
          title: values.title,
          short_label: values.short_label,
          category_id: values.category_id,
          position,
          published: false,
          identity: values.identity,
          identity_secondary: values.identity_secondary,
          hours: values.hours,
          description: values.description,
        };
        const { error } = await supabaseClient.from("courses").insert(payload);
        if (error) throw error;
        window.location.href = "manage-course.html?course=" + encodeURIComponent(values.slug);
      } catch (error) {
        f.errorEl.textContent = describeDbError(error);
        f.submit.disabled = false;
      }
    });
    courseFormContainer.append(f.form);
    f.title.focus();
  }

  function openCourseDetails() {
    if (detailsBtn.getAttribute("aria-expanded") === "true") return closeCourseForm();
    closeCourseForm();
    detailsBtn.setAttribute("aria-expanded", "true");
    const f = buildCourseForm(course);
    f.cancel.addEventListener("click", closeCourseForm);
    f.form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const { errors, values } = readCourseForm(f, course);
      f.errorEl.textContent = errors.join(" ");
      if (errors.length) return;
      if (course.published && !values.published &&
          !window.confirm(`Unpublish "${course.title}"? It becomes a draft and is hidden from course lists that only show published courses.`)) return;
      f.submit.disabled = true;
      try {
        // Editable fields only: never id, slug or created_at.
        const payload = {
          title: values.title,
          short_label: values.short_label,
          category_id: values.category_id,
          identity: values.identity,
          identity_secondary: values.identity_secondary,
          hours: values.hours,
          description: values.description,
          published: values.published,
        };
        // Moving to another category appends it there; otherwise the position stays.
        if ((values.category_id || null) !== (course.category_id || null)) {
          payload.position = await nextPosition("courses", "category_id", values.category_id);
        }
        const { error } = await supabaseClient.from("courses").update(payload).eq("id", course.id);
        if (error) throw error;
        window.location.href = "manage-course.html?course=" + encodeURIComponent(course.slug);
      } catch (error) {
        f.errorEl.textContent = describeDbError(error);
        f.submit.disabled = false;
      }
    });
    courseFormContainer.append(f.form);
    f.title.focus();
  }

  document.getElementById("newCourseBtn").addEventListener("click", openNewCourseForm);
  detailsBtn.addEventListener("click", openCourseDetails);

  // --- Modules and lessons ---

  async function loadModules() {
    const { data, error } = await supabaseClient
      .from("modules")
      .select("id, title, position, lessons(id, title, duration, type, video_url, content, description, position)")
      .eq("course_id", courseId)
      .order("position")
      .order("position", { foreignTable: "lessons" });
    if (error) {
      showMessage("Could not load modules: " + error.message, "error");
      return [];
    }
    return data || [];
  }

  async function refresh() {
    document.getElementById("moduleFormContainer").innerHTML = "";
    const modules = await loadModules();
    renderModules(modules);
  }

  function renderModules(modules) {
    const container = document.getElementById("moduleManageList");
    container.innerHTML = "";

    if (!modules.length) {
      const empty = document.createElement("p");
      empty.className = "manage-empty";
      empty.textContent = "No modules yet. Click “+ Add Module” to create the first one.";
      container.appendChild(empty);
      return;
    }

    if (!positionsClean(modules)) {
      container.appendChild(positionWarning("Modules", async () => {
        await setPositions("modules", courseId, modules.map((m) => m.id));
        refresh();
      }));
    }

    modules.forEach((mod) => {
      const modCard = document.createElement("div");
      modCard.className = "manage-module-card";
      modCard.dataset.moduleId = mod.id;

      const modHeader = document.createElement("div");
      modHeader.className = "manage-module-header";

      const modTitleWrap = document.createElement("div");
      modTitleWrap.className = "manage-title-wrap";
      const modHandle = document.createElement("span");
      modHandle.className = "drag-handle";
      modHandle.textContent = "⠿";
      modHandle.title = "Drag to reorder";
      const modTitle = document.createElement("h3");
      modTitle.textContent = mod.title;
      modTitleWrap.appendChild(modHandle);
      modTitleWrap.appendChild(modTitle);

      const modActions = document.createElement("div");
      modActions.className = "manage-actions";

      const editBtn = button("Edit", () => openModuleForm(mod));
      const deleteBtn = button("Delete", () => deleteModule(mod), "btn-manage-danger");

      [editBtn, deleteBtn].forEach((b) => modActions.appendChild(b));
      modHeader.appendChild(modTitleWrap);
      modHeader.appendChild(modActions);
      modCard.appendChild(modHeader);

      if (mod.lessons.length && !positionsClean(mod.lessons)) {
        modCard.appendChild(positionWarning("Lessons in this module", async () => {
          await setPositions("lessons", mod.id, mod.lessons.map((l) => l.id));
          refresh();
        }));
      }

      const lessonList = document.createElement("div");
      lessonList.className = "manage-lesson-list";

      mod.lessons.forEach((lesson) => {
        const row = document.createElement("div");
        row.className = "manage-lesson-row";
        row.dataset.lessonId = lesson.id;

        const handle = document.createElement("span");
        handle.className = "drag-handle";
        handle.textContent = "⠿";
        handle.title = "Drag to reorder";

        const info = document.createElement("div");
        info.className = "manage-lesson-info";

        const titleEl = document.createElement("strong");
        titleEl.textContent = lesson.title;
        const metaEl = document.createElement("span");
        metaEl.className = "manage-lesson-meta";
        metaEl.textContent = `${lesson.type} · ${lesson.duration || ""}`;

        info.appendChild(titleEl);
        info.appendChild(metaEl);

        const actions = document.createElement("div");
        actions.className = "manage-actions";
        const lEdit = button("Edit", () => openLessonForm(mod, lesson));
        const lDelete = button("Delete", () => deleteLesson(lesson), "btn-manage-danger");
        [lEdit, lDelete].forEach((b) => actions.appendChild(b));

        row.appendChild(handle);
        row.appendChild(info);
        row.appendChild(actions);
        lessonList.appendChild(row);
      });

      modCard.appendChild(lessonList);

      const addLessonBtn = button("+ Add Lesson", () => openLessonForm(mod, null), "btn-manage-add");
      modCard.appendChild(addLessonBtn);

      container.appendChild(modCard);

      makeListDraggable(lessonList, ".manage-lesson-row", ".drag-handle", (items) => {
        reorderLessons(mod, items);
      });
    });

    makeListDraggable(container, ".manage-module-card", ".drag-handle", (items) => {
      reorderModules(items);
    });
  }

  // --- Module CRUD ---

  document.getElementById("addModuleBtn").addEventListener("click", () => openModuleForm(null));

  function openModuleForm(existingModule) {
    const container = document.getElementById("moduleFormContainer");
    container.innerHTML = "";

    const form = document.createElement("form");
    form.className = "manage-form";
    form.innerHTML = `
      <label>Module title</label>
      <input type="text" name="title" required>
      <div class="manage-form-actions">
        <button type="submit" class="btn btn-primary">${existingModule ? "Save Module" : "Create Module"}</button>
        <button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
      </div>
    `;

    if (existingModule) form.title.value = existingModule.title;

    form.querySelector("[data-cancel]").addEventListener("click", () => {
      container.innerHTML = "";
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = form.title.value.trim();
      if (!title) return;

      if (existingModule) {
        const { error } = await supabaseClient.from("modules").update({ title }).eq("id", existingModule.id);
        if (error) return showMessage(error.message, "error");
        showMessage("Module updated.", "success");
      } else {
        let position;
        try {
          position = await nextPosition("modules", "course_id", courseId);
        } catch (error) {
          return showMessage(error.message, "error");
        }
        const { error } = await supabaseClient
          .from("modules")
          .insert({ course_id: courseId, title, position });
        if (error) return showMessage(error.message, "error");
        showMessage("Module created.", "success");
      }
      refresh();
    });

    container.appendChild(form);
    form.title.focus();
  }

  async function deleteModule(mod) {
    const count = mod.lessons.length;
    if (count) {
      const typed = window.prompt(
        `Delete "${mod.title}"? This permanently deletes its ${count} lesson${count === 1 ? "" : "s"} ` +
        `and removes every student's completion record for ${count === 1 ? "that lesson" : "those lessons"}. ` +
        `This can't be undone.\n\nType the module title to confirm:`
      );
      if (typed === null) return;
      if (typed !== mod.title) {
        showMessage("The module title didn't match, so nothing was deleted.", "error");
        return;
      }
    } else if (!window.confirm(`Delete the empty module "${mod.title}"? This can't be undone.`)) {
      return;
    }
    const { error } = await supabaseClient.from("modules").delete().eq("id", mod.id);
    if (error) return showMessage(error.message, "error");
    showMessage("Module deleted.", "success");
    refresh();
  }

  async function reorderModules(items) {
    const ids = items.map((el) => el.dataset.moduleId);
    if (await setPositions("modules", courseId, ids)) showMessage("Module order saved.", "success");
    refresh();
  }

  // --- Lesson CRUD ---

  function openLessonForm(mod, existingLesson) {
    document.querySelectorAll(".manage-lesson-form").forEach((f) => f.remove());

    const form = document.createElement("form");
    form.className = "manage-form manage-lesson-form";
    form.innerHTML = `
      <label>Lesson title</label>
      <input type="text" name="title" required>
      <label>Duration (e.g. 10 min)</label>
      <input type="text" name="duration">
      <label>Type</label>
      <select name="type"></select>
      <label>Video URL (embed link — only used when Type is Video)</label>
      <input type="text" name="videoUrl" placeholder="https://www.youtube.com/embed/...">
      <label>Content (HTML — used when Type is Text or Progress Check)</label>
      <textarea name="content" rows="4" placeholder="&lt;p&gt;Lesson text goes here.&lt;/p&gt;"></textarea>
      <label>Description (optional, shown under the lesson title)</label>
      <input type="text" name="description">
      <div class="manage-form-actions">
        <button type="submit" class="btn btn-primary">${existingLesson ? "Save Lesson" : "Add Lesson"}</button>
        <button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
      </div>
    `;

    LESSON_TYPES.forEach(([value, label]) => form.type.appendChild(option(value, label)));
    // A stored type this form doesn't know is kept as is rather than blanked.
    if (existingLesson && !LESSON_TYPES.some(([value]) => value === existingLesson.type)) {
      form.type.appendChild(option(existingLesson.type, "Unknown (" + existingLesson.type + ")"));
    }

    if (existingLesson) {
      form.title.value = existingLesson.title;
      form.duration.value = existingLesson.duration || "";
      form.type.value = existingLesson.type;
      form.videoUrl.value = existingLesson.video_url || "";
      form.content.value = existingLesson.content || "";
      form.description.value = existingLesson.description || "";
    }

    form.querySelector("[data-cancel]").addEventListener("click", () => form.remove());

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = form.title.value.trim();
      if (!title) return;

      // Lesson HTML is saved exactly as written (no trimming). A textarea turns
      // CRLF into LF, so unchanged content keeps the stored value byte for byte.
      const original = existingLesson ? existingLesson.content : null;
      let content = form.content.value === "" ? null : form.content.value;
      if (original != null && content === original.replace(/\r\n?/g, "\n")) content = original;

      const payload = {
        title,
        duration: form.duration.value.trim() || null,
        type: form.type.value,
        video_url: form.videoUrl.value.trim() || null,
        content,
        description: form.description.value.trim() || null,
      };

      if (existingLesson) {
        const { error } = await supabaseClient.from("lessons").update(payload).eq("id", existingLesson.id);
        if (error) return showMessage(error.message, "error");
        showMessage("Lesson updated.", "success");
      } else {
        let position;
        try {
          position = await nextPosition("lessons", "module_id", mod.id);
        } catch (error) {
          return showMessage(error.message, "error");
        }
        const { error } = await supabaseClient
          .from("lessons")
          .insert({ ...payload, module_id: mod.id, position });
        if (error) return showMessage(error.message, "error");
        showMessage("Lesson added.", "success");
      }
      refresh();
    });

    const modCard = document.querySelector(`.manage-module-card[data-module-id="${mod.id}"]`);
    modCard.insertBefore(form, modCard.querySelector(".btn-manage-add"));
    form.title.focus();
  }

  async function deleteLesson(lesson) {
    if (!window.confirm(`Delete "${lesson.title}"? Every student's completion record for this lesson is also removed. This can't be undone.`)) return;
    const { error } = await supabaseClient.from("lessons").delete().eq("id", lesson.id);
    if (error) return showMessage(error.message, "error");
    showMessage("Lesson deleted.", "success");
    refresh();
  }

  async function reorderLessons(mod, items) {
    const ids = items.map((el) => el.dataset.lessonId);
    if (await setPositions("lessons", mod.id, ids)) showMessage("Lesson order saved.", "success");
    refresh();
  }

  // --- Course selection ---

  const bar = await LinhAdminCourseBar.render(document.getElementById("adminCourseBar"), {
    page: "content",
    slug: MANAGE_COURSE_SLUG,
  });
  allCourses = bar.courses;
  try {
    categories = await LinhCourses.loadCourseCategories();
  } catch (e) {
    categories = [];
  }

  if (bar.status !== "ok") return;
  course = bar.course;
  courseId = course.id;
  document.getElementById("manageCourseTitle").textContent = "Manage: " + course.title;
  document.getElementById("viewCourseLink").href = "course.html?course=" + encodeURIComponent(course.slug);
  document.getElementById("moduleToolbar").hidden = false;
  detailsBtn.hidden = false;
  refresh();
}

if (manageRoot) {
  initManage();
}
