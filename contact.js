const contactForm = document.getElementById("contactForm");

if (contactForm) {
  const messageEl = document.getElementById("formMessage");
  const submitBtn = contactForm.querySelector('button[type="submit"]');
  const ledger = contactForm.closest(".contact-ledger");
  const record = document.getElementById("contactRecord");
  const SUCCESS_TEXT = "Thanks, your message has been sent to the Linh Hua team.";
  const ERROR_TEXT = "Something went wrong sending your message. Please try again.";
  let sending = false;

  // The result line beside the button (role="alert": errors are announced at once).
  function setMessage(text, kind) {
    messageEl.textContent = text;
    messageEl.className = kind ? "form-message " + kind : "form-message";
  }

  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending) return; // one request at a time
    sending = true;

    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const reason = document.getElementById("reason").value;
    const message = document.getElementById("message").value.trim();

    setMessage("", "");
    if (record) record.hidden = true;
    if (ledger) delete ledger.dataset.state;
    // Hold the button at its own width while it reads "Sending...".
    submitBtn.style.minWidth = submitBtn.getBoundingClientRect().width + "px";
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";
    contactForm.setAttribute("aria-busy", "true");

    // Every path (an error result, a thrown or offline request, a missing
    // client, anything unexpected) ends with the button back in its normal state.
    let sent = false;
    try {
      const { error } = await supabaseClient
        .from("contact_submissions")
        .insert({ name, email, reason, message });
      sent = !error;
    } catch (err) {
      sent = false;
    } finally {
      sending = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Send Message";
      submitBtn.style.minWidth = "";
      contactForm.removeAttribute("aria-busy");
    }

    if (!sent) {
      // Keep everything the visitor typed; announce the error and let them retry.
      setMessage(ERROR_TEXT, "error");
      submitBtn.focus();
      return;
    }

    // Success: the ledger shows a record of what was sent. Visitor values are
    // written with textContent only, captured before the form is reset, and
    // never read again (typing a new message cannot change the record).
    contactForm.reset();
    if (record) {
      document.getElementById("contactRecordNote").textContent = SUCCESS_TEXT;
      document.getElementById("contactRecordReason").textContent = reason;
      document.getElementById("contactRecordEmail").textContent = email;
      record.hidden = false;
      if (ledger) ledger.dataset.state = "sent";
      record.focus();
    } else {
      setMessage(SUCCESS_TEXT, "success");
    }
  });
}
