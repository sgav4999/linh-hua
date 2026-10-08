const manageExamRoot = document.getElementById("manageExamRoot");
// No default course: without ?course= the page asks the admin to choose one.
const MANAGE_EXAM_COURSE_SLUG = new URLSearchParams(window.location.search).get("course");

async function initManageExam() {
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
    page: "exam",
    slug: MANAGE_EXAM_COURSE_SLUG,
  });
  if (bar.status !== "ok") return;
  const course = bar.course;

  const messageEl = document.getElementById("formMessage");
  let questions = [];

  function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = "form-message " + type;
  }

  document.getElementById("manageExamTitle").textContent = "Manage Practice Exam: " + course.title;
  const courseId = course.id;
  const takeExamLink = document.getElementById("takeExamLink");
  takeExamLink.href = "practice-exam.html?course=" + encodeURIComponent(course.slug);
  takeExamLink.hidden = false;
  document.getElementById("questionToolbar").hidden = false;

  function button(label, onClick, extraClass) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = "btn-manage" + (extraClass ? " " + extraClass : "");
    b.addEventListener("click", onClick);
    return b;
  }

  async function loadQuestions() {
    const { data, error } = await supabaseClient
      .from("practice_questions")
      .select("id, question, choice_a, choice_b, choice_c, choice_d, correct_choice, explanation, position")
      .eq("course_id", courseId)
      .order("position");
    if (error) {
      showMessage("Could not load questions: " + error.message, "error");
      return [];
    }
    return data || [];
  }

  async function refresh() {
    document.getElementById("questionFormContainer").innerHTML = "";
    questions = await loadQuestions();
    renderQuestions();
  }

  function renderQuestions() {
    const container = document.getElementById("questionList");
    container.innerHTML = "";

    if (!questions.length) {
      const empty = document.createElement("p");
      empty.className = "manage-empty";
      empty.textContent = "No questions yet. Click “+ Add Question” to create the first one.";
      container.appendChild(empty);
      return;
    }

    // Positions must read 1..n in display order; otherwise offer a Renumber.
    if (!questions.every((q, i) => q.position === i + 1)) {
      const warning = document.createElement("div");
      warning.className = "admin-position-warning";
      const text = document.createElement("span");
      text.textContent = "Questions have duplicate or missing positions. The order shown is the saved order.";
      warning.append(text, button("Renumber", async () => {
        await setPositions(questions.map((q) => q.id));
        refresh();
      }));
      container.appendChild(warning);
    }

    questions.forEach((q, index) => {
      const card = document.createElement("div");
      card.className = "manage-module-card";
      card.dataset.questionId = q.id;

      const header = document.createElement("div");
      header.className = "manage-module-header";

      const titleWrap = document.createElement("div");
      titleWrap.className = "manage-title-wrap";
      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.textContent = "⠿";
      handle.title = "Drag to reorder";
      const title = document.createElement("h3");
      title.textContent = `${index + 1}. ${q.question}`;
      titleWrap.appendChild(handle);
      titleWrap.appendChild(title);

      const actions = document.createElement("div");
      actions.className = "manage-actions";

      const editBtn = button("Edit", () => openQuestionForm(q));
      const deleteBtn = button("Delete", () => deleteQuestion(q), "btn-manage-danger");

      [editBtn, deleteBtn].forEach((b) => actions.appendChild(b));
      header.appendChild(titleWrap);
      header.appendChild(actions);
      card.appendChild(header);

      const choices = document.createElement("div");
      choices.className = "manage-lesson-list";
      ["a", "b", "c", "d"].forEach((letter) => {
        const row = document.createElement("div");
        row.className = "manage-lesson-row";
        const isCorrect = q.correct_choice === letter;
        const label = document.createElement("span");
        label.textContent = `${letter.toUpperCase()}. ${q["choice_" + letter]}`;
        const mark = document.createElement("span");
        mark.className = "manage-lesson-meta";
        mark.textContent = isCorrect ? "Correct answer" : "";
        row.appendChild(label);
        row.appendChild(mark);
        choices.appendChild(row);
      });
      card.appendChild(choices);

      container.appendChild(card);
    });

    makeListDraggable(container, ".manage-module-card", ".drag-handle", (items) => {
      reorderQuestions(items);
    });
  }

  document.getElementById("addQuestionBtn").addEventListener("click", () => openQuestionForm(null));

  function openQuestionForm(existing) {
    const container = document.getElementById("questionFormContainer");
    container.innerHTML = "";

    const form = document.createElement("form");
    form.className = "manage-form";
    form.innerHTML = `
      <label>Question</label>
      <textarea name="question" rows="2" required></textarea>
      <label>Choice A</label>
      <input type="text" name="choiceA" required>
      <label>Choice B</label>
      <input type="text" name="choiceB" required>
      <label>Choice C</label>
      <input type="text" name="choiceC" required>
      <label>Choice D</label>
      <input type="text" name="choiceD" required>
      <label>Correct choice</label>
      <select name="correctChoice">
        <option value="a">A</option>
        <option value="b">B</option>
        <option value="c">C</option>
        <option value="d">D</option>
      </select>
      <label>Explanation (optional, shown after answering)</label>
      <textarea name="explanation" rows="2"></textarea>
      <div class="manage-form-actions">
        <button type="submit" class="btn btn-primary">${existing ? "Save Question" : "Add Question"}</button>
        <button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
      </div>
    `;

    if (existing) {
      form.question.value = existing.question;
      form.choiceA.value = existing.choice_a;
      form.choiceB.value = existing.choice_b;
      form.choiceC.value = existing.choice_c;
      form.choiceD.value = existing.choice_d;
      form.correctChoice.value = existing.correct_choice;
      form.explanation.value = existing.explanation || "";
    }

    form.querySelector("[data-cancel]").addEventListener("click", () => {
      container.innerHTML = "";
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        question: form.question.value.trim(),
        choice_a: form.choiceA.value.trim(),
        choice_b: form.choiceB.value.trim(),
        choice_c: form.choiceC.value.trim(),
        choice_d: form.choiceD.value.trim(),
        correct_choice: form.correctChoice.value,
        explanation: form.explanation.value.trim() || null,
      };
      if (!payload.question) return;

      if (existing) {
        const { error } = await supabaseClient.from("practice_questions").update(payload).eq("id", existing.id);
        if (error) return showMessage(error.message, "error");
        showMessage("Question updated.", "success");
      } else {
        // Next free position: max(position) + 1, or 1 when there are none.
        const { data: last, error: positionError } = await supabaseClient
          .from("practice_questions")
          .select("position")
          .eq("course_id", courseId)
          .order("position", { ascending: false })
          .limit(1);
        if (positionError) return showMessage(positionError.message, "error");
        const position = last && last.length ? last[0].position + 1 : 1;
        const { error } = await supabaseClient
          .from("practice_questions")
          .insert({ ...payload, course_id: courseId, position });
        if (error) return showMessage(error.message, "error");
        showMessage("Question added.", "success");
      }
      refresh();
    });

    container.appendChild(form);
    form.question.focus();
  }

  async function deleteQuestion(q) {
    if (!window.confirm("Delete this question? This can't be undone.")) return;
    const { error } = await supabaseClient.from("practice_questions").delete().eq("id", q.id);
    if (error) return showMessage(error.message, "error");
    showMessage("Question deleted.", "success");
    refresh();
  }

  // One atomic call with the full ordered list; on failure the list is reloaded.
  async function setPositions(ids) {
    const { error } = await supabaseClient.rpc("admin_set_positions", {
      p_entity: "practice_questions",
      p_parent: courseId,
      p_ids: ids,
    });
    if (error) {
      showMessage("The new order could not be saved (" + error.message + "). The list has been reloaded from the server.", "error");
      return false;
    }
    return true;
  }

  async function reorderQuestions(items) {
    const ids = items.map((el) => el.dataset.questionId);
    if (await setPositions(ids)) showMessage("Question order saved.", "success");
    refresh();
  }

  refresh();
}

if (manageExamRoot) {
  initManageExam();
}
