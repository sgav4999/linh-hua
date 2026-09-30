const CHECKOUT_COURSES = {
  life: {
    tag: "Life",
    title: "Life Insurance License",
    desc: "Covers everything on your state's Life Insurance exam content outline, from policy types to underwriting basics.",
    price: 149,
    features: [
      "Unlimited timed practice exams",
      "Printable study guide",
    ],
  },
  health: {
    tag: "Health",
    title: "Health Insurance License",
    desc: "Covers everything on your state's Health Insurance exam content outline, including major medical, HMOs, and long-term care.",
    price: 149,
    features: [
      "Unlimited timed practice exams",
      "Printable study guide",
    ],
  },
  combo: {
    tag: "Life + Health",
    title: "Life & Health Combo",
    desc: "Prepare for both the Life and Health exams together and save compared to buying separately.",
    price: 249,
    features: [
      "Covers both state exam outlines",
      "Unlimited timed practice exams",
      "Printable study guides",
    ],
  },
};

(function initCheckoutSummary() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("course");
  const course = CHECKOUT_COURSES[slug] || CHECKOUT_COURSES.combo;

  document.getElementById("checkoutTag").textContent = course.tag;
  document.getElementById("checkoutTitle").textContent = course.title;
  document.getElementById("checkoutDesc").textContent = course.desc;
  document.getElementById("checkoutPrice").textContent = `$${course.price}`;

  const featuresEl = document.getElementById("checkoutFeatures");
  featuresEl.innerHTML = "";
  course.features.forEach((feature) => {
    const li = document.createElement("li");
    li.textContent = feature;
    featuresEl.appendChild(li);
  });
})();

(async function prefillFromSession() {
  if (typeof supabaseClient === "undefined") return;
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const nameField = document.getElementById("name");
  const emailField = document.getElementById("email");
  if (nameField && !nameField.value) {
    nameField.value = (session.user.user_metadata && session.user.user_metadata.full_name) || "";
  }
  if (emailField && !emailField.value) {
    emailField.value = session.user.email || "";
  }
})();

const checkoutForm = document.getElementById("checkoutForm");
if (checkoutForm) {
  checkoutForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const messageEl = document.getElementById("formMessage");
    messageEl.textContent = "Payment isn't connected yet — this page is ready to go once Stripe is set up.";
    messageEl.className = "form-message error";
  });
}
