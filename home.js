// Linh Hua homepage: "Satin Sculpture" motion (hero parallax and the
// once-only reveals of each section's art; the motion itself is CSS).
//
// Progressive enhancement only. Every element this script touches is
// already complete and visible by default (see home.css) — this file's
// only job is to add a hidden starting state and animate out of it. If
// this script fails to load, throws, or never runs, the page is unaffected.
//
// Gate: html.motion-ok is set synchronously in <head>, only when JS runs
// AND the visitor has not asked for reduced motion. If it's missing, do
// nothing at all.
(function () {
  if (!document.documentElement.classList.contains("motion-ok")) return;

  // The hero entrance is pure CSS (home.css), so it needs nothing here.

  // ---------- Pointer parallax (hero only, fine pointers, stops when settled) ----------
  function heroParallax() {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    var svg = document.querySelector("svg.home-satin--desktop");
    var stage = document.querySelector(".home-hero");
    if (!svg || !stage) return;
    var lifeGroup = svg.querySelector(".satin-strand--life");
    var healthGroup = svg.querySelector(".satin-strand--health");
    var shadowGroup = svg.querySelector(".satin-shadow");
    if (!lifeGroup || !healthGroup || !shadowGroup) return;

    var tx = 0, ty = 0, cx = 0, cy = 0, raf = null, last = 0, k = 1;

    // SVG user units per CSS pixel, kept current by a ResizeObserver so the
    // frame loop never reads layout (a read after the previous group's write
    // would force a synchronous layout, twice per frame).
    // k is 0 while the desktop art is hidden (the mobile layout), which
    // idles the parallax instead of moving an invisible layer.
    function measure() { var w = svg.getBoundingClientRect().width; k = w ? 2200 / w : 0; }
    measure();
    if ("ResizeObserver" in window) new ResizeObserver(measure).observe(svg);
    else window.addEventListener("resize", measure);

    // Depth planes: Life (front) moves most, Health a little less, and the
    // shadow on the wall least. `translate` (not `transform`) so it composes
    // with the entrance animation. SVG user units, scaled to CSS pixels.
    function shift(el, depth) {
      el.style.translate = (cx * depth * k).toFixed(2) + "px " + (cy * depth * k).toFixed(2) + "px";
    }

    // Exponential follow on real elapsed time, so it feels the same at 60,
    // 120 or 144 Hz; tau 187ms is the approved feel at 60 Hz (0.085/frame).
    var TAU = 187;
    function frame(now) {
      var dt = last ? Math.min(64, now - last) : 1000 / 60;
      last = now;
      var a = 1 - Math.exp(-dt / TAU);
      cx += (tx - cx) * a;
      cy += (ty - cy) * a;
      shift(lifeGroup, 1);
      shift(healthGroup, 0.72);
      shift(shadowGroup, 0.3);
      if (Math.abs(tx - cx) + Math.abs(ty - cy) > 0.05) {
        raf = requestAnimationFrame(frame);
      } else {
        raf = null;
        last = 0;
      }
    }

    function kick() {
      if (!raf && k) raf = requestAnimationFrame(frame);
    }

    function unit(v) { return Math.max(-1, Math.min(1, v * 2 - 1)); }

    document.querySelector(".home-hero").addEventListener("pointermove", function (e) {
      var r = stage.getBoundingClientRect();
      tx = unit((e.clientX - r.left) / r.width) * 5;
      ty = unit((e.clientY - r.top) / r.height) * 8;
      kick();
    });
    document.querySelector(".home-hero").addEventListener("pointerleave", function () {
      tx = 0;
      ty = 0;
      kick();
    });
  }

  // ---------- Scroll-triggered reveals (each once, as it scrolls in) ----------

  // The practice exam study: one clockwise sweep reveals its band, once,
  // after its frame has faded in and its layers have loaded (motion itself
  // is CSS, in home.css; without this script the study is simply complete).
  function studySweep() {
    var study = document.querySelector(".home-study--ring");
    if (!study || !("IntersectionObserver" in window)) return;
    var svg = study.querySelector("svg");
    study.classList.add("is-armed");
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      var done = false;
      function go() {
        if (done) return;
        done = true;
        // Once round, the mask (whose feathered start never closes) goes.
        svg.addEventListener("animationend", function () { study.classList.remove("is-armed"); }, { once: true });
        study.classList.add("is-drawn");
      }
      function ready() { return svg.hasAttribute("data-ready") && study.classList.contains("visible"); }
      // 350ms: the frame's fade is 99% in by then (as for the course cards).
      if (ready()) { setTimeout(go, 350); return; }
      var mo = new MutationObserver(function () { if (ready()) { mo.disconnect(); setTimeout(go, 350); } });
      mo.observe(svg, { attributes: true, attributeFilter: ["data-ready"] });
      mo.observe(study, { attributes: true, attributeFilter: ["class"] });
      setTimeout(function () { mo.disconnect(); go(); }, 2500);
    }, { threshold: 0.4 });
    io.observe(study);
  }

  // How it works: the staircase fills in from the first tread to the last,
  // once, as it scrolls in, and each step arrives with its tread (the
  // motion itself is CSS, in home.css). Waits for the art to load.
  function stairsClimb() {
    var stairs = document.querySelector(".home-stairs");
    if (!stairs || !("IntersectionObserver" in window)) return;
    stairs.classList.add("is-armed");
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      // The view on screen (phones have their own render).
      var svg = stairs.querySelector(window.matchMedia("(max-width: 599px)").matches ? ".home-stairs-svg--mobile" : ".home-stairs-svg--desktop");
      var done = false;
      function go() {
        if (done) return;
        done = true;
        // Once the climb has filled in, its mask goes.
        svg.addEventListener("animationend", function () { stairs.classList.remove("is-armed"); }, { once: true });
        stairs.classList.add("is-drawn");
      }
      if (svg.hasAttribute("data-ready")) { go(); return; }
      var mo = new MutationObserver(function () { if (svg.hasAttribute("data-ready")) { mo.disconnect(); go(); } });
      mo.observe(svg, { attributes: true, attributeFilter: ["data-ready"] });
      setTimeout(function () { mo.disconnect(); go(); }, 2500);
    }, { threshold: 0.35 });
    io.observe(stairs);
  }

  // The closing CTA: the two strands draw in once, left to right, as the
  // panel scrolls in (the motion itself is CSS, in home.css).
  function ctaDraw() {
    var panel = document.querySelector(".home-cta-panel");
    if (!panel || !("IntersectionObserver" in window)) return;
    var svg = panel.querySelector(".home-cta-svg");
    panel.classList.add("is-armed");
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      var done = false;
      function go() {
        if (done) return;
        done = true;
        svg.addEventListener("animationend", function () { panel.classList.remove("is-armed"); }, { once: true });
        panel.classList.add("is-drawn");
      }
      // After the panel's own fade (350ms, as elsewhere) and the art's load.
      function ready() { return svg.hasAttribute("data-ready") && panel.classList.contains("visible"); }
      if (ready()) { setTimeout(go, 350); return; }
      var mo = new MutationObserver(function () { if (ready()) { mo.disconnect(); setTimeout(go, 350); } });
      mo.observe(svg, { attributes: true, attributeFilter: ["data-ready"] });
      mo.observe(panel, { attributes: true, attributeFilter: ["class"] });
      setTimeout(function () { mo.disconnect(); go(); }, 2500);
    }, { threshold: 0.4 });
    io.observe(panel);
  }

  function init() {
    heroParallax();
    studySweep();
    stairsClimb();
    ctaDraw();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
