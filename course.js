const courseRoot = document.getElementById("courseRoot");
const COURSE_SLUG = new URLSearchParams(window.location.search).get("course") || "life-health-combo";

// Wires up the "Check Your Knowledge" quiz blocks embedded in lesson HTML
// (see .lesson-quiz-item / data-correct in generated lesson content).
// Each question is answered independently: click a choice to submit it,
// see correct/incorrect immediately, and the correct answer is revealed.
function initLessonQuizzes(container) {
  container.querySelectorAll(".lesson-quiz-item").forEach((item) => {
    const correct = item.dataset.correct;
    const feedback = item.querySelector(".lesson-quiz-feedback");
    const explanation = item.querySelector(".lesson-quiz-explanation");
    const options = item.querySelectorAll(".lesson-quiz-option");

    // The feedback line is a status message, and it takes focus once an
    // answer is chosen (the chosen option becomes disabled, which would
    // otherwise drop keyboard focus to the page).
    if (feedback) {
      feedback.setAttribute("role", "status");
      feedback.setAttribute("tabindex", "-1");
    }

    if (window.TTS) {
      const listenBtn = TTS.attach(() => item.innerText, { small: true, title: "Listen to this question" });
      if (listenBtn) item.appendChild(listenBtn);
    }

    options.forEach((btn) => {
      btn.addEventListener("click", () => {
        const letter = btn.dataset.letter;
        options.forEach((b) => { b.disabled = true; });

        const correctBtn = item.querySelector(`.lesson-quiz-option[data-letter="${correct}"]`);
        if (letter === correct) {
          btn.classList.add("correct");
          feedback.textContent = "Correct!";
          feedback.className = "lesson-quiz-feedback correct";
        } else {
          btn.classList.add("incorrect");
          if (correctBtn) correctBtn.classList.add("correct");
          const correctText = correctBtn ? correctBtn.textContent.replace(/^[A-D]\)\s*/, "") : "";
          feedback.textContent = `Incorrect. Correct answer: ${correct.toUpperCase()}) ${correctText}`;
          feedback.className = "lesson-quiz-feedback incorrect";
        }
        feedback.hidden = false;
        if (explanation) explanation.hidden = false;
        feedback.focus({ preventScroll: true });
      });
    });
  });
}

async function initCourse() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }

  const { data: course, error: courseError } = await supabaseClient
    .from("courses")
    .select("id, title")
    .eq("slug", COURSE_SLUG)
    .single();

  if (courseError || !course) {
    document.getElementById("lessonTitle").textContent = "This course couldn't be loaded.";
    return;
  }

  // The course exists: its title, identity and tool links are set before the
  // lessons load, so they hold in the loading, no-module and no-lesson states.
  // An unknown course keeps the page's original tool links.
  document.getElementById("courseTitle").textContent = course.title;
  courseRoot.setAttribute("data-course", COURSE_SLUG);
  document.getElementById("coursePracticeExamLink").href = "practice-exam.html?course=" + encodeURIComponent(COURSE_SLUG);
  document.getElementById("courseStudyGuideLink").href = "study-guide.html?course=" + encodeURIComponent(COURSE_SLUG);

  const { data: moduleRows, error: modulesError } = await supabaseClient
    .from("modules")
    .select("id, title, position, lessons(id, title, duration, type, video_url, content, description, position)")
    .eq("course_id", course.id)
    .order("position")
    .order("position", { foreignTable: "lessons" });

  if (modulesError || !moduleRows || !moduleRows.length) {
    document.getElementById("lessonTitle").textContent = "No lessons have been added to this course yet.";
    return;
  }

  // Flatten modules into a single ordered lesson list for prev/next navigation.
  const lessons = [];
  moduleRows.forEach((mod) => {
    mod.lessons.forEach((lesson) => {
      lessons.push({ ...lesson, moduleTitle: mod.title });
    });
  });

  // Modules without a single lesson between them: same message as no modules.
  if (!lessons.length) {
    document.getElementById("lessonTitle").textContent = "No lessons have been added to this course yet.";
    return;
  }

  const { data: progressRows } = await supabaseClient
    .from("lesson_progress")
    .select("lesson_id")
    .eq("user_id", session.user.id);

  let completedIds = new Set((progressRows || []).map((r) => r.lesson_id));

  // One-time migration for students whose progress only exists in this browser's
  // localStorage from before progress was synced to their account.
  const LEGACY_KEY = "linhhoa_progress_" + COURSE_SLUG;
  if (completedIds.size === 0) {
    let legacyIds = [];
    try {
      legacyIds = JSON.parse(localStorage.getItem(LEGACY_KEY)) || [];
    } catch (e) {}
    const validLegacyIds = legacyIds.filter((id) => lessons.some((l) => l.id === id));
    if (validLegacyIds.length) {
      const rows = validLegacyIds.map((lesson_id) => ({ user_id: session.user.id, lesson_id }));
      const { error } = await supabaseClient.from("lesson_progress").upsert(rows);
      if (!error) {
        completedIds = new Set(validLegacyIds);
        localStorage.removeItem(LEGACY_KEY);
      }
    }
  }

  function getCompletedIds() {
    return [...completedIds];
  }

  async function setCompleted(lessonId, isComplete) {
    if (isComplete) {
      completedIds.add(lessonId);
      const { error } = await supabaseClient
        .from("lesson_progress")
        .upsert({ user_id: session.user.id, lesson_id: lessonId });
      if (error) {
        completedIds.delete(lessonId);
        return false;
      }
    } else {
      completedIds.delete(lessonId);
      const { error } = await supabaseClient
        .from("lesson_progress")
        .delete()
        .eq("user_id", session.user.id)
        .eq("lesson_id", lessonId);
      if (error) {
        completedIds.add(lessonId);
        return false;
      }
    }
    return true;
  }

  function currentLessonId() {
    const hash = window.location.hash.replace("#", "");
    return lessons.some((l) => l.id === hash) ? hash : lessons[0].id;
  }

  function renderSidebar() {
    const completed = new Set(getCompletedIds());
    const moduleList = document.getElementById("moduleList");
    moduleList.innerHTML = "";

    moduleRows.forEach((mod) => {
      const modEl = document.createElement("div");
      modEl.className = "module";

      const heading = document.createElement("div");
      heading.className = "module-heading";
      heading.textContent = mod.title;
      modEl.appendChild(heading);

      const list = document.createElement("ul");
      list.className = "lesson-list";

      mod.lessons.forEach((lesson) => {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = "#" + lesson.id;
        link.className = "lesson-item";
        if (lesson.id === currentLessonId()) {
          link.classList.add("active");
          link.setAttribute("aria-current", "page");
        }
        if (completed.has(lesson.id)) link.classList.add("completed");
        if (lesson.type === "quiz") link.classList.add("lesson-item-quiz");

        const check = document.createElement("span");
        check.className = "lesson-check";
        check.textContent = completed.has(lesson.id) ? "✓" : "";

        const label = document.createElement("span");
        label.textContent = lesson.title;

        link.appendChild(check);
        link.appendChild(label);
        item.appendChild(link);
        list.appendChild(item);
      });

      modEl.appendChild(list);
      moduleList.appendChild(modEl);
    });
  }

  function renderProgress() {
    const completed = getCompletedIds().filter((id) => lessons.some((l) => l.id === id));
    const total = lessons.length;
    const done = completed.length;
    const percent = total ? Math.round((done / total) * 100) : 0;

    document.getElementById("progressText").textContent = `${done} of ${total} lessons complete`;
    document.getElementById("progressPercent").textContent = `${percent}%`;
    document.getElementById("progressFill").style.width = `${percent}%`;
  }

  function renderLesson() {
    const id = currentLessonId();
    const index = lessons.findIndex((l) => l.id === id);
    const lesson = lessons[index];
    const completed = new Set(getCompletedIds());

    document.getElementById("lessonModuleLabel").textContent = lesson.moduleTitle;
    document.getElementById("lessonTitle").textContent = lesson.title;
    document.getElementById("lessonDuration").textContent = lesson.duration || "";
    document.getElementById("lessonDescription").textContent = lesson.description || "";

    if (window.TTS) TTS.stop();
    const listenContainer = document.getElementById("lessonListenContainer");
    listenContainer.innerHTML = "";

    const body = document.getElementById("lessonBody");
    if (lesson.type === "video") {
      body.innerHTML = `<div class="video-wrapper"><iframe src="${lesson.video_url}" title="${lesson.title}" frameborder="0" allowfullscreen></iframe></div>`;
    } else {
      body.innerHTML = lesson.content || "";
      initLessonQuizzes(body);
      if (window.TTS) {
        const listenBtn = TTS.attach(() => body.innerText, { title: "Listen to this lesson" });
        if (listenBtn) listenContainer.appendChild(listenBtn);
      }
    }

    const checkbox = document.getElementById("completeCheckbox");
    checkbox.checked = completed.has(lesson.id);

    const prevBtn = document.getElementById("prevLessonBtn");
    const nextBtn = document.getElementById("nextLessonBtn");
    prevBtn.disabled = index <= 0;
    nextBtn.textContent = index >= lessons.length - 1 ? "Finish" : "Next →";

    renderSidebar();
    renderProgress();
  }

  document.getElementById("completeCheckbox").addEventListener("change", async (e) => {
    const lesson = lessons[lessons.findIndex((l) => l.id === currentLessonId())];
    const desiredState = e.target.checked;
    const ok = await setCompleted(lesson.id, desiredState);
    if (!ok) {
      e.target.checked = !desiredState;
    }
    renderSidebar();
    renderProgress();
  });

  document.getElementById("prevLessonBtn").addEventListener("click", () => {
    const index = lessons.findIndex((l) => l.id === currentLessonId());
    if (index > 0) window.location.hash = lessons[index - 1].id;
  });

  document.getElementById("nextLessonBtn").addEventListener("click", () => {
    const index = lessons.findIndex((l) => l.id === currentLessonId());
    if (index < lessons.length - 1) {
      window.location.hash = lessons[index + 1].id;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    } else {
      window.location.href = "dashboard.html";
    }
  });

  window.addEventListener("hashchange", renderLesson);

  renderLesson();
}

if (courseRoot) {
  initCourse();
}
