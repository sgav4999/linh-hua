const contactForm = document.getElementById("contactForm");

if (contactForm) {
  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const messageEl = document.getElementById("formMessage");
    const submitBtn = contactForm.querySelector('button[type="submit"]');

    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const reason = document.getElementById("reason").value;
    const message = document.getElementById("message").value.trim();

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";

    const { error } = await supabaseClient
      .from("contact_submissions")
      .insert({ name, email, reason, message });

    submitBtn.disabled = false;
    submitBtn.textContent = "Send Message";

    if (error) {
      messageEl.textContent = "Something went wrong sending your message. Please try again.";
      messageEl.className = "form-message error";
      return;
    }

    messageEl.textContent = "Thanks, your message has been sent to the Linh Hua team.";
    messageEl.className = "form-message success";
    contactForm.reset();
  });
}
