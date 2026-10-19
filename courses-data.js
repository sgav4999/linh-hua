// Shared course metadata loader. Data only: it never redirects, decides
// whether someone is signed in, shows UI or owns loading/error state; each
// page does that itself. No caching or retries.
//
// Return contract:
//   loadCourseBySlug      -> the course, or null when it doesn't exist or
//                            can't be read (callers show their own message)
//   loadPublishedCourses  -> an array (possibly empty); throws on a read error
//   loadAllCourses        -> published and draft courses, same shape and order;
//                            throws on a read error (admin pages use it; what a
//                            caller may read is decided by database rules)
//   loadCourseCategories  -> an array (possibly empty); throws on a read error
//   loadDashboardCourses  -> every published course the reader can see, with its
//                            modules, lessons and visible guide sections, in
//                            catalog order; throws on a read error
//   studyGuideMode        -> "authored", "legacy" or null for a course (the one
//                            Study Guide availability rule; see below)
//   loadMyEnrollments     -> { enrolledCourseIds: Set } for the signed-in user;
//                            throws on a read error
//   canAccessCourse       -> true only for a published course the access lists
//   loadCourseAccess      -> the page gate: { state, course, access } (see below)
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LinhCourses = api;
})(typeof self !== "undefined" ? self : this, function () {
  const COURSE_FIELDS =
    "id, slug, title, short_label, category_id, position, published, identity, identity_secondary, hours, description, " +
    "category:course_categories!courses_category_id_fkey(id, slug, title, position)";

  // Identity tokens follow the database format check; anything else is ignored.
  const TOKEN = /^[a-z][a-z0-9-]{0,31}$/;

  // The identity names identity.css defines (no identity = the neutral palette).
  // Keep this list and identity.css in step.
  const IDENTITY_TOKENS = Object.freeze(["violet", "cobalt"]);

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

  // Drafts included. No role check here: admin pages guard themselves and the
  // database rules decide which rows a caller can read.
  async function loadAllCourses() {
    const { data, error } = await supabaseClient
      .from("courses")
      .select(COURSE_FIELDS);
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

  // The three original courses. Their Study Guide is generated from lesson
  // content unless an authored guide has been released. (study-guide.html
  // repeats this list in its pre-paint script to hide the course tabs early.)
  const LEGACY_GUIDE_SLUGS = Object.freeze(["life", "health", "life-health-combo"]);
  const isLegacyGuideCourse = (slug) => LEGACY_GUIDE_SLUGS.includes(slug);

  // Which Study Guide a course has, if any: its authored guide once released
  // with at least one section the reader can see, otherwise the generated
  // guide of a legacy course, otherwise none. This is availability only;
  // whether the reader may see the course at all is decided by the read that
  // produced it (published filter, database rules, later Phase 9 access).
  function studyGuideMode(course) {
    if (!course) return null;
    if (course.study_guide_released === true && Number(course.sectionCount) > 0) return "authored";
    if (isLegacyGuideCourse(course.slug)) return "legacy";
    return null;
  }

  // The Dashboard read: published courses only (database rules hide drafts
  // from students as well), with what the Study Desk shows. Guide sections are
  // listed by id only, to count the ones the reader can see.
  const DASHBOARD_FIELDS =
    COURSE_FIELDS + ", study_guide_released, study_guide_sections(id), " +
    "modules(id, title, position, lessons(id, title, position))";

  async function loadDashboardCourses() {
    const { data, error } = await supabaseClient
      .from("courses")
      .select(DASHBOARD_FIELDS)
      .eq("published", true);
    if (error) throw new Error("Courses could not be loaded.");
    return (data || []).slice().sort(byCatalogOrder);
  }

  // ---- Course access (Phase 9) --------------------------------------------
  // A student may open a course's content when the course is published and
  // they are enrolled in it; admins (JWT app_metadata.role, never
  // profiles.role) may open every course. The database enforces this rule
  // (RLS + public.can_access_course); this mirror only decides what a page
  // lists, which message it shows and whether a content read is worth making.
  // Every failure is reported, never turned into "all courses".

  // One page of a user's own enrollments covers every course there will be;
  // a full page is refused rather than read as a partial list.
  const ENROLLMENT_LIMIT = 1000;
  const ACCESS_FIELDS = COURSE_FIELDS + ", study_guide_released";

  function isAdminSession(session) {
    const meta = session && session.user && session.user.app_metadata;
    return !!meta && meta.role === "admin";
  }

  const makeAccess = (courseIds) => Object.freeze({ enrolledCourseIds: new Set((courseIds || []).filter(Boolean)) });
  const isAccess = (access) => !!access && access.enrolledCourseIds instanceof Set;

  // The signed-in user's enrollments as { enrolledCourseIds: Set }; throws on
  // any read error.
  async function loadMyEnrollments(userId) {
    if (!userId) throw new Error("Enrollments could not be loaded.");
    const { data, error } = await supabaseClient
      .from("enrollments")
      .select("course_id")
      .eq("user_id", userId)
      .order("course_id")
      .range(0, ENROLLMENT_LIMIT - 1);
    if (error || !Array.isArray(data) || data.length >= ENROLLMENT_LIMIT) {
      throw new Error("Enrollments could not be loaded.");
    }
    return makeAccess(data.map((row) => row.course_id));
  }

  // Student rule: published and enrolled. Missing or invalid access is false.
  function canAccessCourse(course, access) {
    if (!course || !isAccess(access)) return false;
    return course.published === true && access.enrolledCourseIds.has(course.id);
  }

  // The page gate, run before any content read. Resolves to { state, course,
  // access } where state is:
  //   "admin"       an admin; every course, drafts included
  //   "enrolled"    a student who may open this course
  //   "no-access"   a student who may see the course but not open it
  //   "unavailable" no such course, or one the database hides (a draft, for a student)
  //   "error"       the course or enrollment read failed (never shown as no-access)
  // `access` reuses an enrollment read the page already made.
  async function loadCourseAccess(session, slug, access) {
    if (!session || !session.user) return { state: "error", course: null };
    if (!slug) return { state: "unavailable", course: null };
    let course;
    try {
      const { data, error } = await supabaseClient.from("courses").select(ACCESS_FIELDS).eq("slug", slug).maybeSingle();
      if (error) return { state: "error", course: null };
      course = data;
    } catch (e) {
      return { state: "error", course: null };
    }
    if (!course) return { state: "unavailable", course: null };
    if (isAdminSession(session)) return { state: "admin", course };
    let mine = access;
    if (!isAccess(mine)) {
      try {
        mine = await loadMyEnrollments(session.user.id);
      } catch (e) {
        return { state: "error", course };
      }
    }
    return { state: canAccessCourse(course, mine) ? "enrolled" : "no-access", course, access: mine };
  }

  return {
    loadCourseBySlug, loadPublishedCourses, loadAllCourses, loadCourseCategories, loadDashboardCourses,
    applyCourseIdentity, courseLabel, byCatalogOrder, studyGuideMode, isLegacyGuideCourse,
    isAdminSession, loadMyEnrollments, canAccessCourse, loadCourseAccess,
    IDENTITY_TOKENS, LEGACY_GUIDE_SLUGS,
  };
});
