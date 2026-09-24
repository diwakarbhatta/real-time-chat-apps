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

function setSession(user) {
  localStorage.setItem(STORAGE_SESSION, JSON.stringify(user));
}

function requireAuth() {
  const session = getSession();
  if (!session) {
    window.location.href = "/login.html";
    return null;
  }
  return session;
}

function logout() {
  localStorage.removeItem(STORAGE_SESSION);
  window.location.href = "/login.html";
}

function showAlert(el, message, type) {
  if (!el) return;
  el.hidden = false;
  el.className = `alert alert--${type}`;
  el.textContent = message;
}

function setFieldError(input, message) {
  const field = input.closest(".field");
  if (!field) return;
  field.classList.toggle("field--error", Boolean(message));
  const err = field.querySelector(".field__error");
  if (err) err.textContent = message || "";
}

function initials(name) {
  return (name || "?")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
