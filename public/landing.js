const refs = {
  heroView: document.getElementById("heroView"),
  authView: document.getElementById("authView"),
  openLoginBtn: document.getElementById("openLoginBtn"),
  openAdminBtn: document.getElementById("openAdminBtn"),
  signupTab: document.getElementById("signupTab"),
  loginTab: document.getElementById("loginTab"),
  switchToLoginBtn: document.getElementById("switchToLoginBtn"),
  switchToSignupBtn: document.getElementById("switchToSignupBtn"),
  loginForm: document.getElementById("loginForm"),
  signupForm: document.getElementById("signupForm"),
  consumerUsername: document.getElementById("consumerUsername"),
  consumerPassword: document.getElementById("consumerPassword"),
  registerName: document.getElementById("registerName"),
  registerEmail: document.getElementById("registerEmail"),
  registerUsername: document.getElementById("registerUsername"),
  registerPassword: document.getElementById("registerPassword"),
  passwordStrength: document.getElementById("passwordStrength"),
  adminDialog: document.getElementById("adminDialog"),
  adminLoginForm: document.getElementById("adminLoginForm"),
  adminUsername: document.getElementById("adminUsername"),
  adminPassword: document.getElementById("adminPassword"),
  closeAdminBtn: document.getElementById("closeAdminBtn"),
  cancelAdminBtn: document.getElementById("cancelAdminBtn"),
  landingNotice: document.getElementById("landingNotice")
};

let authMode = "signup";

wireEvents();
setAuthMode(authMode);
updatePasswordStrength();

function wireEvents() {
  refs.openLoginBtn.addEventListener("click", showAuthScreen);
  refs.openAdminBtn.addEventListener("click", openAdminDialog);
  refs.signupTab.addEventListener("click", () => setAuthMode("signup"));
  refs.loginTab.addEventListener("click", () => setAuthMode("login"));
  refs.switchToLoginBtn.addEventListener("click", () => setAuthMode("login"));
  refs.switchToSignupBtn.addEventListener("click", () => setAuthMode("signup"));
  refs.loginForm.addEventListener("submit", loginConsumer);
  refs.signupForm.addEventListener("submit", registerConsumer);
  refs.registerPassword.addEventListener("input", updatePasswordStrength);
  refs.closeAdminBtn.addEventListener("click", closeAdminDialog);
  refs.cancelAdminBtn.addEventListener("click", closeAdminDialog);
  refs.adminDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeAdminDialog();
  });
  refs.adminLoginForm.addEventListener("submit", loginAdmin);
  window.addEventListener("keydown", handleKeydown);
}

function showAuthScreen() {
  refs.heroView.classList.add("is-hidden");
  refs.authView.classList.remove("is-hidden");
  setAuthMode("login");
}

function showHeroScreen() {
  refs.authView.classList.add("is-hidden");
  refs.heroView.classList.remove("is-hidden");
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  refs.signupTab.classList.toggle("is-active", !isLogin);
  refs.loginTab.classList.toggle("is-active", isLogin);
  refs.signupForm.classList.toggle("is-hidden", isLogin);
  refs.loginForm.classList.toggle("is-hidden", !isLogin);
  refs.landingNotice.textContent = "";
  if (isLogin) {
    refs.consumerUsername.focus();
  } else {
    refs.registerUsername.focus();
  }
}

function handleKeydown(event) {
  if (event.key === "Escape" && refs.adminDialog.open) {
    closeAdminDialog();
    return;
  }
  if (event.key === "Escape" && !refs.authView.classList.contains("is-hidden")) {
    showHeroScreen();
  }
}

function openAdminDialog() {
  if (!refs.adminDialog.open) refs.adminDialog.showModal();
  refs.adminUsername.focus();
}

function closeAdminDialog() {
  if (refs.adminDialog.open) refs.adminDialog.close();
}

function updatePasswordStrength() {
  const value = refs.registerPassword.value || "";
  const checks = [
    value.length >= 8,
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /[0-9]/.test(value),
    /[^A-Za-z0-9]/.test(value)
  ];
  const score = checks.filter(Boolean).length;
  const label = score <= 1 ? "Weak" : score <= 3 ? "Fair" : score === 4 ? "Strong" : "Very strong";
  refs.passwordStrength.textContent = `Password strength: ${label}`;
}

function validatePassword(password, username = "") {
  const value = String(password || "");
  const usernameLower = String(username || "").toLowerCase();
  if (value.length < 8) return "Password must be at least 8 characters long.";
  if (!/[a-z]/.test(value)) return "Password must include a lowercase letter.";
  if (!/[A-Z]/.test(value)) return "Password must include an uppercase letter.";
  if (!/[0-9]/.test(value)) return "Password must include a number.";
  if (!/[^A-Za-z0-9]/.test(value)) return "Password must include a symbol.";
  if (usernameLower && value.toLowerCase().includes(usernameLower.replace(/\s+/g, ""))) return "Password should not contain your username.";
  return "";
}

async function loginConsumer(event) {
  event.preventDefault();
  const username = refs.consumerUsername.value.trim();
  if (!username) {
    return showNotice("Customer login needs your username.");
  }
  const payload = {
    username,
    password: refs.consumerPassword.value
  };
  let res;
  let data;
  try {
    res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    data = await res.json();
  } catch {
    return showNotice("Unable to reach server. Please retry.");
  }
  if (!res.ok) return showNotice(data.message || "Consumer login failed. Please check username/password.");
  localStorage.setItem("ck_user", JSON.stringify(data.user));
  showNotice("Consumer login successful. Redirecting...");
  window.location.href = "/customer-react/";
}

async function registerConsumer(event) {
  event.preventDefault();
  const username = refs.registerUsername.value.trim();
  const email = refs.registerEmail.value.trim();
  const name = refs.registerName.value.trim();
  const password = refs.registerPassword.value;
  const passwordError = validatePassword(password, username);
  if (passwordError) {
    showNotice(passwordError);
    return;
  }
  const payload = {
    username,
    email,
    name,
    password
  };
  let res;
  let data;
  try {
    res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    data = await res.json();
  } catch {
    return showNotice("Unable to reach server. Please retry.");
  }
  if (!res.ok) return showNotice(data.message || "Registration failed.");
  localStorage.setItem("ck_user", JSON.stringify(data.user));
  showNotice("Account created. Redirecting to customer app...");
  window.location.href = "/customer-react/";
}

async function loginAdmin(event) {
  event.preventDefault();
  const payload = {
    username: refs.adminUsername.value.trim(),
    password: refs.adminPassword.value
  };
  let res;
  let data;
  try {
    res = await fetch("/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    data = await res.json();
  } catch {
    return showNotice("Unable to reach server. Please retry.");
  }
  if (!res.ok) return showNotice(data.message || "Admin login failed.");
  localStorage.setItem("ck_admin_key", data.adminKey);
  localStorage.setItem("ck_admin_user", data.admin.username);
  showNotice("Admin login successful. Redirecting...");
  closeAdminDialog();
  window.location.href = "/admin-react/";
}

function showNotice(message) {
  refs.landingNotice.textContent = message;
}
