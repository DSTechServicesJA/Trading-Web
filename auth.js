/* =========================================================
   IT Guru – Shared Authentication Module
   ---------------------------------------------------------
   Client-side login system that authenticates against a
   server-hosted database via REST API.

   Expected server endpoints (implement on your server):
     POST /api/auth/login   { username, password }
       → 200 { token, user: { username, displayName } }
       → 401 { error: "Invalid credentials" }

     POST /api/auth/verify  { token }
       → 200 { valid: true, user: { username, displayName } }
       → 401 { valid: false }

     POST /api/auth/register { username, password, email }
       → 201 { token, user: { username, displayName } }
       → 409 { error: "Username already exists" }

   Usage: include this script before your page's main JS.
   ========================================================= */

"use strict";

const ITGuruAuth = (() => {
  /* -------- Configuration -------- */
  /* Override by setting window.ITGURU_AUTH_API_BASE before loading this script */
  const AUTH_API_BASE = (typeof window !== "undefined" && window.ITGURU_AUTH_API_BASE)
    ? window.ITGURU_AUTH_API_BASE
    : "https://trading.dsitservicesja.com/api/auth";
  const SESSION_KEY   = "itguru_auth_token";
  const USER_KEY      = "itguru_auth_user";

  /* -------- Helpers -------- */

  /** Safely parse a JSON response, returning a fallback on empty/invalid body */
  async function safeJson(resp) {
    const text = await resp.text();
    if (!text) return {};
    try { return JSON.parse(text); }
    catch { return {}; }
  }

  /* -------- Public API -------- */

  /** Check if the user has a valid session */
  function isLoggedIn() {
    return !!sessionStorage.getItem(SESSION_KEY);
  }

  /** Get stored auth token */
  function getToken() {
    return sessionStorage.getItem(SESSION_KEY) || "";
  }

  /** Get stored user info */
  function getUser() {
    try {
      return JSON.parse(sessionStorage.getItem(USER_KEY) || "null");
    } catch { return null; }
  }

  /** Login with username + password */
  async function login(username, password) {
    let resp;
    try {
      resp = await fetch(`${AUTH_API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
    } catch {
      throw new Error("Network error — check your connection and try again");
    }

    const data = await safeJson(resp);

    if (!resp.ok) {
      throw new Error(data.error || "Login failed");
    }

    sessionStorage.setItem(SESSION_KEY, data.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(data.user || { username }));

    /* Persist "remember me" if requested */
    if (data.token) {
      const remembered = localStorage.getItem("itguru_remember_login");
      if (remembered === "1") {
        localStorage.setItem("itguru_saved_user", username);
      }
    }

    return data;
  }

  /** Register a new account */
  async function register(username, password, email) {
    /* Client-side validation matching server requirements */
    if (username.length < 3 || username.length > 50) {
      throw new Error("Username must be 3–50 characters");
    }
    if (!/^[a-zA-Z0-9_.\-]+$/.test(username)) {
      throw new Error("Username may only contain letters, numbers, dots, hyphens, and underscores");
    }
    if (password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Invalid email address");
    }

    let resp;
    try {
      resp = await fetch(`${AUTH_API_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, email })
      });
    } catch {
      throw new Error("Network error — check your connection and try again");
    }

    const data = await safeJson(resp);

    if (!resp.ok) {
      throw new Error(data.error || "Registration failed");
    }

    if (!data.token) {
      throw new Error("Registration failed due to a server error. Please try again later.");
    }

    sessionStorage.setItem(SESSION_KEY, data.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(data.user || { username }));
    return data;
  }

  /** Verify existing token is still valid */
  async function verify() {
    const token = getToken();
    if (!token) return false;

    try {
      const resp = await fetch(`${AUTH_API_BASE}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      const data = await safeJson(resp);
      return data.valid === true;
    } catch {
      return false;
    }
  }

  /** Logout – clear session */
  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(USER_KEY);
    localStorage.removeItem("itguru_saved_user");
    localStorage.removeItem("itguru_remember_login");
  }

  /**
   * Initialize the login gate overlay.
   * Call this from your page's DOMContentLoaded handler.
   * @param {object}   opts
   * @param {Function} [opts.onLogin] – callback when login succeeds
   */
  function initLoginGate(opts = {}) {
    const overlay   = document.getElementById("loginOverlay");
    const loginBtn  = document.getElementById("loginBtn");
    const err       = document.getElementById("loginError");
    const userInput = document.getElementById("loginUsername");
    const passInput = document.getElementById("loginPassword");
    const rememberMe = document.getElementById("loginRememberMe");
    const formLogin  = document.getElementById("loginFormSection");
    const formReg    = document.getElementById("registerFormSection");
    const switchToReg  = document.getElementById("switchToRegister");
    const switchToLogin = document.getElementById("switchToLogin");
    const regUserInput  = document.getElementById("regUsername");
    const regPassInput  = document.getElementById("regPassword");
    const regEmailInput = document.getElementById("regEmail");
    const regSubmitBtn  = document.getElementById("regSubmitBtn");
    const regError      = document.getElementById("regError");

    if (!overlay) return;

    /* Restore remembered username */
    if (rememberMe && localStorage.getItem("itguru_remember_login") === "1") {
      rememberMe.checked = true;
      const savedUser = localStorage.getItem("itguru_saved_user");
      if (savedUser && userInput) userInput.value = savedUser;
    }

    /* Show/hide overlay based on session state */
    if (isLoggedIn()) {
      overlay.style.display = "none";
    } else {
      overlay.style.display = "flex";
    }

    /* Switch between login / register forms */
    if (switchToReg) {
      switchToReg.addEventListener("click", (e) => {
        e.preventDefault();
        if (formLogin) formLogin.style.display = "none";
        if (formReg) formReg.style.display = "block";
        if (err) err.textContent = "";
      });
    }
    if (switchToLogin) {
      switchToLogin.addEventListener("click", (e) => {
        e.preventDefault();
        if (formReg) formReg.style.display = "none";
        if (formLogin) formLogin.style.display = "block";
        if (regError) regError.textContent = "";
      });
    }

    /* Login button handler */
    if (loginBtn) {
      loginBtn.addEventListener("click", async () => {
        const username = userInput?.value?.trim() || "";
        const password = passInput?.value || "";

        if (!username || !password) {
          if (err) err.textContent = "Enter username and password";
          return;
        }

        loginBtn.disabled = true;
        loginBtn.textContent = "Logging in…";
        if (err) err.textContent = "";

        /* Handle "remember me" */
        if (rememberMe) {
          if (rememberMe.checked) {
            localStorage.setItem("itguru_remember_login", "1");
            localStorage.setItem("itguru_saved_user", username);
          } else {
            localStorage.removeItem("itguru_remember_login");
            localStorage.removeItem("itguru_saved_user");
          }
        }

        try {
          await login(username, password);
          overlay.style.display = "none";
          if (opts.onLogin) opts.onLogin();
        } catch (ex) {
          if (err) err.textContent = ex.message || "Login failed";
        } finally {
          loginBtn.disabled = false;
          loginBtn.textContent = "LOGIN";
        }
      });
    }

    /* Register button handler */
    if (regSubmitBtn) {
      regSubmitBtn.addEventListener("click", async () => {
        const username = regUserInput?.value?.trim() || "";
        const password = regPassInput?.value || "";
        const email    = regEmailInput?.value?.trim() || "";

        if (!username || !password) {
          if (regError) regError.textContent = "Username and password are required";
          return;
        }

        regSubmitBtn.disabled = true;
        regSubmitBtn.textContent = "Creating account…";
        if (regError) regError.textContent = "";

        try {
          await register(username, password, email);
          overlay.style.display = "none";
          if (opts.onLogin) opts.onLogin();
        } catch (ex) {
          if (regError) regError.textContent = ex.message || "Registration failed";
        } finally {
          regSubmitBtn.disabled = false;
          regSubmitBtn.textContent = "CREATE ACCOUNT";
        }
      });
    }

    /* Allow Enter key to submit login */
    [userInput, passInput].forEach(el => {
      if (el) {
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") loginBtn?.click();
        });
      }
    });

    /* Allow Enter key to submit registration */
    [regUserInput, regPassInput, regEmailInput].forEach(el => {
      if (el) {
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") regSubmitBtn?.click();
        });
      }
    });
  }

  return {
    isLoggedIn,
    getToken,
    getUser,
    login,
    register,
    verify,
    logout,
    initLoginGate
  };
})();
