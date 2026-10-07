// Shared course metadata loader. Data only: it never redirects, decides
// whether someone is signed in, shows UI or owns loading/error state; each
// page does that itself. No caching or retries.
//
// Return contract:
//   loadCourseBySlug      -> the course, or null when it doesn't exist or
//                            can't be read (callers show their own message)
//   loadPublishedCourses  -> an array (possibly empty); throws on a read error
//   loadCourseCategories  -> an array (possibly empty); throws on a read error
window.LinhCourses = (() => {
  const COURSE_FIELDS =
    "id, slug, title, short_label, category_id, position, published, identity, identity_secondary, hours, description, " +
    "category:course_categories!courses_category_id_fkey(id, slug, title, position)";

  // Identity tokens follow the database format check; anything else is ignored.
  const TOKEN = /^[a-z][a-z0-9-]{0,31}$/;

  // Returns drafts as well as published courses, exactly as the Course page
  // always has. This is NOT the security boundary: draft protection comes
  // from database rules in a later phase, before any draft course content is
  // imported.
  async function loadCourseBySlug(slug) {
    if (!slug) return null;
    const { data, error } = await supabaseClient
      .from("courses")
      .select(COURSE_FIELDS)
      .eq("slug", slug)
      .single();
    if (error || !data) return null;
    return data;
  }

  const num = (v) => (typeof v === "number" && isFinite(v) ? v : Number.MAX_SAFE_INTEGER);
  const text = (v) => (v == null ? "" : String(v));
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // Category position, then course position, then title; courses without a
  // category come last. Slugs break any remaining tie so the order is stable.
  function byCatalogOrder(a, b) {
    const ca = a.category, cb = b.category;
    return (
      cmp(ca ? 0 : 1, cb ? 0 : 1) ||
      cmp(num(ca && ca.position), num(cb && cb.position)) ||
      cmp(text(ca && ca.slug), text(cb && cb.slug)) ||
      cmp(num(a.position), num(b.position)) ||
      text(a.title).localeCompare(text(b.title)) ||
      cmp(text(a.slug), text(b.slug))
    );
  }

  async function loadPublishedCourses() {
    const { data, error } = await supabaseClient
      .from("courses")
      .select(COURSE_FIELDS)
      .eq("published", true);
    if (error) throw new Error("Courses could not be loaded.");
    return (data || []).slice().sort(byCatalogOrder);
  }

  async function loadCourseCategories() {
    const { data, error } = await supabaseClient
      .from("course_categories")
      .select("id, slug, title, position")
      .order("position")
      .order("slug");
    if (error) throw new Error("Course categories could not be loaded.");
    return data || [];
  }

  // Marks an element with the course's identity tokens for identity.css.
  // No identity (or an invalid one) removes the attributes, which leaves the
  // neutral palette; a secondary is only kept alongside a different primary.
  function applyCourseIdentity(el, course) {
    if (!el) return;
    const primary = course && TOKEN.test(text(course.identity)) ? course.identity : null;
    const secondary =
      primary && TOKEN.test(text(course.identity_secondary)) && course.identity_secondary !== primary
        ? course.identity_secondary
        : null;
    if (primary) el.setAttribute("data-identity", primary);
    else el.removeAttribute("data-identity");
    if (secondary) el.setAttribute("data-identity-secondary", secondary);
    else el.removeAttribute("data-identity-secondary");
  }

  // Short label when there is one, otherwise the full title.
  function courseLabel(course) {
    if (!course) return "";
    const label = text(course.short_label).trim();
    return label || text(course.title);
  }

  return { loadCourseBySlug, loadPublishedCourses, loadCourseCategories, applyCourseIdentity, courseLabel };
})();
