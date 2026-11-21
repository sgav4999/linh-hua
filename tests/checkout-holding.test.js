// Payment-disabled checkout holding page (retirement release, 2026-11). Until the Phase 12 checkout ships,
// checkout.html is one neutral page for every link (?course=life, health, an offered course, none or an
// unknown slug): no course, price, course choice, savings claim or customer form, and no payment code.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "checkout.html"), "utf8");
const MAIN = HTML.slice(HTML.indexOf("<main>"), HTML.indexOf("</main>") + 7);
const SCRIPTS = [...HTML.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map((m) => m[1]);

test("holding state: heading, message and the single Browse courses action", () => {
  assert.equal((HTML.match(/<h1\b/g) || []).length, 1);
  assert.match(MAIN, /<h1 id="checkoutHoldingTitle">Enrollment opens soon<\/h1>/);
  assert.match(MAIN, /<section class="page-hero" aria-labelledby="checkoutHoldingTitle">/);
  assert.match(MAIN, /<p>Online enrollment isn&#39;t available yet\. Browse our current courses for more information\.<\/p>/);
  const links = [...MAIN.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(links, [["courses.html", "Browse courses"]]);
});

test("no old order summary: no price, course choice, Combo fallback, savings claim or customer form", () => {
  assert.doesNotMatch(HTML, /\$\s?\d/, "no price");
  assert.doesNotMatch(HTML, /Order Summary|checkoutPrice|checkoutTitle|checkoutTag|checkoutFeatures|checkout-total|checkout-course-card/);
  assert.doesNotMatch(HTML, /Life Insurance License|Health Insurance License|Life &amp; Health Combo|Life \+ Health/);
  assert.doesNotMatch(HTML, /\bsave\b|savings/i);
  assert.doesNotMatch(HTML, /<form\b|<input\b|<select\b|<textarea\b|type="submit"/);
});

test("no payment code: the old summary script is not loaded and nothing calls a payment function", () => {
  assert.deepEqual(SCRIPTS, ["script.js", "supabase-config.js", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js", "auth.js"]);
  assert.doesNotMatch(HTML, /checkout\.js|functions\/v1|create-checkout-session|checkout-status|stripe/i);
  // the page has no inline script beyond the pre-paint theme line
  const inline = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(inline.length, 1);
  assert.match(inline[0], /linhhoa_theme/);
});

test("the holding page ignores the query string (same document for every course link)", () => {
  assert.doesNotMatch(HTML, /URLSearchParams|location\.search|\?course=/);
});

test("the site shell stays: header navigation, account menu and footer", () => {
  assert.match(HTML, /<header class="site-header">/);
  assert.match(HTML, /<nav class="nav">[\s\S]*href="courses\.html">Courses<\/a>/);
  assert.match(HTML, /id="userMenu"/);
  assert.match(HTML, /<footer class="site-footer">/);
});
