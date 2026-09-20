const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
const TOKEN_KEY = "b2b_admin_token";
const USER_KEY = "b2b_admin_user";

export const apiUrl = (path) => `${API_BASE_URL}${path}`;

// This app is served at site root in local dev but under /b2b/ in production
// (see vite.config.js's `base` — the VPS hosts the B2C app alongside it on
// the same domain, at /). A hardcoded "/login" hard-navigation would resolve
// to the site root in production and land on the B2C app's login page
// instead of this app's own — import.meta.env.BASE_URL always matches the
// configured base ("/b2b/" in prod, "/" in dev), so this stays correct in
// both. BASE_URL already ends with "/", so no separator is needed here.
export const LOGIN_PATH = `${import.meta.env.BASE_URL}login`;

// FastAPI's own validation errors (422) put `detail` as an array of
// {loc, msg, type} objects, not a string — passing that straight into
// `new Error(...)` stringifies the array as "[object Object]" instead of
// anything readable. Every error surface in the app (apiRequest, apiUpload,
// downloadFile, fetchBlobUrl) needs this, not just one screen.
const extractErrorMessage = (data, fallback) => {
  const { detail } = data || {};
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((d) => (typeof d === "string" ? d : d?.msg || JSON.stringify(d)));
    return messages.join("; ") || fallback;
  }
  return data?.message || fallback;
};

// One-time cleanup: sessions used to be kept in localStorage (persisted forever,
// so old logins kept skipping the login screen on every visit). Now they live in
// sessionStorage, so drop any leftover localStorage entries from before this change.
localStorage.removeItem(TOKEN_KEY);
localStorage.removeItem(USER_KEY);

export const getStoredToken = () => sessionStorage.getItem(TOKEN_KEY);
export const getStoredUser = () => {
  try {
    return JSON.parse(sessionStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
};

export const storeSession = (token, user) => {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const clearSession = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
};

// sessionStorage is deliberately per-tab, not shared — a tab that has no
// session of its own (a fresh tab, a logged-out tab, a tab whose token just
// died) must never silently adopt ANOTHER open tab's session. A previous
// version of this file did exactly that (a BroadcastChannel "is anyone else
// logged in?" request any tab would answer with its own token/user), which
// meant a tab logged in as one account could end up handed a completely
// different, unrelated account's session — including a more privileged one
// (e.g. Super Admin) — just because that account happened to be open in
// another tab of the same browser. Removed entirely; each tab now always
// requires its own real login, matching what sessionStorage is for.
//
// The logout broadcast below is safe to keep: it only ever tells tabs that
// already hold that same token to also clear it — it never hands a session
// TO a tab that doesn't already have one.
const AUTH_CHANNEL_NAME = "b2b_admin_auth";
const authChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(AUTH_CHANNEL_NAME) : null;

// Called on every real logout — a 401 (the shared token just went invalid)
// and an explicit Logout click alike (see AuthContext.logout) — so a
// duplicated tab (browser's "duplicate tab", which copies sessionStorage and
// so shares this exact token) never sits there still signed in after the
// user logged out somewhere else.
export const broadcastLogout = () => {
  authChannel?.postMessage({ type: "logout" });
};

// A hard `window.location.href` redirect to /login can unload this document
// before the postMessage above actually reaches other tabs — confirmed: call
// both back-to-back with no gap and a duplicated tab stays logged in. One
// tick is enough for the browser to dispatch it; imperceptible here since
// this tab is navigating to /login either way.
export const redirectToLoginAfterLogout = () => {
  setTimeout(() => {
    window.location.href = LOGIN_PATH;
  }, 50);
};

// Lets AuthContext mirror another tab's session expiring (401) into this
// tab's state.
export const onAuthLogoutBroadcast = (callback) => {
  if (!authChannel) return () => {};
  const handler = (event) => {
    if (event.data?.type === "logout") callback();
  };
  authChannel.addEventListener("message", handler);
  return () => authChannel.removeEventListener("message", handler);
};

export const apiRequest = async (path, options = {}) => {
  let response;
  const token = getStoredToken();
  try {
    response = await fetch(apiUrl(path), {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
      ...options,
    });
  } catch {
    throw new Error(`Cannot reach the server at ${API_BASE_URL}. Make sure the backend is running.`);
  }

  // OTP-step endpoints are also pre-session (no real token exists yet to
  // clear) — a 401 here means an expired/invalid otp_token, not an expired
  // login session, so it must not trigger the same clear-and-redirect as a
  // stale Bearer token would on every other endpoint.
  const isPreSessionAuthPath =
    path.startsWith("/api/auth/login") || path.startsWith("/api/auth/verify-otp") || path.startsWith("/api/auth/resend-otp");
  if (response.status === 401 && !isPreSessionAuthPath) {
    clearSession();
    broadcastLogout();
    if (window.location.pathname !== LOGIN_PATH) {
      redirectToLoginAfterLogout();
    }
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(extractErrorMessage(data, "API request failed"));
  }

  return data;
};

// FormData sets its own multipart boundary — don't attach a Content-Type header.
export const apiUpload = async (path, formData) => {
  const token = getStoredToken();
  let response;
  try {
    response = await fetch(apiUrl(path), {
      method: "POST",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: formData,
    });
  } catch {
    throw new Error(`Cannot reach the server at ${API_BASE_URL}. Make sure the backend is running.`);
  }

  if (response.status === 401) {
    clearSession();
    broadcastLogout();
    if (window.location.pathname !== LOGIN_PATH) {
      redirectToLoginAfterLogout();
    }
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractErrorMessage(data, "API request failed"));
  }
  return data;
};

export const downloadFile = async (path, filename) => {
  const token = getStoredToken();
  let response;
  try {
    response = await fetch(apiUrl(path), {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new Error(`Cannot reach the server at ${API_BASE_URL}. Make sure the backend is running.`);
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(data, "Download failed"));
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "document";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

// Same authenticated fetch as downloadFile, but returns a displayable object
// URL instead of triggering a save-as click — a plain <iframe src="..."> or
// <img src="..."> can't carry the Bearer token, so this is how inline
// previews (e.g. the Order Detail PDF viewer) load protected files. Callers
// are responsible for revoking the returned URL when done with it.
export const fetchBlobUrl = async (path) => {
  const token = getStoredToken();
  let response;
  try {
    response = await fetch(apiUrl(path), {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new Error(`Cannot reach the server at ${API_BASE_URL}. Make sure the backend is running.`);
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(data, "Failed to load document"));
  }

  const blob = await response.blob();
  return window.URL.createObjectURL(blob);
};
