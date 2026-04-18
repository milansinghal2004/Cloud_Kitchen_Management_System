const refs = {
  consumerLoginForm: document.getElementById("consumerLoginForm"),
  consumerEmail: document.getElementById("consumerEmail"),
  consumerPassword: document.getElementById("consumerPassword"),
  openRegisterBtn: document.getElementById("openRegisterBtn"),
  openAdminBtn: document.getElementById("openAdminBtn"),
  openAdminBtnInline: document.getElementById("openAdminBtnInline"),
  registerDialog: document.getElementById("registerDialog"),
  consumerRegisterForm: document.getElementById("consumerRegisterForm"),
  registerName: document.getElementById("registerName"),
  registerEmail: document.getElementById("registerEmail"),
  registerPassword: document.getElementById("registerPassword"),
  closeRegisterBtn: document.getElementById("closeRegisterBtn"),
  adminDialog: document.getElementById("adminDialog"),
  adminLoginForm: document.getElementById("adminLoginForm"),
  adminUsername: document.getElementById("adminUsername"),
  adminPassword: document.getElementById("adminPassword"),
  closeAdminBtn: document.getElementById("closeAdminBtn"),
  cancelAdminBtn: document.getElementById("cancelAdminBtn"),
  landingNotice: document.getElementById("landingNotice")
};

wireEvents();

function wireEvents() {
  refs.consumerLoginForm.addEventListener("submit", loginConsumer);
  refs.openRegisterBtn.addEventListener("click", () => refs.registerDialog.showModal());
  refs.closeRegisterBtn.addEventListener("click", () => refs.registerDialog.close());
  refs.consumerRegisterForm.addEventListener("submit", registerConsumer);
  refs.openAdminBtn.addEventListener("click", openAdminDialog);
  refs.openAdminBtnInline.addEventListener("click", openAdminDialog);
  refs.closeAdminBtn.addEventListener("click", closeAdminDialog);
  refs.cancelAdminBtn.addEventListener("click", closeAdminDialog);
  refs.adminDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeAdminDialog();
  });
  refs.adminLoginForm.addEventListener("submit", loginAdmin);
}

function openAdminDialog() {
  if (!refs.adminDialog.open) refs.adminDialog.showModal();
  refs.adminUsername.focus();
}

function closeAdminDialog() {
  if (refs.adminDialog.open) refs.adminDialog.close();
}

async function loginConsumer(event) {
  event.preventDefault();
  const email = refs.consumerEmail.value.trim().toLowerCase();
  if (!email.includes("@")) {
    return showNotice("Customer login needs your registered email ID. Use Create Account if you are new.");
  }
  const payload = {
    email,
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
  if (!res.ok) return showNotice(data.message || "Consumer login failed. Please check email/password.");
  localStorage.setItem("ck_user", JSON.stringify(data.user));
  showNotice("Consumer login successful. Redirecting...");
  window.location.href = "/customer-react/";
}

async function registerConsumer(event) {
  event.preventDefault();
  const payload = {
    name: refs.registerName.value.trim(),
    email: refs.registerEmail.value.trim(),
    password: refs.registerPassword.value
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
  refs.registerDialog.close();
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
