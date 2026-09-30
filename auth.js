const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function showMessage(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.className = "form-message " + type;
}

function setLoading(button, isLoading, loadingText, defaultText) {
  button.disabled = isLoading;
  button.textContent = isLoading ? loadingText : defaultText;
}

// Sign up form
const signupForm = document.getElementById("signupForm");
if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const messageEl = document.getElementById("formMessage");
    const fullName = document.getElementById("fullName").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (password !== confirmPassword) {
      showMessage(messageEl, "Passwords do not match.", "error");
      return;
    }

    const submitBtn = signupForm.querySelector('button[type="submit"]');
    setLoading(submitBtn, true, "Creating account...", "Create Account");

    // Every self-service signup is a student account. Admin access can
    // only be granted afterward by an existing admin (Enrolled Students
    // page) or directly in the Supabase dashboard — never by anything
    // the signing-up user submits here.
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    setLoading(submitBtn, false, "Creating account...", "Create Account");

    if (error) {
      showMessage(messageEl, error.message, "error");
      return;
    }

    if (data.session) {
      window.location.href = "dashboard.html";
    } else {
      showMessage(messageEl, "Account created! Check your email to confirm it, then log in.", "success");
      signupForm.reset();
    }
  });
}

// Log in form
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const messageEl = document.getElementById("formMessage");
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const submitBtn = loginForm.querySelector('button[type="submit"]');
    setLoading(submitBtn, true, "Logging in...", "Log In");

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    setLoading(submitBtn, false, "Logging in...", "Log In");

    if (error) {
      showMessage(messageEl, error.message, "error");
      return;
    }

    window.location.href = "dashboard.html";
  });
}

// Forgot password form
const forgotPasswordForm = document.getElementById("forgotPasswordForm");
if (forgotPasswordForm) {
  forgotPasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const messageEl = document.getElementById("formMessage");
    const email = document.getElementById("email").value.trim();

    const submitBtn = forgotPasswordForm.querySelector('button[type="submit"]');
    setLoading(submitBtn, true, "Sending...", "Send Reset Link");

    const redirectTo = new URL("reset-password.html", window.location.href).href;
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });

    setLoading(submitBtn, false, "Sending...", "Send Reset Link");

    if (error) {
      showMessage(messageEl, error.message, "error");
      return;
    }

    showMessage(messageEl, `If an account exists for ${email}, a reset link has been sent.`, "success");
    forgotPasswordForm.reset();
  });
}

// Reset password form (landed on via the link from the reset email)
const resetPasswordForm = document.getElementById("resetPasswordForm");
if (resetPasswordForm) {
  resetPasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const messageEl = document.getElementById("formMessage");
    const newPassword = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (newPassword !== confirmPassword) {
      showMessage(messageEl, "Passwords do not match.", "error");
      return;
    }

    const submitBtn = resetPasswordForm.querySelector('button[type="submit"]');
    setLoading(submitBtn, true, "Updating...", "Set New Password");

    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });

    setLoading(submitBtn, false, "Updating...", "Set New Password");

    if (error) {
      showMessage(messageEl, "This link may be invalid or expired: " + error.message, "error");
      return;
    }

    showMessage(messageEl, "Password updated! Redirecting to log in...", "success");
    resetPasswordForm.reset();
    setTimeout(() => { window.location.href = "login.html"; }, 1500);
  });
}

// Dashboard (gated page)
const dashboardRoot = document.getElementById("dashboardRoot");
if (dashboardRoot) {
  (async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      window.location.href = "login.html";
      return;
    }

    const user = session.user;
    const role = user.app_metadata && user.app_metadata.role === "admin" ? "admin" : "student";

    document.getElementById("userName").textContent = "Welcome back, " + ((user.user_metadata && user.user_metadata.full_name) || user.email);
    document.getElementById("userEmail").textContent = user.email;

    const roleBadge = document.getElementById("userRole");
    roleBadge.textContent = role === "admin" ? "Admin" : "Student";
    roleBadge.classList.add(role === "admin" ? "role-badge-admin" : "role-badge-student");

    document.querySelectorAll(".student-only").forEach((el) => {
      el.style.display = role === "admin" ? "none" : "";
    });
    document.querySelectorAll(".admin-only").forEach((el) => {
      el.style.display = role === "admin" ? "" : "none";
    });
  })();
}

// Log out (shared across any page with a #logoutBtn)
const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
  });
}

// Header user menu: avatar + dropdown (Dashboard / Account Settings / Log Out).
// On marketing pages this also swaps out the Log In / Sign Up links.
const userMenuEl = document.getElementById("userMenu");
if (userMenuEl) {
  (async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    const loginLink = document.getElementById("navLoginLink");
    const signupLink = document.getElementById("navSignupLink");
    const themeToggleNav = document.getElementById("themeToggleNav");
    if (loginLink) loginLink.style.display = "none";
    if (signupLink) signupLink.style.display = "none";
    if (themeToggleNav) themeToggleNav.style.display = "none";
    userMenuEl.style.display = "";

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("full_name, email, avatar_url")
      .eq("id", session.user.id)
      .single();

    const name = (profile && profile.full_name) || session.user.email;
    const email = (profile && profile.email) || session.user.email;
    const avatarUrl = profile && profile.avatar_url;

    const nameEl = document.getElementById("userMenuName");
    const emailEl = document.getElementById("userMenuEmail");
    if (nameEl) nameEl.textContent = name;
    if (emailEl) emailEl.textContent = email;

    const populateAvatar = (el) => {
      if (!el) return;
      if (avatarUrl) {
        el.style.backgroundImage = `url("${avatarUrl}")`;
        el.textContent = "";
      } else {
        el.textContent = name.trim().slice(0, 1).toUpperCase();
      }
    };
    populateAvatar(document.getElementById("userAvatar"));
    populateAvatar(document.getElementById("dashboardAvatar"));
  })();

  const trigger = document.getElementById("userMenuTrigger");
  const dropdown = document.getElementById("userMenuDropdown");
  if (trigger && dropdown) {
    // Expose the open state to assistive tech and close on Escape (returning
    // focus to the avatar), matching the mobile menu's behavior.
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");
    const setOpen = (open) => {
      dropdown.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
    };
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(dropdown.hidden);
    });
    dropdown.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => {
      setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !dropdown.hidden) {
        setOpen(false);
        trigger.focus();
      }
    });
  }
}
