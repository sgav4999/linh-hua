// D1: lesson navigation on the course page. Runs the real course.js in a VM
// context against a small stand-in DOM, Supabase client and layout. The layout
// stand-in reports either the stacked (phone) arrangement, where the lesson
// list sits above the lesson card, or the two-column (desktop) arrangement.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "course.js"), "utf8");
const HEADER_HEIGHT = 68;
const LESSONS = ["l1", "l2", "l3", "l4", "l5"];

function harness({ stacked, reduceMotion = false, hash = "", legacy = null } = {}) {
  const calls = [];       // every Supabase call, in order
  const scrolls = [];     // every window.scrollTo call
  const listeners = {};   // window listeners
  let activeElement = null;
  let scrollY = 0;

  class El {
    constructor(tag, id) {
      this.tagName = tag.toUpperCase();
      this.id = id || "";
      this.children = [];
      this.attrs = {};
      this.listeners = {};
      this.style = {};
      this.hidden = false;
      this.disabled = false;
      this.checked = false;
      this._text = "";
      this.className = "";
      const self = this;
      this.classList = {
        add: (...c) => { const s = new Set(self.className.split(" ").filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); },
        contains: (c) => self.className.split(" ").includes(c),
      };
    }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text; }
    set innerHTML(v) { this._text = String(v); this.children = []; }
    get innerHTML() { return this._text; }
    set href(v) { this.attrs.href = v; }
    get href() { return this.attrs.href; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    replaceChildren(...c) { this.children = c; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    dispatch(t, target) { (this.listeners[t] || []).forEach((fn) => fn({ target: target || this })); }
    querySelectorAll() { return []; }
    querySelector(sel) { return byClass[sel] || null; }
    focus(opts) { activeElement = this; this.focusOptions = opts; }
    closest(sel) {
      for (let n = this; n; n = n.parent) {
        if (sel === "a.lesson-item" && n.tagName === "A" && n.classList.contains("lesson-item")) return n;
      }
      return null;
    }
    getBoundingClientRect() {
      const rect = layout[this.layoutKey];
      return rect ? rect() : { top: 0, bottom: 0, height: 0 };
    }
  }

  // Page-space positions (stacked: the list is 9,000 px tall above the card).
  const layout = {
    header: () => ({ top: 0, bottom: HEADER_HEIGHT, height: HEADER_HEIGHT }),
    sidebar: () => (stacked ? { top: 108 - scrollY, bottom: 9000 - scrollY } : { top: 96, bottom: 700 }),
    content: () => (stacked ? { top: 9024 - scrollY, bottom: 12000 - scrollY } : { top: 108 - scrollY, bottom: 3000 - scrollY }),
  };

  const ids = {};
  for (const id of ["courseRoot", "courseTitle", "progressText", "progressPercent", "progressFill", "moduleList",
    "coursePracticeExamLink", "courseStudyGuideLink", "lessonModuleLabel", "lessonDuration", "lessonTitle",
    "lessonDescription", "lessonListenContainer", "lessonBody", "completeCheckbox", "prevLessonBtn", "nextLessonBtn"]) {
    ids[id] = new El(id === "lessonTitle" ? "h2" : "div", id);
  }
  const header = new El("header"); header.layoutKey = "header";
  const sidebar = new El("aside"); sidebar.layoutKey = "sidebar";
  const content = new El("div"); content.layoutKey = "content";
  const byClass = {
    ".course-sidebar": sidebar, ".course-content": content,
    ".course-progress": new El("div"), ".course-sidebar-actions": new El("div"),
  };
  ids.courseRoot.querySelector = (sel) => byClass[sel] || null;
  const root = new El("html");

  const document = {
    getElementById: (id) => ids[id] || null,
    querySelector: (sel) => (sel === ".site-header" ? header : null),
    createElement: (tag) => new El(tag),
    documentElement: root,
    get activeElement() { return activeElement; },
  };

  let currentHash = hash ? "#" + hash : "";
  const location = {
    search: "?course=sie",
    get hash() { return currentHash; },
    set hash(v) {
      const next = v ? "#" + String(v).replace(/^#/, "") : "";
      if (next === currentHash) return;
      currentHash = next;
      setImmediate(() => (listeners.hashchange || []).forEach((fn) => fn({})));
    },
    href: "course.html?course=sie",
  };

  // Supabase stand-in: records every call; a chain resolves to rows for reads.
  function chain(table) {
    const q = {
      _op: "select",
      select(cols) { calls.push([table, "select", cols]); return q; },
      eq() { return q; }, order() { return q; },
      upsert(rows) { calls.push([table, "upsert", rows]); q._op = "write"; return q; },
      delete() { calls.push([table, "delete"]); q._op = "write"; return q; },
      then(res, rej) {
        if (q._op === "write") return Promise.resolve({ error: null }).then(res, rej);
        if (table === "modules") {
          return Promise.resolve({ data: [
            { id: "m1", title: "Chapter 1", position: 1, lessons: LESSONS.slice(0, 3).map((id, i) => ({ id, title: "Lesson " + id, type: "text", content: "<p>" + id + "</p>", position: i + 1 })) },
            { id: "m2", title: "Chapter 2", position: 2, lessons: LESSONS.slice(3).map((id, i) => ({ id, title: "Lesson " + id, type: "text", content: "<p>" + id + "</p>", position: i + 1 })) },
          ], error: null }).then(res, rej);
        }
        return Promise.resolve({ data: [], error: null }).then(res, rej);
      },
    };
    return q;
  }
  const store = new Map(legacy ? [["linhhoa_progress_sie", JSON.stringify(legacy)]] : []);
  const ctx = {
    document, location, URLSearchParams, setImmediate, Promise, JSON, Set, Map, console,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), removeItem: (k) => store.delete(k) },
    matchMedia: (q) => ({ matches: q === "(prefers-reduced-motion: reduce)" ? reduceMotion : false }),
    scrollTo(a, b) {
      const entry = typeof a === "object" ? { top: a.top, behavior: a.behavior } : { top: b, behavior: undefined };
      entry.cssScrollBehavior = root.style.scrollBehavior || "";
      scrolls.push(entry);
      scrollY = entry.top;
    },
    get scrollY() { return scrollY; },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    supabaseClient: {
      auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
      from: (t) => chain(t),
    },
    LinhCourses: {
      loadCourseAccess: async () => ({ state: "ok", course: { id: "c-sie", slug: "sie", title: "SIE", published: true } }),
      applyCourseIdentity: () => {},
    },
    LinhAccessView: { noAccess: () => new El("div") },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: "course.js" });

  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  const lessonLinks = () => ids.moduleList.children.flatMap((mod) => mod.children[1].children.map((li) => li.children[0]));
  return {
    ids, calls, scrolls, settle, location, lessonLinks, root,
    get activeElement() { return activeElement; },
    writes: () => calls.filter((c) => c[1] !== "select"),
    clickLesson(id) {
      const link = lessonLinks().find((a) => a.getAttribute("href") === "#" + id);
      ids.moduleList.dispatch("click", link.children[1]); // the click lands on the title span
      location.hash = id; // the browser's default action for the link
    },
    back(id) { location.hash = id; },
  };
}

const STACKED_TARGET = 9024 - HEADER_HEIGHT - 12;

test("stacked: first load brings the first lesson below the header, instantly, without taking focus", async () => {
  const h = harness({ stacked: true });
  await h.settle();
  assert.equal(h.ids.lessonTitle.textContent, "Lesson l1");
  assert.deepEqual(h.scrolls, [{ top: STACKED_TARGET, behavior: undefined, cssScrollBehavior: "auto" }]);
  assert.equal(h.activeElement, null);
});

test("stacked: a direct lesson link (Chapter 2) opens that lesson in view", async () => {
  const h = harness({ stacked: true, hash: "l4" });
  await h.settle();
  assert.equal(h.ids.lessonTitle.textContent, "Lesson l4");
  assert.equal(h.ids.lessonModuleLabel.textContent, "Chapter 2");
  assert.deepEqual(h.scrolls.map((s) => s.top), [STACKED_TARGET]);
});

test("stacked: a lesson-list link jumps to the lesson and focuses its title", async () => {
  const h = harness({ stacked: true });
  await h.settle();
  h.clickLesson("l3");
  await h.settle();
  assert.equal(h.ids.lessonTitle.textContent, "Lesson l3");
  assert.deepEqual(h.scrolls.at(-1), { top: STACKED_TARGET, behavior: undefined, cssScrollBehavior: "auto" });
  assert.equal(h.activeElement, h.ids.lessonTitle);
  assert.deepEqual(h.ids.lessonTitle.focusOptions, { preventScroll: true });
});

test("stacked: the current lesson's own link (no hash change) still brings it into view", async () => {
  const h = harness({ stacked: true, hash: "l2" });
  await h.settle();
  const before = h.scrolls.length;
  h.clickLesson("l2");
  await h.settle();
  assert.equal(h.scrolls.length, before + 1);
  assert.equal(h.scrolls.at(-1).top, STACKED_TARGET);
  assert.equal(h.activeElement, h.ids.lessonTitle);
});

test("stacked: Next and Previous jump to the lesson card and focus its title, never to the page top", async () => {
  const h = harness({ stacked: true });
  await h.settle();
  h.ids.nextLessonBtn.dispatch("click");
  await h.settle();
  assert.equal(h.ids.lessonTitle.textContent, "Lesson l2");
  assert.deepEqual(h.scrolls.at(-1), { top: STACKED_TARGET, behavior: undefined, cssScrollBehavior: "auto" });
  assert.equal(h.activeElement, h.ids.lessonTitle);
  h.ids.prevLessonBtn.dispatch("click");
  await h.settle();
  assert.equal(h.ids.lessonTitle.textContent, "Lesson l1");
  assert.deepEqual(h.scrolls.at(-1), { top: STACKED_TARGET, behavior: undefined, cssScrollBehavior: "auto" });
  assert.ok(h.scrolls.every((s) => s.top !== 0), "no scroll to the top of the page");
});

test("stacked: no move scrolls smoothly, with or without a reduced-motion preference", async () => {
  for (const reduceMotion of [false, true]) {
    const h = harness({ stacked: true, reduceMotion });
    await h.settle();
    h.ids.nextLessonBtn.dispatch("click");
    await h.settle();
    h.clickLesson("l4");
    await h.settle();
    h.ids.prevLessonBtn.dispatch("click");
    await h.settle();
    assert.equal(h.scrolls.length, 4);
    assert.ok(h.scrolls.every((s) => s.behavior === undefined && s.cssScrollBehavior === "auto"), "reduceMotion=" + reduceMotion);
  }
});

test("stacked: Back/Forward (hash change without a click) re-renders and reveals the lesson", async () => {
  const h = harness({ stacked: true });
  await h.settle();
  h.clickLesson("l5");
  await h.settle();
  h.back("l1");
  await h.settle();
  assert.equal(h.ids.lessonTitle.textContent, "Lesson l1");
  assert.deepEqual(h.scrolls.at(-1), { top: STACKED_TARGET, behavior: undefined, cssScrollBehavior: "auto" });
});

test("stacked: the page-wide scroll-behavior is restored after each instant jump", async () => {
  const h = harness({ stacked: true });
  h.root.style.scrollBehavior = "smooth"; // an existing inline value is put back as it was
  await h.settle();
  h.clickLesson("l3");
  await h.settle();
  assert.equal(h.scrolls.filter((s) => s.cssScrollBehavior === "auto").length, 2);
  assert.equal(h.root.style.scrollBehavior, "smooth");
});

test("desktop: first load and list/Previous moves do not scroll or move focus; Next keeps its scroll to the top", async () => {
  const h = harness({ stacked: false });
  await h.settle();
  assert.deepEqual(h.scrolls, []);
  h.clickLesson("l3");
  await h.settle();
  h.ids.prevLessonBtn.dispatch("click");
  await h.settle();
  assert.equal(h.ids.lessonTitle.textContent, "Lesson l2");
  assert.deepEqual(h.scrolls, []);
  assert.equal(h.activeElement, null);
  h.ids.nextLessonBtn.dispatch("click");
  await h.settle();
  assert.equal(h.ids.lessonTitle.textContent, "Lesson l3");
  assert.deepEqual(h.scrolls, [{ top: 0, behavior: "smooth", cssScrollBehavior: "" }]);
  assert.equal(h.activeElement, null);
});

test("desktop + reduced motion: Next keeps its original non-smooth scroll to the top", async () => {
  const h = harness({ stacked: false, reduceMotion: true });
  await h.settle();
  h.ids.nextLessonBtn.dispatch("click");
  await h.settle();
  assert.deepEqual(h.scrolls, [{ top: 0, behavior: "auto", cssScrollBehavior: "" }]);
});

test("navigation adds no progress or enrollment writes (stacked and desktop)", async () => {
  for (const stacked of [true, false]) {
    const h = harness({ stacked });
    await h.settle();
    h.clickLesson("l4");
    await h.settle();
    h.ids.nextLessonBtn.dispatch("click");
    await h.settle();
    h.ids.prevLessonBtn.dispatch("click");
    await h.settle();
    h.back("l1");
    await h.settle();
    assert.deepEqual(h.writes(), [], "stacked=" + stacked);
    assert.deepEqual(h.calls.map((c) => c[0] + " " + c[1]), ["modules select", "lesson_progress select"]);
  }
});

test("the legacy progress migration and the completion checkbox behave as before", async () => {
  const h = harness({ stacked: true, legacy: ["l1", "l2", "not-a-lesson"] });
  await h.settle();
  // one migration upsert at load, of the valid legacy ids only
  assert.deepEqual(h.writes(), [["lesson_progress", "upsert", [{ user_id: "u1", lesson_id: "l1" }, { user_id: "u1", lesson_id: "l2" }]]]);
  h.ids.nextLessonBtn.dispatch("click");
  await h.settle();
  assert.equal(h.writes().length, 1, "navigation adds nothing");
  h.ids.completeCheckbox.checked = true;
  h.ids.completeCheckbox.dispatch("change");
  await h.settle();
  assert.deepEqual(h.writes().at(-1), ["lesson_progress", "upsert", { user_id: "u1", lesson_id: "l2" }]);
});

test("course.html: the lesson title can take programmatic focus and course.js is cache-bumped", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "course.html"), "utf8");
  assert.match(html, /<h2 id="lessonTitle" tabindex="-1">/);
  assert.match(html, /<script src="course\.js\?v=20261119r1"><\/script>/);
});
