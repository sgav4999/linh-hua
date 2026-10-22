// Source checks for the public footers (Phase 11 C): the Courses column on the
// four public pages holds one generic link to the catalog instead of a static
// list of course names (Node's built-in runner):
//   node --test tests/footer-links.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PAGES = ["index.html", "about.html", "contact.html", "courses.html"];
const OLD_LINKS = ["Life Insurance License", "Health Insurance License", "Life & Health Combo"];

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&rarr;/g, "→").replace(/&#39;/g, "'");
const anchors = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
  attrs: m[1], href: (/\bhref="([^"]*)"/.exec(m[1]) || [])[1], text: decode(m[2].replace(/<[^>]+>/g, "")).trim(),
}));

// The page's footer, and each footer column keyed by its heading text.
function footerOf(file) {
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  const start = html.indexOf('<footer class="site-footer">');
  const end = html.indexOf("</footer>", start);
  assert.ok(start >= 0 && end > start, file + ": footer present");
  const footer = html.slice(start, end + "</footer>".length);
  const columns = {};
  for (const m of footer.matchAll(/<div class="footer-col">\s*<h2>([^<]+)<\/h2>([\s\S]*?)<\/div>/g)) columns[m[1].trim()] = m[2];
  return { footer, columns };
}

for (const file of PAGES) {
  test(file + ": the Courses column holds exactly one link, \"All courses\" → courses.html", () => {
    const { columns } = footerOf(file);
    assert.ok("Courses" in columns, "Courses heading unchanged");
    const links = anchors(columns.Courses);
    assert.equal(links.length, 1);
    assert.equal(links[0].text, "All courses");
    assert.equal(links[0].href, "courses.html");
    assert.doesNotMatch(links[0].attrs, /\b(role|tabindex|aria-disabled|disabled|onclick|target)\b/, "a plain anchor");
  });

  test(file + ": no course names anywhere in the footer", () => {
    const { footer } = footerOf(file);
    const texts = anchors(footer).map((a) => a.text);
    for (const name of OLD_LINKS) {
      assert.ok(!texts.includes(name), name + " link");
      assert.ok(!decode(footer).includes(name), name + " text");
    }
  });

  test(file + ": the rest of the footer keeps its structure", () => {
    const { footer, columns } = footerOf(file);
    assert.deepEqual(Object.keys(columns), ["Company", "Courses", "Account"], "column order and headings");
    assert.deepEqual(anchors(columns.Company).map((a) => a.text + " → " + a.href), ["About → about.html", "Courses → courses.html", "Contact → contact.html"]);
    assert.deepEqual(anchors(columns.Account).map((a) => a.text + " → " + a.href), ["Log In → login.html", "Sign Up → signup.html"]);
    assert.match(footer, /<div class="footer-brand">\s*<a href="index\.html" class="logo">/);
    assert.ok(footer.includes("<p>Online courses to help you get licensed in life and health insurance.</p>"), "brand line unchanged");
    assert.match(footer, /<div class="footer-bottom">\s*<div class="container">\s*<p>&copy; <span id="year"><\/span> Linh Hua\. All rights reserved\.<\/p>/);
    assert.doesNotMatch(footer, /<script\b/, "the footer stays static");
  });
}

test("the four footers are identical", () => {
  const footers = PAGES.map((f) => footerOf(f).footer);
  for (const f of footers.slice(1)) assert.equal(f, footers[0]);
});
