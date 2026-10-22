// Source checks for the homepage claim cleanup (Phase 11 B2): the hero's
// enrollment status is plain text, the credentials keep only the two verified
// facts, and the closing call to action no longer promises a lesson today
// (Node's built-in runner):
//   node --test tests/home-claims.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const INDEX = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const HOME_CSS = fs.readFileSync(path.join(ROOT, "home.css"), "utf8");

// One element's markup, from its opening tag to the matching closing tag of
// the same name (counting nested tags of that name).
function element(html, openTag) {
  const start = html.indexOf(openTag);
  assert.ok(start >= 0, "found " + openTag);
  const name = /^<(\w+)/.exec(openTag)[1];
  const re = new RegExp("<(/?)" + name + "\\b[^>]*>", "g");
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error("unclosed " + openTag);
}
const textOf = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const count = (s, needle) => s.split(needle).length - 1;

const HERO = element(INDEX, '<section class="home-hero">');
const ACTIONS = element(HERO, '<div class="hero-actions">');
const CREDENTIALS = element(HERO, '<div class="container home-credentials-inner">');
const CTA = element(INDEX, '<section class="home-cta">');

// ---------------------------------------------------------------- hero status
test("hero: the enrollment status is plain text, \"Enrollment opens soon\"", () => {
  assert.equal(count(HERO, "Enrollment opens soon"), 1);
  const status = /<(\w+)([^>]*)>((?:(?!<\/\1>)[\s\S])*Enrollment opens soon)<\/\1>/.exec(ACTIONS);
  assert.ok(status, "status element inside the hero actions");
  const [, tag, attrs] = status;
  assert.ok(["p", "span"].includes(tag), "plain text element, got <" + tag + ">");
  assert.match(attrs, /class="home-hero-status"/);
  assert.doesNotMatch(attrs, /\b(disabled|tabindex|role|aria-disabled|href|onclick|type)\b/, "no control semantics");
  assert.equal(textOf(status[0]), "Enrollment opens soon");
});

test("hero: the disabled \"Enrollment Coming Soon\" control is gone", () => {
  assert.equal(count(INDEX, "Enrollment Coming Soon"), 0);
  assert.equal(count(INDEX, "btn-coming-soon"), 0);
  assert.doesNotMatch(HERO, /<button\b/);
  assert.doesNotMatch(HERO, /\bdisabled\b/);
  assert.doesNotMatch(ACTIONS, /\b(tabindex|aria-disabled)\b|role="button"/);
});

test("hero: View Courses stays the one action beside the status", () => {
  assert.equal((ACTIONS.match(/<a\b/g) || []).length, 1);
  assert.ok(ACTIONS.includes('<a href="courses.html" class="btn btn-primary btn-lg">View Courses &rarr;</a>'));
  assert.doesNotMatch(ACTIONS, /<(button|input|select|textarea)\b/);
});

test("hero: eyebrow, headline, supporting copy and page title are unchanged", () => {
  assert.ok(HERO.includes('<span class="home-eyebrow"><i class="home-eyebrow-rule" aria-hidden="true"></i>Life &amp; health licensing</span>'));
  assert.ok(HERO.includes('<h1>Get <span class="accent-text">licensed</span> to sell life &amp; health insurance.</h1>'));
  assert.ok(HERO.includes('<p class="home-hero-sub">Self-paced online courses that prepare you to pass your state licensing exam, with lessons, quizzes, and a full practice exam included.</p>'));
  assert.ok(INDEX.includes("<title>Linh Hua — Life &amp; Health Insurance Licensing Courses</title>"));
});

test("home.css: the hero status has no control or motion styling", () => {
  const rules = [...HOME_CSS.matchAll(/([^{}]*\.home-hero-status[^{}]*)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  assert.ok(rules.length >= 1, "status rules found");
  for (const r of rules) {
    assert.doesNotMatch(r.sel, /:(hover|active|focus)/, r.sel);
    assert.doesNotMatch(r.body, /(^|[;{\s])(cursor|transform|translate|scale|transition|animation|background|border|box-shadow|outline)\s*:/, r.sel);
  }
  assert.equal(count(HOME_CSS, "btn-coming-soon"), 0, "the removed control's dark-theme override is gone too");
});

// ---------------------------------------------------------------- credentials
test("credentials: exactly the two verified facts", () => {
  const items = [...CREDENTIALS.matchAll(/<div class="home-credential">([\s\S]*?)<\/div>/g)].map((m) => textOf(m[1]));
  assert.deepEqual(items, ["Self-paced, 100% online", "Study on any device"]);
});

test("credentials: the price claim is gone from the whole homepage", () => {
  assert.equal(count(INDEX, "One-time price, no subscription"), 0);
  assert.equal(count(INDEX, "One-time price"), 0);
  assert.doesNotMatch(INDEX, /no subscription/i);
});

// ---------------------------------------------------------------- closing call to action
test("closing CTA: the approved sentence replaces the lesson-today promise", () => {
  assert.equal(count(CTA, "<p>Create an account now and you'll be ready when enrollment opens.</p>"), 1);
  assert.equal(count(INDEX, "Create your free account and start your first lesson today."), 0);
  assert.equal(count(INDEX, "start your first lesson"), 0);
});

test("closing CTA: heading and both actions are unchanged", () => {
  assert.ok(CTA.includes("<h2>Ready to get licensed?</h2>"));
  const actions = element(CTA, '<div class="home-cta-actions">');
  assert.ok(actions.includes('<a href="signup.html" class="btn btn-primary btn-lg">Sign Up</a>'));
  assert.ok(actions.includes('<a href="courses.html" class="home-cta-link">View Courses &rarr;</a>'));
  assert.equal((actions.match(/<a\b/g) || []).length, 2);
});

// ---------------------------------------------------------------- boundaries
test("claims scan: stale strings absent, approved strings present", () => {
  for (const stale of ["Enrollment Coming Soon", "One-time price, no subscription", "Create your free account and start your first lesson today."]) {
    assert.equal(count(INDEX, stale), 0, stale);
  }
  for (const ok of ["Enrollment opens soon", "Self-paced, 100% online", "Study on any device", "Create an account now and you'll be ready when enrollment opens."]) {
    assert.equal(count(INDEX, ok), 1, ok);
  }
});

test("out of scope copy is untouched: How it works and the footer brand line", () => {
  assert.ok(INDEX.includes("<h2>From sign-up to licensed agent</h2>"));
  assert.ok(INDEX.includes("<h3>Take the State Exam</h3>"));
  assert.ok(INDEX.includes("<p>Pass your exam, submit your application, and start selling as a licensed agent.</p>"));
  assert.ok(INDEX.includes("<p>Online courses to help you get licensed in life and health insurance.</p>"));
});
