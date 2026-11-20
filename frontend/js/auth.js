const STORAGE_SESSION = "pulse.session";

function isTokenExpired(token) {
  if (!token || typeof token !== "string") return true;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1]));
    return payload.exp ? Date.now() >= payload.exp * 1000 : false;
  } catch {
    return true;
  }
}

function getSession() {
  try {
    const session = JSON.parse(localStorage.getItem(STORAGE_SESSION) || "null");
    if (!session) return null;
    if (session.token && isTokenExpired(session.token)) {
      logout();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function setSession(sessionData) {
  if (!sessionData) {
    localStorage.removeItem(STORAGE_SESSION);
    return;
  }
  localStorage.setItem(STORAGE_SESSION, JSON.stringify(sessionData));
}

function getToken() {
  const session = getSession();
  return session ? session.token : null;
}

function requireAuth() {
  const session = getSession();
  if (!session || (!session.username && !session.name) || isTokenExpired(session.token)) {
    logout();
    return null;
  }
  return session;
}

function logout() {
  localStorage.removeItem(STORAGE_SESSION);
  sessionStorage.removeItem(STORAGE_SESSION);
  sessionStorage.removeItem("pulse_active_conv");
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

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return { error: `Server error (${res.status} ${res.statusText || ""})`.trim() };
  }
}

// Backend API helpers
async function apiRegister({ username, email, password }) {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password }),
  });
  const data = await safeJson(res);
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
  const data = await safeJson(res);
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
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error || "Authentication check failed");
  return data.user;
}

async function apiUpdateProfile({ username, email, status }) {
  const token = getToken();
  if (!token) throw new Error("No active token");
  const res = await fetch("/api/auth/me", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ username, email, status }),
  });
  const data = await safeJson(res);
  if (!res.ok) {
    throw new Error(data.error || "Profile update failed");
  }
  return data;
}
