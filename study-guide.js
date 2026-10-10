const studyGuideRoot = document.getElementById("studyGuideRoot");
// The three original courses. Their Study Guide is generated from lesson content
// unless an authored guide has been released, and only they get the course tabs.
// (The pre-paint script in study-guide.html repeats this list to hide the tabs early.)
const LEGACY_GUIDE_COURSES = ["life", "health", "life-health-combo"];
// Opening the page without ?course keeps its original meaning: the Combo guide.
const DEFAULT_GUIDE_COURSE = "life-health-combo";

// Condenses a lesson's HTML into its key facts: every bullet list item
// (already written as dense notes) plus any paragraph that defines a term
// (marked with <strong>). Embedded "Check Your Knowledge" quiz blocks are
// skipped — they're questions, not facts to study.
function extractKeyPoints(html) {
  const container = document.createElement("div");
  container.innerHTML = html || "";
  const points = [];
  Array.from(container.children).forEach((el) => {
    if (el.classList && el.classList.contains("lesson-quiz-item")) return;
    if (el.tagName === "H3" && /check your knowledge/i.test(el.textContent)) return;
    if (el.tagName === "UL" || el.tagName === "OL") {
      el.querySelectorAll(":scope > li").forEach((li) => points.push(li.innerHTML.trim()));
    } else if (el.tagName === "P" && el.querySelector("strong")) {
      points.push(el.innerHTML.trim());
    }
  });
  return points;
}

// ---- Authored guides --------------------------------------------------------
// Authored section HTML is never trusted. A copy is sanitized with the vendored
// DOMPurify (vendor/purify-3.4.16.min.js) into a detached fragment, links are
// checked there, and only then is the fragment placed in the page. The stored
// HTML is never changed.
//
// Allowed: prose, lists, quotations, code, tables, rules, links, and h3–h6.
// h1/h2 belong to the page and the section headings, so authored ones are
// unwrapped (their text is kept). Anything not listed is removed; the content
// of script, style, svg, math, iframe, template and similar elements is
// dropped entirely. Images are not supported yet and are removed.
const GUIDE_ALLOWED_TAGS = [
  "p", "br", "strong", "em", "b", "i", "u",
  "ul", "ol", "li", "blockquote", "code", "pre", "hr", "a",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "h3", "h4", "h5", "h6",
];
const GUIDE_ALLOWED_ATTR = ["href", "colspan", "rowspan", "scope", "start"];
const GUIDE_FORBID_TAGS = [
  "script", "style", "iframe", "frame", "object", "embed", "form", "input", "button", "textarea",
  "select", "option", "meta", "link", "base", "svg", "math", "video", "audio", "source", "track",
  "canvas", "img", "picture", "template", "noscript",
];
const GUIDE_SANITIZE_CONFIG = {
  ALLOWED_TAGS: GUIDE_ALLOWED_TAGS,
  ALLOWED_ATTR: GUIDE_ALLOWED_ATTR,
  FORBID_TAGS: GUIDE_FORBID_TAGS,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  KEEP_CONTENT: true,
  RETURN_DOM_FRAGMENT: true,
};
const SAFE_LINK_PROTOCOLS = ["https:", "http:", "mailto:"];

// The resolved URL of a link, or null when it isn't an http(s)/mailto link.
// Relative links resolve against this page and are kept.
function safeGuideHref(raw) {
  if (raw == null || raw.trim() === "") return null;
  let url;
  try {
    url = new URL(raw, document.baseURI);
  } catch (e) {
    return null;
  }
  return SAFE_LINK_PROTOCOLS.includes(url.protocol) ? url : null;
}

function sanitizeGuideHtml(html) {
  const fragment = window.DOMPurify.sanitize(html || "", GUIDE_SANITIZE_CONFIG);
  fragment.querySelectorAll("a").forEach((a) => {
    const url = safeGuideHref(a.getAttribute("href"));
    if (!url) {
      // Not a usable link: keep the text, drop the destination.
      a.removeAttribute("href");
      return;
    }
    a.setAttribute("rel", "noopener noreferrer");
    if (url.protocol === "https:" || url.protocol === "http:") a.setAttribute("target", "_blank");
  });
  // Wide tables scroll inside their own box instead of widening the page.
  fragment.querySelectorAll("table").forEach((table) => {
    const wrap = document.createElement("div");
    wrap.className = "study-guide-table-wrap";
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Table");
    table.replaceWith(wrap);
    wrap.append(table);
  });
  return fragment;
}

async function initStudyGuide() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("course");
  // A missing (or empty) ?course is the original Combo link; any other value is
  // looked up as given and never replaced by another course.
  let currentSlug = requested ? requested : DEFAULT_GUIDE_COURSE;

  const tabsEl = document.getElementById("studyGuideTabs");
  const bodyEl = document.getElementById("studyGuideBody");
  const eyebrowEl = document.getElementById("studyGuideEyebrow");
  const titleEl = document.getElementById("studyGuideTitle");
  const ledeEl = document.getElementById("studyGuideLede");
  const pageTitle = titleEl.textContent;
  const pageLede = ledeEl.textContent;

  // Course tabs belong to the three original guides only.
  const showTabs = (slug) => {
    tabsEl.hidden = !LEGACY_GUIDE_COURSES.includes(slug);
  };
  showTabs(currentSlug);

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }

  function renderTabs() {
    tabsEl.querySelectorAll(".study-guide-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.course === currentSlug);
    });
  }

  function setHeader(eyebrow, title, showLede) {
    eyebrowEl.textContent = eyebrow;
    titleEl.textContent = title;
    ledeEl.textContent = pageLede;
    ledeEl.hidden = !showLede;
  }

  function showState(text) {
    const p = document.createElement("p");
    p.className = "study-guide-loading";
    p.textContent = text;
    bodyEl.replaceChildren(p);
  }

  function showUnavailable(text) {
    setHeader("Study Guide", pageTitle, false);
    showState(text);
  }

  // The generated guide of the three original courses, unchanged.
  async function renderLegacyGuide(course, isCurrent) {
    document.getElementById("studyGuideEyebrow").textContent = "Study Guide · " + course.title;

    const { data: moduleRows, error: modulesError } = await supabaseClient
      .from("modules")
      .select("id, title, position, lessons(id, title, type, content, position)")
      .eq("course_id", course.id)
      .order("position")
      .order("position", { foreignTable: "lessons" });
    if (!isCurrent()) return;

    if (modulesError || !moduleRows || !moduleRows.length) {
      bodyEl.innerHTML = '<p class="study-guide-loading">No study guide content is available for this course yet.</p>';
      return;
    }

    bodyEl.innerHTML = "";
    moduleRows.forEach((mod) => {
      const lessonSections = mod.lessons
        .filter((lesson) => lesson.type !== "quiz")
        .map((lesson) => {
          const points = extractKeyPoints(lesson.content);
          if (!points.length) return "";
          return (
            '<div class="study-guide-lesson">' +
            "<h3>" + lesson.title + "</h3>" +
            "<ul>" + points.map((p) => "<li>" + p + "</li>").join("") + "</ul>" +
            "</div>"
          );
        })
        .join("");

      if (!lessonSections) return;

      const moduleSection = document.createElement("div");
      moduleSection.className = "study-guide-module";
      moduleSection.innerHTML = "<h2>" + mod.title + "</h2>" + lessonSections;
      bodyEl.appendChild(moduleSection);
    });

    if (!bodyEl.children.length) {
      bodyEl.innerHTML = '<p class="study-guide-loading">No study guide content is available for this course yet.</p>';
    }
  }

  // A released, authored guide: page title from the course, one H2 per section
  // heading, and the sanitized section content beneath it.
  function renderAuthoredGuide(course, sections) {
    const nodes = sections.map((section) => {
      const wrap = document.createElement("section");
      wrap.className = "study-guide-section";
      if (section.heading != null && section.heading.trim() !== "") {
        const h2 = document.createElement("h2");
        h2.textContent = section.heading;
        wrap.append(h2);
      }
      const content = document.createElement("div");
      content.className = "study-guide-authored";
      content.append(sanitizeGuideHtml(section.content));
      wrap.append(content);
      return wrap;
    });
    setHeader("Study Guide", course.title, false);
    bodyEl.replaceChildren(...nodes);
  }

  let loadSeq = 0;
  async function loadGuide(slug) {
    const seq = ++loadSeq;
    const isCurrent = () => seq === loadSeq;
    bodyEl.innerHTML = '<p class="study-guide-loading">Loading study guide...</p>';

    const { data: course, error: courseError } = await supabaseClient
      .from("courses")
      .select("id, slug, title, published, study_guide_released")
      .eq("slug", slug)
      .maybeSingle();
    if (!isCurrent()) return;

    if (courseError) {
      showUnavailable("The Study Guide could not be loaded. Please refresh the page to try again.");
      return;
    }
    // Unknown, and draft (students can't read drafts; admins are shown the
    // student view), look the same.
    if (!course || course.published !== true) {
      showUnavailable("This Study Guide isn't available.");
      return;
    }

    const isLegacy = LEGACY_GUIDE_COURSES.includes(course.slug);

    if (course.study_guide_released === true) {
      const { data: sections, error: sectionsError } = await supabaseClient
        .from("study_guide_sections")
        .select("id, heading, content, position, created_at")
        .eq("course_id", course.id)
        .order("position")
        .order("created_at")
        .order("id");
      if (!isCurrent()) return;
      if (sectionsError) {
        showUnavailable("The Study Guide could not be loaded. Please refresh the page to try again.");
        return;
      }
      if (sections && sections.length) {
        // Authored HTML is only ever shown sanitized; without the sanitizer, fail closed.
        if (!window.DOMPurify || !window.DOMPurify.isSupported) {
          showUnavailable("The Study Guide could not be loaded. Please refresh the page to try again.");
          return;
        }
        renderAuthoredGuide(course, sections);
        return;
      }
    }

    if (isLegacy) {
      setHeader("Study Guide", pageTitle, true);
      await renderLegacyGuide(course, isCurrent);
      return;
    }
    showUnavailable("This course's Study Guide isn't available yet.");
  }

  tabsEl.querySelectorAll(".study-guide-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.course === currentSlug) return;
      currentSlug = btn.dataset.course;
      const url = new URL(window.location.href);
      url.searchParams.set("course", currentSlug);
      window.history.replaceState(null, "", url);
      renderTabs();
      loadGuide(currentSlug);
    });
  });

  document.getElementById("printGuideBtn").addEventListener("click", () => window.print());

  renderTabs();
  loadGuide(currentSlug);
}

if (studyGuideRoot) {
  initStudyGuide();
}
