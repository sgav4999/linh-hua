// Homepage course preview model: pure functions over the published-course read
// (no DOM, no Supabase). From the course rows it picks a short, fair preview:
// up to `cap` courses, one from each category first, then a second from each,
// and so on, in catalog order. Nothing here names a course or a category:
// every course and category comes from the data.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./courses-data.js"));
  else root.LinhHomeModel = factory(root.LinhCourses);
})(typeof self !== "undefined" ? self : this, function (Courses) {
  "use strict";

  const DEFAULT_CAP = 3;
  const OTHER = "other";

  // Published (strictly true, as on the Courses page) with a usable slug.
  const isListed = (r) => !!r && r.published === true && typeof r.slug === "string" && r.slug.trim() !== "";

  // The catalog's category identity; courses without a category share one group.
  const groupKey = (r) => (r.category ? "category:" + String(r.category.id || r.category.slug || "") : OTHER);

  // A missing cap, or anything other than a positive whole number, is the default.
  const capOf = (cap) => (Number.isInteger(cap) && cap > 0 ? cap : DEFAULT_CAP);

  // { items, total, categoryCount }
  //   items          the chosen rows (the caller's own objects, never changed),
  //                  taken round-robin across categories in catalog order
  //   total          every listed course, before the cap
  //   categoryCount  categories with a listed course (courses without a
  //                  category are not counted as one)
  function selectPreview(rows, cap) {
    const list = (Array.isArray(rows) ? rows : []).filter(isListed).sort(Courses.byCatalogOrder);
    const groups = new Map();
    list.forEach((r) => {
      const key = groupKey(r);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    // byCatalogOrder already sorts uncategorised courses last; keep it explicit.
    const lists = [...groups.entries()].sort((a, b) => (a[0] === OTHER) - (b[0] === OTHER)).map((e) => e[1]);

    const max = capOf(cap);
    const items = [];
    for (let round = 0; items.length < max && lists.some((l) => round < l.length); round++) {
      for (const l of lists) {
        if (round < l.length && items.length < max) items.push(l[round]);
      }
    }
    return { items, total: list.length, categoryCount: lists.length - (groups.has(OTHER) ? 1 : 0) };
  }

  return { selectPreview, DEFAULT_CAP };
});
