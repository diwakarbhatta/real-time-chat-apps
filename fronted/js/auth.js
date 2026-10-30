const STORAGE_USERS = "pulse.users";
const STORAGE_SESSION = "pulse.session";

function getUsers() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_USERS) || "[]");
  } catch {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
}

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_SESSION) || "null");
  } catch {
    return null;
  }
}

function setSession(sessionData) {
  localStorage.setItem(STORAGE_SESSION, JSON.stringify(sessionData));
}

function getToken() {
  const session = getSession();
  return session ? session.token : null;
}

function requireAuth() {
  const session = getSession();
  if (!session || (!session.username && !session.name)) {
    window.location.href = "/login.html";
    return null;
  }
  return session;
}

function logout() {
  localStorage.removeItem(STORAGE_SESSION);
  window.location.href = "/login.html";
}

function showAlert(el, message, type = "error") {
  if (!el) return;
  el.hidden = false;
  el.className = `alert alert--${type}`;
  el.textContent = message;
}

function hideAlert(el) {
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

function setFieldError(input, message) {
  const field = input.closest(".field");
  if (!field) return;
  field.classList.toggle("field--error", Boolean(message));
  const err = field.querySelector(".field__error");
  if (err) err.textContent = message || "";
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Backend API helpers
async function apiRegister({ username, email, password }) {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Registration failed");
  }
  return data;
}

async function apiLogin({ identifier, password }) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Login failed");
  }
  return data;
}

async function apiMe() {
  const token = getToken();
  if (!token) throw new Error("No active token");
  const res = await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Authentication check failed");
  return data.user;
}
