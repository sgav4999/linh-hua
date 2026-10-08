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
  navToggle.setAttribute("aria-controls", "navWrap");
  navToggle.setAttribute("aria-expanded", "false");

  const setMenuOpen = (open) => {
    navWrap.classList.toggle("open", open);
    navToggle.setAttribute("aria-expanded", String(open));
  };

  navToggle.addEventListener("click", () => {
    setMenuOpen(!navWrap.classList.contains("open"));
  });

  navWrap.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setMenuOpen(false));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && navWrap.classList.contains("open")) {
      setMenuOpen(false);
      navToggle.focus();
    }
  });

  // Matches the 900px compact-header breakpoint in styles.css.
  window.matchMedia("(min-width: 900px)").addEventListener("change", (e) => {
    if (e.matches) setMenuOpen(false);
  });
}

// Make a list of items drag-to-reorder. Call this after rendering the list
// (it re-attaches listeners to the current DOM each time).
//   containerEl   - the element whose direct children are the items
//   itemSelector  - CSS selector matching each reorderable item
//   handleSelector- selector (within each item) that starts the drag
//   onDrop        - called after a drop with the item elements in new order
// The list itself accepts the drop (over any item, the moved item or a gap), so
// a release anywhere inside it saves exactly once; a drag that ends without a
// drop puts the list back in its original order. Each list only accepts its
// own item, so nested lists never take each other's drags.
const draggableLists = new WeakMap();

function makeListDraggable(containerEl, itemSelector, handleSelector, onDrop) {
  if (!containerEl) return;
  // The container can outlive re-renders: its listeners are added only once.
  let list = draggableLists.get(containerEl);
  if (!list) {
    list = { draggedEl: null, snapshot: null, dropped: false };
    draggableLists.set(containerEl, list);
    const items = () => Array.from(containerEl.children).filter((el) => el.matches(list.itemSelector));

    containerEl.addEventListener("dragover", (e) => {
      if (!list.draggedEl) return;
      e.preventDefault();
      const others = items().filter((el) => el !== list.draggedEl);
      const next = others.find((el) => {
        const rect = el.getBoundingClientRect();
        return e.clientY < rect.top + rect.height / 2;
      });
      const last = others[others.length - 1];
      const ref = next || (last ? last.nextSibling : null);
      if (ref !== list.draggedEl && list.draggedEl.nextSibling !== ref) containerEl.insertBefore(list.draggedEl, ref);
    });

    containerEl.addEventListener("drop", (e) => {
      if (!list.draggedEl) return;
      e.preventDefault();
      if (list.dropped) return;
      list.dropped = true;
      list.onDrop(items());
    });
  }
  list.itemSelector = itemSelector;
  list.onDrop = onDrop;

  containerEl.querySelectorAll(itemSelector).forEach((item) => {
    const handle = item.querySelector(handleSelector) || item;
    handle.setAttribute("draggable", "true");

    handle.addEventListener("dragstart", (e) => {
      list.draggedEl = item;
      list.snapshot = Array.from(containerEl.childNodes);
      list.dropped = false;
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => {
        if (list.draggedEl === item) item.classList.add("dragging");
      }, 0);
    });

    handle.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      if (!list.dropped && list.snapshot) list.snapshot.forEach((node) => containerEl.appendChild(node));
      list.draggedEl = null;
      list.snapshot = null;
      list.dropped = false;
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
