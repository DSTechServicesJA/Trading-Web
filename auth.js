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
  const STRATEGIES_KEY = "itguru_auth_strategies";

  /* -------- Helpers -------- */

  /** Safely parse a JSON response, returning a fallback on empty/invalid body */
  async function safeJson(resp) {
    const text = await resp.text();
    if (!text) return {};
    try { return JSON.parse(text); }
    catch {
      /* Server returned non-JSON (e.g. a PHP error page) — surface what we can */
      return { _raw: text.substring(0, 300) };
    }
  }

  /**
   * Fetch an auth endpoint with automatic .php fallback.
   * Hosts without mod_rewrite / URL rewriting return 404 for clean URLs
   * like /api/auth/login — this helper retries with /api/auth/login.php.
   */
  async function authFetch(endpoint, options) {
    let resp;
    try {
      resp = await fetch(`${AUTH_API_BASE}/${endpoint}`, options);
    } catch {
      throw new Error("Network error — check your connection and try again");
    }

    /* If clean URL returned 404, retry with .php extension */
    if (resp.status === 404) {
      try {
        resp = await fetch(`${AUTH_API_BASE}/${endpoint}.php`, options);
      } catch {
        throw new Error("Network error — check your connection and try again");
      }
    }

    return resp;
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

  /** Get granted strategy keys for the current user */
  function getStrategies() {
    try {
      return JSON.parse(sessionStorage.getItem(STRATEGIES_KEY) || "[]");
    } catch { return []; }
  }

  /** Login with username + password */
  async function login(username, password) {
    const resp = await authFetch("login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await safeJson(resp);

    if (!resp.ok) {
      if (data.error) {
        throw new Error(data.error);
      } else if (data._raw) {
        console.error("Server returned non-JSON:", data._raw);
        throw new Error(`Login failed (HTTP ${resp.status}). Check browser console for details or visit /api/auth/status`);
      }
      throw new Error(`Login failed (HTTP ${resp.status})`);
    }

    sessionStorage.setItem(SESSION_KEY, data.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(data.user || { username }));
    if (Array.isArray(data.user?.strategies)) {
      sessionStorage.setItem(STRATEGIES_KEY, JSON.stringify(data.user.strategies));
    }

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

    const resp = await authFetch("register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, email })
    });

    const data = await safeJson(resp);

    if (!resp.ok) {
      /* Surface the server error, or hint at what went wrong */
      if (data.error) {
        throw new Error(data.error);
      } else if (data._raw) {
        console.error("Server returned non-JSON:", data._raw);
        throw new Error(`Registration failed (HTTP ${resp.status}). Check browser console for details or visit /api/auth/status`);
      }
      throw new Error(`Registration failed (HTTP ${resp.status})`);
    }

    if (!data.token) {
      throw new Error("Registration failed — no token returned. Visit /api/auth/status to diagnose.");
    }

    sessionStorage.setItem(SESSION_KEY, data.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(data.user || { username }));
    if (Array.isArray(data.user?.strategies)) {
      sessionStorage.setItem(STRATEGIES_KEY, JSON.stringify(data.user.strategies));
    }
    return data;
  }

  /** Verify existing token is still valid */
  async function verify() {
    const token = getToken();
    if (!token) return false;

    try {
      const resp = await authFetch("verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      const data = await safeJson(resp);
      if (data.valid === true) {
        if (data.user) {
          sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
        }
        if (Array.isArray(data.user?.strategies)) {
          sessionStorage.setItem(STRATEGIES_KEY, JSON.stringify(data.user.strategies));
        }
        updateNavUI();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Update nav UI elements that reflect the current auth state:
   *   - #adminNavItem  → shown only for admin users
   *   - #userAccountInfo → subscription status + expiry badge
   * Safe to call at any time; silently no-ops when elements are absent.
   */
  function updateNavUI() {
    try {
      const u = getUser();

      /* Admin nav link */
      const adminNavItem = document.getElementById("adminNavItem");
      if (adminNavItem) {
        adminNavItem.style.display = (u && u.role === "admin") ? "" : "none";
      }

      /* User account info bar */
      const infoEl = document.getElementById("userAccountInfo");
      if (!infoEl) return;

      if (!u) {
        infoEl.style.display = "none";
        return;
      }

      const sub = u.subscription_status || "inactive";
      const exp = u.subscription_expires_at;

      let subLabel;
      if (sub === "active")   subLabel = "✅ Active";
      else if (sub === "trial") subLabel = "🔵 Trial";
      else                      subLabel = "⚪ Inactive";

      let expText = "";
      if (exp) {
        const expDate = new Date(exp);
        const now     = new Date();
        if (expDate < now) {
          expText = " · ⚠️ Expired";
        } else {
          expText = " · Expires " + expDate.toLocaleDateString(undefined,
            { year: "numeric", month: "short", day: "numeric" });
        }
      }

      infoEl.textContent = "👤 " + (u.displayName || u.username) + "  ·  " + subLabel + expText;
      infoEl.style.display = "";
    } catch (_) {}
  }

  /** Logout – clear session */
  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(STRATEGIES_KEY);
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
      updateNavUI();
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
          updateNavUI();
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
          updateNavUI();
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
    getStrategies,
    login,
    register,
    verify,
    logout,
    updateNavUI,
    initLoginGate
  };
})();
