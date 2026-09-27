document.getElementById("year").textContent = new Date().getFullYear();

const themeToggles = document.querySelectorAll(".js-theme-toggle");
function syncThemeToggleLabels() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  document.querySelectorAll(".dropdown-theme-toggle-label").forEach((el) => {
    el.textContent = isDark ? "Light Mode" : "Dark Mode";
  });
}
if (themeToggles.length) {
  themeToggles.forEach((btn) => {
    btn.addEventListener("click", () => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      if (isDark) {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("linhhoa_theme", "light");
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
        localStorage.setItem("linhhoa_theme", "dark");
      }
      syncThemeToggleLabels();
    });
  });
  syncThemeToggleLabels();
}

const navToggle = document.getElementById("navToggle");
const navWrap = document.getElementById("navWrap");

if (navToggle && navWrap) {
  navToggle.addEventListener("click", () => {
    navWrap.classList.toggle("open");
  });

  navWrap.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      navWrap.classList.remove("open");
    });
  });
}

// Make a list of items drag-to-reorder. Call this after rendering the list
// (it re-attaches listeners to the current DOM each time).
//   containerEl   - the element whose direct children are the items
//   itemSelector  - CSS selector matching each reorderable item
//   handleSelector- selector (within each item) that starts the drag
//   onDrop        - called after a drop with the item elements in new order
function makeListDraggable(containerEl, itemSelector, handleSelector, onDrop) {
  if (!containerEl) return;
  let draggedEl = null;

  containerEl.querySelectorAll(itemSelector).forEach((item) => {
    const handle = item.querySelector(handleSelector) || item;
    handle.setAttribute("draggable", "true");

    handle.addEventListener("dragstart", (e) => {
      draggedEl = item;
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => item.classList.add("dragging"), 0);
    });

    handle.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      draggedEl = null;
    });

    item.addEventListener("dragover", (e) => {
      if (!draggedEl || draggedEl === item) return;
      e.preventDefault();
      const rect = item.getBoundingClientRect();
      const before = e.clientY - rect.top < rect.height / 2;
      item.parentNode.insertBefore(draggedEl, before ? item : item.nextSibling);
    });

    item.addEventListener("drop", (e) => {
      if (!draggedEl) return;
      e.preventDefault();
      onDrop(Array.from(containerEl.querySelectorAll(itemSelector)));
    });
  });
}

// Animate a stat number (e.g. "12,000+", "95%") from 0 up to its target value.
function animateStatNumber(el) {
  const text = el.textContent.trim();
  const match = text.match(/^([^\d]*)([\d,]+)(.*)$/);
  if (!match) return;

  const [, prefix, numStr, suffix] = match;
  if (suffix.startsWith("/")) return; // skip odd formats like "24/7"

  const target = parseInt(numStr.replace(/,/g, ""), 10);
  if (isNaN(target)) return;

  const duration = 1100;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(target * eased);
    el.textContent = prefix + current.toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// Subtle cursor-tracking parallax tilt on the homepage hero illustration.
const heroIllustration = document.querySelector(".hero-illustration");
if (heroIllustration && window.matchMedia("(hover: hover)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const heroSection = document.querySelector(".hero");
  heroSection.addEventListener("mousemove", (e) => {
    const rect = heroSection.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    heroIllustration.style.transform = `rotateY(${x * 10}deg) rotateX(${y * -10}deg)`;
  });
  heroSection.addEventListener("mouseleave", () => {
    heroIllustration.style.transform = "";
  });
}

// Scroll-reveal + stat count-up, both gated on the same intersection check.
const revealEls = document.querySelectorAll(".reveal:not(.visible)");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Cards stagger their one-time reveal via an inline transition-delay (e.g.
// 0.08s/0.16s/0.24s). Since that delay isn't scoped to just this transition,
// it would otherwise also apply to hover feedback on the same element —
// clearing it once the reveal finishes keeps hover instant afterward.
function clearRevealDelay(el) {
  const delayMs = (parseFloat(el.style.transitionDelay) || 0) * 1000;
  setTimeout(() => { el.style.transitionDelay = "0s"; }, delayMs + 900);
}

if (prefersReducedMotion) {
  revealEls.forEach((el) => el.classList.add("visible"));
  document.querySelectorAll(".stat-num").forEach((el) => {}); // leave static text as-is
} else if ("IntersectionObserver" in window && revealEls.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        clearRevealDelay(entry.target);
        entry.target.classList.add("visible");
        const statNum = entry.target.matches(".stat-num")
          ? entry.target
          : entry.target.querySelector(".stat-num");
        if (statNum) animateStatNumber(statNum);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.2 }
  );
  revealEls.forEach((el) => observer.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("visible"));
}
