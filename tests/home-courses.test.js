// Tests for the homepage course preview (Phase 11): the pure category-context
// helper in home-courses.js, plus source checks on index.html, home.css,
// home.js and home-courses.js (Node's built-in runner):
//   node --test tests/home-courses.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const H = require("../home-courses.js");
const Model = require("../home-model.js");
const Catalog = require("../catalog-model.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const INDEX = read("index.html");
const HOME_CSS = read("home.css");
const HOME_JS = read("home.js");
const RENDERER = read("home-courses.js");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
const RENDERER_CODE = stripComments(RENDERER);

// The homepage course section: from its opening tag to the next </section>.
const COURSE_BLOCK = (() => {
  const start = INDEX.indexOf('<section class="section home-courses" id="courses">');
  assert.ok(start >= 0, "course section present");
  return INDEX.slice(start, INDEX.indexOf("</section>", start) + "</section>".length);
})();

// ---------------------------------------------------------------- fixtures
const cat = (slug, position, title) => ({ id: "cat-" + slug, slug, title: title === undefined ? "Title " + slug : title, position });
const A = cat("alpha", 1);
const B = cat("beta", 2);
const C = cat("gamma", 3);
const D = cat("delta", 4);
const row = (slug, category, position, extra) => Object.assign({ id: "id-" + slug, slug, title: "Course " + slug, position, published: true, category }, extra || {});
const many = (prefix, category, n) => Array.from({ length: n }, (_, i) => row(prefix + (i + 1), category, i + 1));
const contexts = (rows, cap) => H.contextFor(Model.selectPreview(rows, cap).items);

// ---------------------------------------------------------------- category context
test("context: one visible category gives no context lines", () => {
  assert.deepEqual(contexts(many("a", A, 3)), [null, null, null]);
});

test("context: two visible categories label every plate", () => {
  assert.deepEqual(contexts([...many("a", A, 3), ...many("b", B, 1)]), ["Title alpha", "Title beta", "Title alpha"]);
});

test("context: a category plus uncategorised courses uses \"Other courses\"", () => {
  assert.deepEqual(contexts([...many("a", A, 2), row("u1", null, 1)]), ["Title alpha", "Other courses", "Title alpha"]);
});

test("context: four source categories with cap 3 follow the three selected groups, not categoryCount", () => {
  const rows = [...many("a", A, 1), ...many("b", B, 1), ...many("c", C, 1), ...many("d", D, 1)];
  const model = Model.selectPreview(rows, 3);
  assert.equal(model.categoryCount, 4, "the model counts every category before the cap");
  assert.equal(model.items.length, 3);
  assert.deepEqual(H.contextFor(model.items), ["Title alpha", "Title beta", "Title gamma"]);
});

test("context: a multi-category catalog whose selected items share one group shows none", () => {
  const rows = [...many("a", A, 3), ...many("b", B, 2)];
  const model = Model.selectPreview(rows, 1);
  assert.equal(model.categoryCount, 2);
  assert.deepEqual(H.contextFor(model.items), [null]);
});

test("context: a blank category title falls back to the category slug", () => {
  const blank = cat("slug-fallback", 2, "   ");
  assert.deepEqual(contexts([row("a1", A, 1), row("x1", blank, 1)]), ["Title alpha", "slug-fallback"]);
});

test("context: a category with no usable title or slug falls back to \"Other courses\"", () => {
  const bare = { id: "cat-bare", slug: "  ", title: null, position: 2 };
  assert.deepEqual(contexts([row("a1", A, 1), row("x1", bare, 1)]), ["Title alpha", "Other courses"]);
});

test("context: a slug-only category (no id) groups by its slug", () => {
  const s1 = { slug: "only-slug", title: "Slug Group", position: 2 };
  const s2 = { slug: "only-slug", title: "Slug Group", position: 2 };
  assert.deepEqual(contexts([row("a1", A, 1), row("s1", s1, 1), row("s2", s2, 2)]), ["Title alpha", "Slug Group", "Slug Group"]);
  assert.deepEqual(contexts([row("s1", s1, 1), row("s2", s2, 2)]), [null, null], "two category objects with one slug are one group");
});

test("context: empty and non-array input", () => {
  assert.deepEqual(H.contextFor([]), []);
  assert.deepEqual(H.contextFor(null), []);
});

test("constants: \"Other courses\" and the empty line match the Courses catalog", () => {
  assert.equal(H.OTHER_TITLE, "Other courses");
  assert.equal(H.OTHER_TITLE, Catalog.OTHER_TITLE);
  const catalogEmpty = /const EMPTY_TEXT = "([^"]+)";/.exec(read("catalog.js"));
  assert.ok(catalogEmpty, "catalog.js empty text found");
  assert.equal(H.EMPTY_TEXT, catalogEmpty[1]);
  assert.equal(H.EMPTY_TEXT, "New courses are being prepared. Check back soon.");
});

test("exports: only the pure helper and its two constants", () => {
  assert.deepEqual(Object.keys(H).sort(), ["EMPTY_TEXT", "OTHER_TITLE", "contextFor"]);
});

// ---------------------------------------------------------------- index.html: scripts and head
test("index: dependency scripts run in order, synchronously, after auth.js", () => {
  const at = (re) => { const m = re.exec(INDEX); assert.ok(m, String(re)); return m.index; };
  const auth = at(/<script src="auth\.js"><\/script>/);
  const data = at(/<script src="courses-data\.js\?v=20261020p10"><\/script>/);
  const model = at(/<script src="home-model\.js\?v=20261021p11"><\/script>/);
  const view = at(/<script src="home-courses\.js\?v=20261021p11"><\/script>/);
  assert.ok(auth < data && data < model && model < view, "auth.js < courses-data.js < home-model.js < home-courses.js");
  for (const f of ["courses-data", "home-model", "home-courses"]) {
    assert.doesNotMatch(INDEX, new RegExp('<script[^>]*src="' + f + '\\.js[^"]*"[^>]*\\b(async|defer)\\b'), f + " is a plain classic script");
  }
  assert.match(INDEX, /<script src="home\.js\?v=20261021p11" defer><\/script>/);
});

test("index: identity.css and the Phase 11 tokens", () => {
  assert.match(INDEX, /<link rel="stylesheet" href="identity\.css\?v=20261019a">/);
  assert.match(INDEX, /<link rel="stylesheet" href="home\.css\?v=20261021p11">/);
  assert.doesNotMatch(INDEX, /home\.(css|js)\?v=2026101[0-9]a/, "old homepage tokens gone");
});

// ---------------------------------------------------------------- index.html: the course block
test("course block: the static shell (heading, approved line, one Explore link, empty mount)", () => {
  assert.match(COURSE_BLOCK, /<div class="home-grid" aria-hidden="true">/);
  assert.equal((COURSE_BLOCK.match(/<h2>/g) || []).length, 1);
  assert.match(COURSE_BLOCK, /<h2>Choose your licensing path<\/h2>/);
  assert.match(COURSE_BLOCK, /<p class="section-sub">Explore the courses available now, then view the full catalog to compare every option\.<\/p>/);
  assert.equal((COURSE_BLOCK.match(/href="courses\.html"/g) || []).length, 1, "exactly one link to the catalog");
  assert.match(COURSE_BLOCK, /<a href="courses\.html" class="home-courses-link">Explore all courses <span aria-hidden="true">&rarr;<\/span><\/a>/);
  assert.match(COURSE_BLOCK, /<div class="home-course-preview" id="homeCoursePreview"><\/div>/, "the mount is empty");
  assert.equal((COURSE_BLOCK.match(/<a\b/g) || []).length, 1, "no other link in the block");
});

test("course block: no static cards, prices, hours or old classes", () => {
  const banned = ["$149", "$249", "$298", "Save $49", "Best value", "20 course hours", "40 course hours", "Learn More", "course-price",
    "course-savings", "course-features", "course-tag", "course-card", "home-course-card", "home-paths", "home-combo", "paths-reveal",
    "Life Insurance License", "Health Insurance License", "Life &amp; Health Combo", "Life & Health Combo", "Enrollment", "one price",
    "Every course includes", "<article", "<button", "<h3", "disabled", "<noscript", "loading", "spinner", "skeleton"];
  for (const b of banned) assert.ok(!COURSE_BLOCK.includes(b), b);
});

test("art retired: no course-path markup or loader call; the other satin sections keep theirs", () => {
  for (const b of ["home-paths", "pathsLife", "pathsHealth", "paths-reveal", "paths-shadow", "paths-strand", "home-paths-combo", "assets/courses/paths-"]) {
    assert.ok(!INDEX.includes(b), b);
  }
  assert.equal((INDEX.match(/satinArt\(\{/g) || []).length, 4, "hero, studies, stairs and closing CTA");
  for (const sel of ["svg.home-satin--desktop", ".home-study--", ".home-stairs-svg--desktop", ".home-cta-svg"]) assert.ok(INDEX.includes(sel), sel);
  // The asset files stay in the repository (cleanup is Phase 13)
  assert.ok(fs.readdirSync(path.join(ROOT, "assets", "courses")).some((f) => f.startsWith("paths-")), "paths-* assets kept");
});

// ---------------------------------------------------------------- home.css
// Every rule whose selector names the preview or a plate
const previewRules = [...HOME_CSS.matchAll(/([^{}]*\.home-course-(?:preview|plate)[^{}]*)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));

test("home.css: the old cards, Combo, 2 + 1 grid and course art are gone", () => {
  const banned = ["home-course-card", "home-paths", "home-combo", "paths-draw", "paths-reveal", "paths-shadow", "\"life . health\"", "grid-area: life",
    "grid-area: health", "grid-area: combo", "--paths-life", "--paths-health", "--paths-shadow-o", "assets/courses/paths-", "739px"];
  for (const b of banned) assert.ok(!HOME_CSS.includes(b), b);
});

test("home.css: no course colours; plates use the shared identity tokens", () => {
  assert.doesNotMatch(HOME_CSS, /#5b3fe8|#2141d0|#5d3ff6/i);
  assert.doesNotMatch(HOME_CSS, /\[data-identity/);
  assert.match(HOME_CSS, /\.home-course-plate-band\s*\{[^}]*var\(--id-fill\)[^}]*var\(--id2-fill/);
});

test("home.css: plates are inert (no hover, press, pointer or movement)", () => {
  assert.ok(previewRules.length > 5, "preview rules found");
  for (const r of previewRules) {
    assert.doesNotMatch(r.sel, /:(hover|active|focus)/, r.sel);
    // Property names only (text-transform is typography, not movement)
    assert.doesNotMatch(r.body, /(^|[;{\s])(cursor|transform|translate|scale|transition)\s*:/, r.sel);
  }
});

test("home.css: loading reservation, 6 s release, failed collapse and a 200 ms opacity-only arrival", () => {
  assert.match(HOME_CSS, /html\.js \.home-course-preview\[data-state="loading"\]\s*\{[^}]*min-height:\s*280px;[^}]*animation:\s*home-preview-release 0s linear 6s forwards;/);
  assert.match(HOME_CSS, /@keyframes home-preview-release\s*\{\s*to\s*\{\s*min-height:\s*0;\s*\}\s*\}/);
  assert.match(HOME_CSS, /\.home-course-preview\[data-state="failed"\]\s*\{\s*display:\s*none;\s*\}/);
  assert.match(HOME_CSS, /html\.motion-ok \.home-course-preview\.is-arriving\s*\{\s*animation:\s*home-preview-in 200ms var\(--ease-out\) both;\s*\}/);
  const keyframes = /@keyframes home-preview-in\s*\{([\s\S]*?)\}\s*\}/.exec(HOME_CSS);
  assert.ok(keyframes, "arrival keyframes");
  assert.doesNotMatch(keyframes[1], /transform|translate|scale|filter/);
  assert.match(keyframes[1], /opacity/);
});

test("home.css: count-driven grid with capped plate widths and long-word wrapping", () => {
  assert.match(HOME_CSS, /\.home-course-preview\[data-count="1"\]/);
  assert.match(HOME_CSS, /\.home-course-preview\[data-count="2"\]/);
  assert.match(HOME_CSS, /minmax\(0, 360px\)/);
  assert.match(HOME_CSS, /minmax\(0, 420px\)/);
  assert.match(HOME_CSS, /\.home-course-plate-body\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(HOME_CSS, /\.home-course-plate-meta\s*\{[^}]*margin:\s*auto 0 0;/);
});

test("home.css: one course registration guide, on the plate row (300px)", () => {
  assert.match(HOME_CSS, /\.home-courses \.home-grid \{ --gy: calc\(300px - var\(--grid-step\) \/ 2\); --guides: linear-gradient\(180deg, transparent 300px, var\(--grid-major\) 300px 301px, transparent 301px\); \}/);
});

// ---------------------------------------------------------------- home.js
test("home.js: the course-path reveal is removed; the other motion stays", () => {
  for (const b of ["coursePaths", "home-course-card", "home-paths", "paths-"]) assert.ok(!HOME_JS.includes(b), b);
  for (const fn of ["heroParallax", "studySweep", "stairsClimb", "ctaDraw"]) {
    assert.match(HOME_JS, new RegExp("function " + fn + "\\("), fn + " defined");
    assert.match(HOME_JS, new RegExp("\\n\\s+" + fn + "\\(\\);"), fn + " called");
  }
  assert.match(HOME_JS, /if \(!document\.documentElement\.classList\.contains\("motion-ok"\)\) return;/);
});

// ---------------------------------------------------------------- home-courses.js source
test("renderer: no current course or category knowledge", () => {
  for (const s of ["life", "health", "life-health-combo", "series-6", "series-63"]) {
    assert.doesNotMatch(RENDERER, new RegExp("[\"'`]" + s + "[\"'`]", "i"), s);
  }
  for (const name of ["Life Insurance License", "Health Insurance License", "Life & Health Combo", "Insurance Licensing", "Securities Exams", "Series 6", "Series 63"]) {
    assert.ok(!RENDERER.includes(name), name);
  }
});

test("renderer: never uses categoryCount", () => {
  assert.ok(!RENDERER.includes("categoryCount"));
});

test("renderer: reads only published courses; no session, enrollment, content or write access", () => {
  for (const banned of [/supabaseClient/, /\.from\(/, /getSession/, /enrollments/, /\bmodules\b/, /\blessons\b/, /practice_questions/, /study_guide_sections/,
    /lesson_progress/, /loadMyEnrollments/, /loadDashboardCourses/, /loadAllCourses/, /loadCourseBySlug/, /loadCourseAccess/, /isAdminSession/, /\brpc\(/, /\bfetch\(/]) {
    assert.doesNotMatch(RENDERER_CODE, banned, String(banned));
  }
  for (const used of ["loadPublishedCourses", "selectPreview", "applyCourseIdentity", "courseLabel", "metaLine", "textContent"]) {
    assert.ok(RENDERER_CODE.includes(used), used + " used");
  }
});

test("renderer: safe DOM only, no links, buttons or focus targets inside plates", () => {
  for (const banned of [/innerHTML/, /insertAdjacentHTML/, /outerHTML/, /document\.write/, /course\.html/, /createElement\(\s*["'](a|button|input)["']/,
    /\.href\b/, /tabindex/i, /\.tabIndex/, /\.reveal\b|["'`]reveal["'`]/, /onclick|addEventListener\(\s*["']click/]) {
    assert.doesNotMatch(RENDERER_CODE, banned, String(banned));
  }
  const roles = [...RENDERER_CODE.matchAll(/setAttribute\(\s*"role",\s*"([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(roles, ["status"], "the only role is the zero line's status");
});

test("renderer: no prices, savings or hour copy", () => {
  assert.doesNotMatch(RENDERER, /\$\d|Save \$|Best value|course hours?|Self-paced/i);
});

test("renderer: loading, terminal states and the arrival class", () => {
  for (const s of ['"loading"', '"ready"', '"empty"', '"failed"', '"aria-busy"', '"data-count"', '"is-arriving"', '"homeCoursePreview"']) {
    assert.ok(RENDERER_CODE.includes(s), s);
  }
  assert.match(RENDERER_CODE, /removeAttribute\("aria-busy"\)/);
  assert.doesNotMatch(RENDERER_CODE, /console\.(error|warn|log)/, "expected load failures stay silent");
  assert.doesNotMatch(RENDERER_CODE, /setTimeout|setInterval/, "no retry loop or request timeout");
});
