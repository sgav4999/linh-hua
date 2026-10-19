const examRoot = document.getElementById("examRoot");
// No default course: without ?course= the page asks the student to choose one
// and never opens another course in its place.
const EXAM_COURSE_SLUG = LinhExamConfig.requestedSlug(new URLSearchParams(window.location.search).get("course"));
const EXAM_PAGE_SIZE = 1000;

async function initExam() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }

  const messageEl = document.getElementById("formMessage");
  function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = "form-message " + type;
  }

  const introText = document.getElementById("examIntroText");
  const startBtn = document.getElementById("startExamBtn");
  // A state with no exam to start: the message stays, the Start button goes.
  function noExam(text) {
    introText.textContent = text;
    startBtn.hidden = true;
  }

  if (!EXAM_COURSE_SLUG) {
    noExam("Choose a course to start a practice exam. ");
    const link = document.createElement("a");
    link.href = "dashboard.html";
    link.textContent = "Go to your dashboard";
    introText.appendChild(link);
    return;
  }

  // The access gate runs before any question is requested. An unknown slug
  // and a course this account can't read (an unpublished draft, for
  // students) look the same here; a failed read says so.
  const gate = await LinhCourses.loadCourseAccess(session, EXAM_COURSE_SLUG);
  if (gate.state === "unavailable") {
    showMessage("Could not load this course.", "error");
    noExam("");
    return;
  }
  if (gate.state === "error") {
    showMessage("Could not load this course. Please refresh the page to try again.", "error");
    noExam("");
    return;
  }
  const course = gate.course;

  document.getElementById("examEyebrow").textContent = "Practice Exam · " + course.title;

  // Published, but this student is not enrolled: no questions are read.
  if (gate.state === "no-access") {
    introText.hidden = true;
    startBtn.hidden = true;
    document.getElementById("examIntro").insertBefore(LinhAccessView.noAccess(), startBtn);
    return;
  }
  const courseLink = document.getElementById("examCourseLink");
  courseLink.href = "course.html?course=" + encodeURIComponent(course.slug);
  courseLink.hidden = false;

  const config = LinhExamConfig.examConfigFor(course.slug);
  if (!config) {
    noExam("The practice exam for this course is not configured yet.");
    return;
  }

  // The whole bank in its authoritative order, a page at a time; a failed
  // page stops the exam rather than starting it with part of the bank.
  let bank;
  try {
    bank = await LinhExamConfig.loadAllPages(
      (from, to) =>
        supabaseClient
          .from("practice_questions")
          .select("id, question, choice_a, choice_b, choice_c, choice_d, correct_choice, explanation")
          .eq("course_id", course.id)
          .order("position")
          .order("id")
          .range(from, to),
      EXAM_PAGE_SIZE
    );
  } catch (err) {
    showMessage("Could not load practice questions: " + err.message, "error");
    noExam("");
    return;
  }

  if (!bank.length) {
    introText.textContent = "No practice questions have been added yet. Check back soon.";
    startBtn.disabled = true;
    return;
  }

  const rowsById = new Map(bank.map((q) => [q.id, q]));
  const examSize = LinhExamConfig.attemptSize(config, bank.length);
  const plural = (n) => `${n} question${n === 1 ? "" : "s"}`;
  let sizeText;
  if (config.length === "all") sizeText = `${plural(examSize)}.`;
  else if (examSize < bank.length) sizeText = `${plural(examSize)} selected from ${bank.length} available.`;
  else sizeText = `${plural(examSize)}, every question available for this course.`;
  introText.textContent = sizeText + " Answer them all, then see your score and review anything you missed.";

  // One attempt per Start: its questions and choice orders are fixed until
  // the next Start, and grading uses exactly what was shown.
  let attempt = null;
  let questions = [];
  let timerInterval = null;
  let startTime = null;
  let elapsedSeconds = 0;

  const questionHeading = document.getElementById("examQuestionHeading");
  const questionProgress = document.getElementById("examQuestionProgress");
  const optionsEl = document.getElementById("examOptions");
  const checkBtn = document.getElementById("examCheckBtn");
  const feedback = document.getElementById("examFeedback");
  const explanation = document.getElementById("examExplanation");
  const statusEl = document.getElementById("examStatus");
  const prevBtn = document.getElementById("examPrevBtn");
  const nextBtn = document.getElementById("examNextBtn");

  const currentId = () => attempt.questionIds[attempt.currentIndex];
  const choiceText = (q, key) => q["choice_" + key];
  const labelled = (q, order, key) => `${LinhExamConfig.displayLabelFor(order, key)}. ${choiceText(q, key)}`;

  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function startTimer() {
    startTime = Date.now();
    elapsedSeconds = 0;
    document.getElementById("examTimer").textContent = "0:00";
    timerInterval = setInterval(() => {
      elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      document.getElementById("examTimer").textContent = formatTime(elapsedSeconds);
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
  }

  function feedbackText(q, order, answer) {
    return answer === q.correct_choice
      ? "Correct!"
      : `Incorrect. Correct answer: ${labelled(q, order, q.correct_choice)}`;
  }

  // Selected-state and Check button follow the chosen radio in place, so the
  // focused radio (and arrow-key movement between radios) is never rebuilt.
  function selectAnswer(key) {
    attempt.answers[currentId()] = key;
    optionsEl.querySelectorAll(".quiz-option").forEach((option) => {
      option.classList.toggle("selected", option.dataset.choice === key);
    });
    checkBtn.disabled = false;
    updateNavigator();
  }

  function renderQuestion(focusQuestion) {
    const id = currentId();
    const q = rowsById.get(id);
    const order = attempt.choiceOrders[id];
    const answer = attempt.answers[id] || null;
    const isChecked = !!attempt.checked[id];
    const progress = `Question ${attempt.currentIndex + 1} of ${questions.length}`;

    document.getElementById("examProgress").textContent = progress;
    document.getElementById("examProgressFill").style.width = `${((attempt.currentIndex + 1) / questions.length) * 100}%`;
    questionProgress.textContent = progress + ": ";
    document.getElementById("examQuestionText").textContent = q.question;

    if (window.TTS) {
      TTS.stop();
      const listenContainer = document.getElementById("examListenContainer");
      listenContainer.innerHTML = "";
      const listenBtn = TTS.attach(() => getExamListenText(), { title: "Listen to this question" });
      if (listenBtn) listenContainer.appendChild(listenBtn);
    }

    optionsEl.innerHTML = "";
    order.forEach((key, i) => {
      const option = document.createElement("label");
      option.className = "quiz-option";
      option.dataset.choice = key;
      if (answer === key) option.classList.add("selected");

      if (isChecked) {
        option.classList.add("locked");
        if (key === q.correct_choice) option.classList.add("correct");
        else if (key === answer) option.classList.add("incorrect");
      }

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "examOption";
      input.value = key;
      input.checked = answer === key;
      input.disabled = isChecked;
      input.addEventListener("change", () => selectAnswer(key));

      const letter = document.createElement("span");
      letter.className = "quiz-option-letter";
      letter.textContent = LinhExamConfig.displayLabel(i) + ".";

      const text = document.createElement("span");
      text.className = "quiz-option-text";
      text.textContent = choiceText(q, key);

      option.appendChild(input);
      option.appendChild(letter);
      option.appendChild(text);
      optionsEl.appendChild(option);
    });

    if (isChecked) {
      checkBtn.hidden = true;
      const isCorrect = answer === q.correct_choice;
      feedback.hidden = false;
      feedback.className = "lesson-quiz-feedback " + (isCorrect ? "correct" : "incorrect");
      feedback.textContent = feedbackText(q, order, answer);
      if (!isCorrect && q.explanation) {
        explanation.hidden = false;
        explanation.textContent = q.explanation;
      } else {
        explanation.hidden = true;
      }
    } else {
      checkBtn.hidden = false;
      checkBtn.disabled = !answer;
      feedback.hidden = true;
      explanation.hidden = true;
    }

    prevBtn.disabled = attempt.currentIndex === 0;
    nextBtn.textContent = attempt.currentIndex === questions.length - 1 ? "Finish" : "Next →";

    updateNavigator();
    if (focusQuestion) questionHeading.focus();
  }

  function goTo(index) {
    attempt.currentIndex = index;
    statusEl.textContent = "";
    renderQuestion(true);
  }

  function buildNavigator() {
    const nav = document.getElementById("examNavigator");
    nav.innerHTML = "";
    questions.forEach((q, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "exam-nav-item";
      const num = document.createElement("span");
      num.textContent = i + 1;
      const mark = document.createElement("span");
      mark.className = "exam-nav-mark";
      mark.setAttribute("aria-hidden", "true");
      btn.appendChild(num);
      btn.appendChild(mark);
      btn.addEventListener("click", () => {
        closeNavigator();
        goTo(i);
      });
      nav.appendChild(btn);
    });
  }

  // Status is shown by a mark and a label as well as by colour.
  function updateNavigator() {
    const items = document.getElementById("examNavigator").children;
    for (let i = 0; i < items.length; i++) {
      const btn = items[i];
      const id = attempt.questionIds[i];
      const answer = attempt.answers[id];
      let status = "unanswered";
      let mark = "";
      if (attempt.checked[id]) {
        const isCorrect = answer === rowsById.get(id).correct_choice;
        status = isCorrect ? "correct" : "incorrect";
        mark = isCorrect ? "✓" : "×";
      } else if (answer) {
        status = "answered";
        mark = "•";
      }
      const isCurrent = i === attempt.currentIndex;
      btn.classList.remove("current", "answered", "correct", "incorrect");
      if (isCurrent) btn.classList.add("current");
      else if (status !== "unanswered") btn.classList.add(status);
      btn.lastChild.textContent = mark;
      btn.setAttribute("aria-label", `Question ${i + 1}, ${status}${isCurrent ? ", current" : ""}`);
      if (isCurrent) btn.setAttribute("aria-current", "step");
      else btn.removeAttribute("aria-current");
    }
  }

  function closeNavigator() {
    document.getElementById("examNavigator").classList.remove("is-open");
    document.getElementById("examNavToggle").classList.remove("is-open");
    document.getElementById("examNavToggle").setAttribute("aria-expanded", "false");
    document.getElementById("examNavToggleLabel").textContent = "Jump to question";
  }

  document.getElementById("examNavToggle").addEventListener("click", () => {
    const toggle = document.getElementById("examNavToggle");
    const nav = document.getElementById("examNavigator");
    const isOpen = nav.classList.toggle("is-open");
    toggle.classList.toggle("is-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    document.getElementById("examNavToggleLabel").textContent = isOpen ? "Hide question list" : "Jump to question";
  });

  // Read in the order shown, with the letters shown.
  function getExamListenText() {
    const id = currentId();
    const q = rowsById.get(id);
    const parts = [q.question].concat(LinhExamConfig.spokenChoices(q, attempt.choiceOrders[id]));
    if (!feedback.hidden) parts.push(feedback.textContent);
    if (!explanation.hidden) parts.push("Explanation: " + explanation.textContent);
    return parts.join(". ");
  }

  checkBtn.addEventListener("click", () => {
    const id = currentId();
    if (!attempt.answers[id]) return;
    attempt.checked[id] = true;
    renderQuestion(false);
    statusEl.textContent = feedback.textContent;
    // The Check button is now hidden; keep focus on the way forward.
    nextBtn.focus();
  });

  prevBtn.addEventListener("click", () => {
    if (attempt.currentIndex > 0) goTo(attempt.currentIndex - 1);
  });

  nextBtn.addEventListener("click", () => {
    if (attempt.currentIndex < questions.length - 1) goTo(attempt.currentIndex + 1);
    else submitExam();
  });

  function submitExam() {
    if (window.TTS) TTS.stop();
    stopTimer();
    closeNavigator();
    statusEl.textContent = "";
    document.getElementById("examQuiz").hidden = true;
    document.getElementById("examResults").hidden = false;

    const score = LinhExamConfig.scoreAttempt(attempt, rowsById);
    document.getElementById("examScorePercent").textContent = `${score.percent}%`;
    document.getElementById("examScoreLabel").textContent = `${score.correct} of ${score.total} correct`;
    document.getElementById("examTimeTaken").textContent = `Completed in ${formatTime(elapsedSeconds)}`;

    const reviewEl = document.getElementById("examReview");
    reviewEl.innerHTML = "";
    attempt.questionIds.forEach((id, i) => {
      const q = rowsById.get(id);
      const order = attempt.choiceOrders[id];
      const answer = attempt.answers[id];
      const isCorrect = answer === q.correct_choice;

      const item = document.createElement("div");
      item.className = "review-item " + (isCorrect ? "review-correct" : "review-incorrect");

      const qText = document.createElement("p");
      qText.className = "review-question";
      qText.textContent = `${i + 1}. ${q.question}`;
      item.appendChild(qText);

      const yourAnswer = document.createElement("p");
      yourAnswer.className = "review-answer";
      yourAnswer.textContent = answer ? `Your answer: ${labelled(q, order, answer)}` : "Your answer: (skipped)";
      item.appendChild(yourAnswer);

      if (!isCorrect) {
        const correctAnswer = document.createElement("p");
        correctAnswer.className = "review-correct-answer";
        correctAnswer.textContent = `Correct answer: ${labelled(q, order, q.correct_choice)}`;
        item.appendChild(correctAnswer);
      }

      if (q.explanation) {
        const explanationEl = document.createElement("p");
        explanationEl.className = "review-explanation";
        explanationEl.textContent = q.explanation;
        item.appendChild(explanationEl);
      }

      reviewEl.appendChild(item);
    });

    document.getElementById("examScore").focus();
  }

  startBtn.addEventListener("click", () => {
    document.getElementById("examIntro").hidden = true;
    document.getElementById("examResults").hidden = true;
    document.getElementById("examQuiz").hidden = false;
    attempt = LinhExamConfig.createAttempt(bank, config);
    questions = attempt.questionIds.map((id) => rowsById.get(id));
    statusEl.textContent = "";
    buildNavigator();
    closeNavigator();
    startTimer();
    renderQuestion(true);
  });

  document.getElementById("retakeExamBtn").addEventListener("click", () => {
    document.getElementById("examResults").hidden = true;
    document.getElementById("examIntro").hidden = false;
    startBtn.focus();
  });
}

if (examRoot) {
  initExam();
}
